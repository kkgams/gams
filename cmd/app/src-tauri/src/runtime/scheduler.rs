use super::*;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Weak;
use wasmtime::AsContextMut;

pub(super) type StoreId = u64;
type Job = Box<dyn FnOnce(&mut RuntimeInner) + Send>;
const QUEUE_CAPACITY: usize = 64;
const NATIVE_SHELL: &str = "gams:shell/shell@1.0.0::run";
const HOST: StoreId = 0;
static NEXT_STORE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Worker {
    queue: mpsc::SyncSender<Job>,
    resources: Arc<AtomicUsize>,
}

pub(super) struct Scheduler {
    workers: BTreeMap<StoreId, Worker>,
    components: BTreeMap<PathBuf, (StoreId, ComponentHandle)>,
    exports: BTreeMap<String, StoreId>,
    active: usize,
    changing: bool,
    waits: BTreeMap<StoreId, StoreId>,
    view_waits: BTreeSet<StoreId>,
}

impl Default for Scheduler {
    fn default() -> Self {
        Self {
            workers: BTreeMap::new(),
            components: BTreeMap::new(),
            exports: BTreeMap::from([(NATIVE_SHELL.into(), HOST)]),
            active: 0,
            changing: false,
            waits: BTreeMap::new(),
            view_waits: BTreeSet::new(),
        }
    }
}

pub(super) type Directory = Arc<Mutex<Scheduler>>;

// Keep the directory lock out of guest execution, worker waits, and UI replies.
// The guard tracks reservations, including queued work, until the reply arrives.
struct Reservation {
    directory: Directory,
    origin: Option<StoreId>,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        let mut state = self.directory.lock().unwrap();
        state.active -= 1;
        if let Some(origin) = self.origin {
            state.waits.remove(&origin);
        }
    }
}

pub(super) struct ViewWait(Directory, StoreId);

impl Drop for ViewWait {
    fn drop(&mut self) {
        self.0.lock().unwrap().view_waits.remove(&self.1);
    }
}

pub(super) struct Change<'a>(&'a Directory);

impl Drop for Change<'_> {
    fn drop(&mut self) {
        self.0.lock().unwrap().changing = false;
    }
}

impl Worker {
    fn start(
        mut runtime: RuntimeInner,
        id: StoreId,
        directory: Weak<Mutex<Scheduler>>,
    ) -> Result<Self> {
        runtime.store.data_mut().route = Some((id, directory));
        let (queue, rx) = mpsc::sync_channel::<Job>(QUEUE_CAPACITY);
        let resources = Arc::new(AtomicUsize::new(0));
        thread::Builder::new()
            .name(format!("gams-store-{id}"))
            .spawn(move || {
                while let Ok(job) = rx.recv() {
                    job(&mut runtime);
                }
            })?;
        Ok(Self { queue, resources })
    }

    fn run<T: Send + 'static>(
        &self,
        run: impl FnOnce(&mut RuntimeInner) -> T + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = mpsc::sync_channel(1);
        let resources = self.resources.clone();
        self.queue
            .try_send(Box::new(move |runtime| {
                let result = run(runtime);
                resources.store(
                    runtime.store.data().json_resource_refs.len(),
                    Ordering::Relaxed,
                );
                let _ = tx.send(result);
            }))
            .map_err(|err| match err {
                mpsc::TrySendError::Full(_) => "plugin Store queue is full".to_owned(),
                mpsc::TrySendError::Disconnected(_) => "plugin Store worker stopped".to_owned(),
            })?;
        rx.recv()
            .map_err(|_| "plugin Store worker stopped before replying".to_owned())
    }
}

impl Scheduler {
    pub(super) fn change(directory: &Directory) -> Result<Change<'_>, String> {
        let mut state = directory.lock().unwrap();
        if state.changing || state.active != 0 {
            return Err("cannot change plugins while the Runtime is busy".into());
        }
        state.changing = true;
        Ok(Change(directory))
    }

    pub(super) fn begin_view_wait(directory: &Directory, origin: StoreId) -> ViewWait {
        let inserted = directory.lock().unwrap().view_waits.insert(origin);
        assert!(inserted, "Store already waiting for a View reply");
        ViewWait(directory.clone(), origin)
    }

    // No implicit async caller identity exists in JS. While a Store awaits a View,
    // conservatively reject new requests to that Store (and Stores waiting on it).
    fn check_wait(&self, origin: Option<StoreId>, mut target: StoreId) -> Result<(), String> {
        loop {
            if Some(target) == origin {
                return Err(format!("cyclic plugin call to Store {target}"));
            }
            if self.view_waits.contains(&target) {
                return Err(format!(
                    "plugin Store {target} is waiting for a View reply; reentry is not allowed"
                ));
            }
            match self.waits.get(&target) {
                Some(next) => target = *next,
                None => return Ok(()),
            }
        }
    }

    fn reserve(
        &mut self,
        directory: &Directory,
        origin: Option<StoreId>,
        target: StoreId,
    ) -> Result<(Worker, Reservation), String> {
        self.check_wait(origin, target)?;
        let worker = self
            .workers
            .get(&target)
            .cloned()
            .ok_or("unknown or unloaded plugin Store")?;
        if let Some(origin) = origin {
            let previous = self.waits.insert(origin, target);
            assert!(
                previous.is_none(),
                "Store already waiting for another Store"
            );
        }
        self.active += 1;
        Ok((
            worker,
            Reservation {
                directory: directory.clone(),
                origin,
            },
        ))
    }

    pub(super) fn invoke(
        directory: &Directory,
        root: &Path,
        target: &str,
        args: Value,
    ) -> Result<Value, String> {
        let dispatched = {
            let mut state = directory.lock().unwrap();
            let (key, id) = resolve_invocation_func(&state.exports, target)
                .map_err(|error| error.to_string())?;
            if *id == HOST {
                None
            } else {
                if state.changing {
                    return Err("plugin Store registry is changing".into());
                }
                let (key, id) = (key.clone(), *id);
                let (worker, reservation) = state.reserve(directory, None, id)?;
                Some((key, worker, reservation))
            }
        };
        match dispatched {
            Some((key, worker, _reservation)) => worker
                .run(move |runtime| runtime.invoke(&key, args).map_err(|err| err.to_string()))?,
            None => invoke_native_shell_run(root, args).map_err(|error| error.to_string()),
        }
    }

    pub(super) fn release(directory: &Directory, resource: Value) -> Result<(), String> {
        let id = resource
            .get("id")
            .and_then(Value::as_str)
            .ok_or("resource object must contain string `id`")?;
        let store = id
            .strip_prefix("res_")
            .and_then(|id| id.split_once('_'))
            .and_then(|(store, _)| u64::from_str_radix(store, 16).ok())
            .ok_or_else(|| format!("unknown resource ref `{id}`"))?;
        let (worker, _reservation) = {
            let mut state = directory.lock().unwrap();
            if state.changing {
                return Err("plugin Store registry is changing".into());
            }
            if !state.workers.contains_key(&store) {
                return Err(format!("unknown resource ref `{id}`"));
            }
            state.reserve(directory, None, store)?
        };
        worker.run(move |runtime| {
            runtime
                .release_resource(resource)
                .map_err(|err| err.to_string())
        })?
    }

    pub(super) fn route_call(
        directory: &Directory,
        origin: StoreId,
        store: &mut StoreContextMut<'_, HostState>,
        target: &str,
        args: &str,
    ) -> std::result::Result<Option<String>, RuntimeCallError> {
        let returned = RuntimeCallError::Returned;
        // Resolve against the entire session first, not just the caller's group.
        let remote = {
            let mut state = directory.lock().unwrap();
            let route = if state.changing {
                None
            } else {
                resolve_runtime_call_func(&state.exports, target)
                    .map_err(|error| returned(error.to_string()))?
                    .map(|(key, id)| (key.clone(), *id))
            };
            match route {
                Some((key, id)) if id != origin && id != HOST => {
                    let (worker, reservation) = state
                        .reserve(directory, Some(origin), id)
                        .map_err(returned)?;
                    Some((key, worker, reservation))
                }
                _ => None,
            }
        };
        if let Some((key, worker, _reservation)) = remote {
            let args = args.to_owned();
            return worker
                .run(move |runtime| {
                    call_runtime_target(&mut runtime.store.as_context_mut(), &key, &args)
                })
                .map_err(returned)?;
        }
        call_runtime_target(store, target, args)
    }

    pub(super) fn diagnostics(&self, cache: &Path) -> Value {
        serde_json::json!({
            "components": self.components.values().map(|(_, handle)| handle).collect::<Vec<_>>(),
            "exports": self.exports.keys().collect::<Vec<_>>(),
            "jsonResourceRefs": self.workers.values().map(|worker| worker.resources.load(Ordering::Relaxed)).sum::<usize>(),
            "compiledComponentCacheDir": cache.display().to_string(),
        })
    }

    pub(super) fn paths(&self) -> Vec<PathBuf> {
        self.components.keys().cloned().collect()
    }

    pub(super) fn handle(&self, path: &Path) -> Option<ComponentHandle> {
        self.components.get(path).map(|(_, handle)| handle.clone())
    }
}

impl Change<'_> {
    pub(super) fn install(
        &self,
        compiler: &RuntimeInner,
        candidates: Vec<ComponentCandidate>,
        reload: bool,
    ) -> Result<()> {
        let (existing, keys, workers) = {
            let state = self.0.lock().unwrap();
            if reload {
                (BTreeMap::new(), BTreeMap::new(), BTreeMap::new())
            } else {
                (
                    state.components.clone(),
                    state.exports.clone(),
                    state.workers.clone(),
                )
            }
        };
        let plan = install_plan(compiler, &existing, &keys, &candidates)?;
        let mut staged = Scheduler::default();
        for (owner, candidates) in plan {
            let (id, worker) = match owner {
                Some(id) => (id, workers[&id].clone()),
                None => {
                    let id = NEXT_STORE.fetch_add(1, Ordering::Relaxed);
                    let runtime = compiler.empty_store()?;
                    (id, Worker::start(runtime, id, Arc::downgrade(self.0))?)
                }
            };
            for candidate in candidates {
                let path = candidate.resolved_path.clone();
                let (handle, exports) = worker
                    .run(move |runtime| {
                        let handle = runtime.instantiate_candidate(&candidate)?;
                        let exports = runtime
                            .funcs
                            .keys()
                            .filter(|key| key.as_str() != NATIVE_SHELL)
                            .cloned()
                            .collect::<Vec<_>>();
                        Ok::<_, anyhow::Error>((handle, exports))
                    })
                    .map_err(anyhow::Error::msg)??;
                let publish = |state: &mut Scheduler| {
                    state.workers.insert(id, worker.clone());
                    state.components.insert(path, (id, handle));
                    for export in exports {
                        state.exports.insert(export, id);
                    }
                };
                if reload {
                    publish(&mut staged);
                } else {
                    publish(&mut self.0.lock().unwrap());
                }
            }
        }
        if reload {
            let mut state = self.0.lock().unwrap();
            state.workers = staged.workers;
            state.components = staged.components;
            state.exports = staged.exports;
        }
        Ok(())
    }
}

fn merge(groups: &mut [usize], a: usize, b: usize) {
    let (a, b) = (groups[a], groups[b]);
    for group in groups {
        if *group == b {
            *group = a;
        }
    }
}

fn install_plan(
    compiler: &RuntimeInner,
    existing: &BTreeMap<PathBuf, (StoreId, ComponentHandle)>,
    keys: &BTreeMap<String, StoreId>,
    candidates: &[ComponentCandidate],
) -> Result<Vec<(Option<StoreId>, Vec<ComponentCandidate>)>> {
    let mut providers = compiler.provider_table(candidates)?;
    for (_, handle) in existing.values() {
        for export in &handle.exports {
            insert_provider(
                &mut providers,
                export,
                ProviderSource::LoadedComponent {
                    path: handle.path.clone(),
                },
            )?;
        }
    }
    let mut keys: BTreeSet<_> = keys.keys().cloned().collect();
    keys.insert(NATIVE_SHELL.into());
    for candidate in candidates {
        for key in component_function_keys(&compiler.engine, &candidate.component) {
            anyhow::ensure!(
                keys.insert(key.clone()),
                "duplicate provider for exported function `{key}`"
            );
        }
    }
    let (order, dependencies, owners) = plugin_order(candidates, &providers, existing)?;
    let mut groups: Vec<_> = (0..candidates.len()).collect();
    for (index, deps) in dependencies.iter().enumerate() {
        for dep in deps {
            merge(&mut groups, index, *dep);
        }
    }
    let mut attached: BTreeMap<usize, StoreId> = BTreeMap::new();
    for (index, owners) in owners.into_iter().enumerate() {
        for owner in owners {
            if let Some(other) = attached.insert(groups[index], owner) {
                anyhow::ensure!(
                    other == owner,
                    "new plugin links existing independent Stores; reload plugins together"
                );
            }
        }
    }
    let mut plan = BTreeMap::<_, Vec<_>>::new();
    for index in order {
        let group = groups[index];
        // Components which use the same existing Store must execute in topological order there.
        let owner = attached.get(&group).copied();
        plan.entry((owner, if owner.is_some() { 0 } else { group }))
            .or_default()
            .push(candidates[index].clone());
    }
    Ok(plan
        .into_iter()
        .map(|((owner, _), candidates)| (owner, candidates))
        .collect())
}

fn plugin_order(
    candidates: &[ComponentCandidate],
    providers: &BTreeMap<InterfaceFamily, InterfaceProvider>,
    existing: &BTreeMap<PathBuf, (StoreId, ComponentHandle)>,
) -> Result<(Vec<usize>, Vec<BTreeSet<usize>>, Vec<BTreeSet<StoreId>>)> {
    let mut dependencies = vec![BTreeSet::new(); candidates.len()];
    let mut owners = vec![BTreeSet::new(); candidates.len()];
    for (index, candidate) in candidates.iter().enumerate() {
        for import in &candidate.imports {
            // Prefer configured WASI providers (e.g. seeded Random) when compatible.
            // Otherwise use the builtin WASI implementation as before.
            let provider = if is_wasi_interface(import) {
                let id = parse_interface_id(import)?;
                let Some(provider) = id.and_then(|id| providers.get(&id.family())) else {
                    continue;
                };
                match resolve_provider(providers, import) {
                    Ok(Some(_)) => provider,
                    _ => continue,
                }
            } else {
                resolve_provider(providers, import)?.with_context(|| {
                    format!(
                        "missing provider for import `{import}` required by `{}`",
                        candidate.resolved_path.display()
                    )
                })?
            };
            match &provider.source {
                ProviderSource::NewComponent { index: dep, .. } if *dep != index => {
                    dependencies[index].insert(*dep);
                }
                ProviderSource::LoadedComponent { path } => {
                    owners[index].insert(existing[Path::new(path)].0);
                }
                _ => {}
            }
        }
    }
    let mut order = Vec::new();
    let mut done = BTreeSet::new();
    while order.len() < candidates.len() {
        let previous = order.len();
        for (index, deps) in dependencies.iter().enumerate() {
            if !done.contains(&index) && deps.is_subset(&done) {
                done.insert(index);
                order.push(index);
            }
        }
        anyhow::ensure!(order.len() > previous, "cycle in component imports/exports");
    }
    Ok((order, dependencies, owners))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PROVIDER: &str = r#"(component
        (core module $m
            (global $count (mut i32) (i32.const 0))
            (func (export "next") (result i32)
                global.get $count i32.const 1 i32.add global.set $count global.get $count))
        (core instance $i (instantiate $m))
        (func $next (result u32) (canon lift (core func $i "next")))
        (instance $provider (export "next" (func $next)))
        (export "test:counter/counter@1.0.0" (instance $provider)))"#;
    const PEER: &str = r#"(component
        (core module $m (func (export "peer") (result i32) i32.const 17))
        (core instance $i (instantiate $m))
        (func (export "peer") (result u32) (canon lift (core func $i "peer"))))"#;
    const CONSUMER: &str = r#"(component
        (import "test:counter/counter@1.0.0" (instance $counter
            (export "next" (func (result u32)))))
        (alias export $counter "next" (func $next))
        (core func $lower (canon lower (func $next)))
        (core module $m (import "dep" "next" (func $n (result i32)))
            (func (export "use") (result i32) call $n))
        (core instance $dep (export "next" (func $lower)))
        (core instance $i (instantiate $m (with "dep" (instance $dep))))
        (func (export "read-counter") (result u32) (canon lift (core func $i "use"))))"#;

    fn fixture() -> (tempfile::TempDir, Runtime) {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().canonicalize().unwrap();
        let runtime = Runtime::new_at(
            path.clone(),
            vec![FsPreopen {
                host_path: path,
                guest_path: ".".into(),
            }],
        )
        .unwrap();
        (root, runtime)
    }

    fn write(root: &tempfile::TempDir, file: &str, source: &str) -> PathBuf {
        let path = root.path().join(file);
        fs::write(&path, source).unwrap();
        path
    }

    fn owner(directory: &Directory, name: &str) -> StoreId {
        directory.lock().unwrap().exports[name]
    }

    #[test]
    fn typed_link_preserves_singleton_state_and_unrelated_store_runs_while_it_waits() {
        let (root, runtime) = fixture();
        let provider = write(&root, "z-provider.wat", PROVIDER);
        let consumer = write(&root, "a-consumer.wat", CONSUMER);
        let peer = write(&root, "peer.wat", PEER);
        runtime
            .add_component_files(vec![consumer, provider, peer])
            .unwrap();
        let counter = "test:counter/counter@1.0.0::next";
        let counter_id = owner(&runtime.directory, counter);
        assert_eq!(owner(&runtime.directory, "read-counter"), counter_id);
        assert_ne!(owner(&runtime.directory, "peer"), counter_id);
        assert_eq!(runtime.invoke(counter, json!([])).unwrap(), json!(1));
        assert_eq!(runtime.invoke("read-counter", json!([])).unwrap(), json!(2));

        let (entered, gate) = mpsc::channel();
        let (release, proceed) = mpsc::channel();
        let (worker, reservation) = runtime
            .directory
            .lock()
            .unwrap()
            .reserve(&runtime.directory, None, counter_id)
            .unwrap();
        let joining = thread::spawn(move || {
            let _reservation = reservation;
            worker
                .run(move |_| {
                    entered.send(()).unwrap();
                    proceed.recv_timeout(Duration::from_secs(5))
                })
                .unwrap()
                .unwrap();
        });
        gate.recv_timeout(Duration::from_secs(5)).unwrap();
        let (done, reply) = mpsc::channel();
        let caller = runtime.clone();
        let other = thread::spawn(move || done.send(caller.invoke("peer", json!([]))).unwrap());
        let result = reply.recv_timeout(Duration::from_secs(2));
        release.send(()).unwrap();
        other.join().unwrap();
        joining.join().unwrap();
        assert_eq!(result.unwrap().unwrap(), json!(17));
    }

    #[test]
    fn incremental_link_reuses_owner_and_reload_replaces_generation() {
        let (root, runtime) = fixture();
        let provider = write(&root, "provider.wat", PROVIDER);
        let consumer = write(&root, "consumer.wat", CONSUMER);
        let counter = "test:counter/counter@1.0.0::next";
        let old = runtime
            .add_component_files(vec![provider])
            .unwrap()
            .remove(0);
        assert_eq!(runtime.invoke(counter, json!([])).unwrap(), json!(1));
        runtime.add_component_files(vec![consumer]).unwrap();
        assert_eq!(runtime.invoke("read-counter", json!([])).unwrap(), json!(2));
        let fresh = runtime
            .add_plugins(vec![old.path.clone()], true)
            .unwrap()
            .remove(0);
        assert_ne!(old.handle, fresh.handle);
        assert_eq!(runtime.invoke("read-counter", json!([])).unwrap(), json!(1));
    }

    #[test]
    fn wait_graph_rejects_cycles_and_view_reentry_before_enqueuing() {
        let (root, runtime) = fixture();
        runtime
            .add_component_files(vec![
                write(&root, "p.wat", PROVIDER),
                write(&root, "peer.wat", PEER),
            ])
            .unwrap();
        let a = owner(&runtime.directory, "test:counter/counter@1.0.0::next");
        let b = owner(&runtime.directory, "peer");
        let (_, reservation) = runtime
            .directory
            .lock()
            .unwrap()
            .reserve(&runtime.directory, Some(a), b)
            .unwrap();
        {
            let state = runtime.directory.lock().unwrap();
            assert!(state.check_wait(Some(b), a).unwrap_err().contains("cyclic"));
        }
        assert!(Scheduler::change(&runtime.directory).is_err());
        {
            let _pending = Scheduler::begin_view_wait(&runtime.directory, b);
            assert!(runtime
                .invoke("peer", json!([]))
                .unwrap_err()
                .contains("waiting for a View"));
            assert!(runtime
                .invoke("test:counter/counter@1.0.0::next", json!([]))
                .unwrap_err()
                .contains("waiting for a View"));
        }
        drop(reservation);
        assert_eq!(runtime.invoke("peer", json!([])).unwrap(), json!(17));
    }
}
