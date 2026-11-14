use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

use crate::resources::{Location, ResourceEvent, Resources};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

mod refs;

const MODULES_FOLDER: &str = "gams_modules";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub config: serde_json::Value,
    pub config_file: String,
    pub modules_dir: PathBuf,
    #[serde(skip)]
    provenance: refs::Provenance,
}

pub fn config_file(value: Option<&OsStr>) -> Result<String> {
    let value = value.unwrap_or_else(|| OsStr::new("gams.json"));
    let name = value.to_str().context("GAMS_CONFIG must be valid UTF-8")?;
    anyhow::ensure!(
        !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains(['/', '\\', '\0'])
            && Path::new(name).file_name() == Some(value),
        "GAMS_CONFIG must be a non-empty filename within the Project directory"
    );
    Ok(name.to_owned())
}

pub fn modules_path(root: &Path, shared_modules: Option<&OsStr>) -> Result<PathBuf> {
    match shared_modules {
        Some(path) => {
            let path = PathBuf::from(path);
            anyhow::ensure!(
                path.is_absolute(),
                "GAMS_MODULES_DIR must be a non-empty absolute directory path"
            );
            Ok(path)
        }
        None => Ok(root.join(MODULES_FOLDER)),
    }
}

impl Project {
    #[cfg(test)]
    pub fn load(root: &Path, shared_modules: Option<&OsStr>, config_file: &str) -> Result<Self> {
        let resources = Resources::new(modules_path(root, shared_modules)?);
        Self::load_with_resources(root, config_file, &resources, &mut |_| {}, &|path| {
            Ok(path
                .to_str()
                .context("resolved file path must be UTF-8")?
                .to_owned())
        })
    }

    fn load_with_resources(
        root: &Path,
        config_file: &str,
        resources: &Resources,
        on_progress: &mut dyn FnMut(ResourceEvent),
        file_path: &dyn Fn(&Path) -> Result<String>,
    ) -> Result<Self> {
        let config_path = root.join(config_file);
        let (config, provenance) = refs::load(&config_path, resources, on_progress, file_path)?;
        anyhow::ensure!(
            config.is_object(),
            "{} must contain an object",
            config_path.display()
        );
        let modules_dir = resources.modules_dir();
        std::fs::create_dir_all(modules_dir)
            .with_context(|| format!("failed to create {}", modules_dir.display()))?;
        Ok(Self {
            config,
            config_file: config_file.to_owned(),
            modules_dir: modules_dir.canonicalize()?,
            provenance,
        })
    }

    pub fn prepare_config(&self, config: &Value) -> Result<Value> {
        anyhow::ensure!(config.is_object(), "Project config must contain an object");
        Ok(self.provenance.prepare(config))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionProgress {
    pub operation_id: String,
    pub status: String,
    pub discovered: usize,
    pub completed: usize,
    pub resources: Vec<ResourceEvent>,
    pub error: Option<String>,
}

impl ResolutionProgress {
    fn new() -> Self {
        static NEXT_OPERATION: AtomicU64 = AtomicU64::new(1);
        Self {
            operation_id: format!(
                "{}-{}",
                std::process::id(),
                NEXT_OPERATION.fetch_add(1, Ordering::Relaxed)
            ),
            status: "resolving".into(),
            discovered: 0,
            completed: 0,
            resources: Vec::new(),
            error: None,
        }
    }
}

pub struct Session {
    root: PathBuf,
    config_file: String,
    resources: Resources,
    project: Mutex<Option<Project>>,
    progress: Mutex<ResolutionProgress>,
    mounts: Vec<crate::runtime::FsPreopen>,
}

impl Session {
    pub fn new(
        root: PathBuf,
        config_file: String,
        modules_dir: PathBuf,
        mounts: Vec<crate::runtime::FsPreopen>,
    ) -> Self {
        Self {
            root,
            config_file,
            resources: Resources::new(modules_dir),
            project: Mutex::new(None),
            progress: Mutex::new(ResolutionProgress::new()),
            mounts,
        }
    }

    pub fn progress(&self) -> ResolutionProgress {
        self.progress
            .lock()
            .expect("resolution progress lock poisoned")
            .clone()
    }

    fn operation<T>(
        &self,
        on_progress: &mut dyn FnMut(ResolutionProgress),
        run: impl FnOnce(&mut dyn FnMut(ResourceEvent)) -> Result<T>,
    ) -> Result<T> {
        let mut snapshot = ResolutionProgress::new();
        let publish = |snapshot: &ResolutionProgress,
                       on_progress: &mut dyn FnMut(ResolutionProgress)| {
            *self
                .progress
                .lock()
                .expect("resolution progress lock poisoned") = snapshot.clone();
            on_progress(snapshot.clone());
        };
        publish(&snapshot, on_progress);
        let result = run(&mut |event| {
            if let Some(previous) = snapshot
                .resources
                .iter_mut()
                .find(|item| item.resource == event.resource)
            {
                *previous = event;
            } else {
                snapshot.resources.push(event);
            }
            snapshot.discovered = snapshot.resources.len();
            snapshot.completed = snapshot
                .resources
                .iter()
                .filter(|item| item.phase == "ready")
                .count();
            publish(&snapshot, on_progress);
        });
        match &result {
            Ok(_) => snapshot.status = "ready".into(),
            Err(error) => {
                snapshot.status = "failed".into();
                snapshot.error = Some(format!("{error:#}"));
            }
        }
        publish(&snapshot, on_progress);
        result
    }

    pub fn project(&self, on_progress: &mut dyn FnMut(ResolutionProgress)) -> Result<Project> {
        let mut project = self.project.lock().expect("Project state lock poisoned");
        if let Some(project) = project.as_ref() {
            on_progress(self.progress());
            return Ok(project.clone());
        }
        let loaded = self.operation(on_progress, |progress| {
            Project::load_with_resources(
                &self.root,
                &self.config_file,
                &self.resources,
                progress,
                &|path| self.guest_path(path),
            )
        })?;
        *project = Some(loaded.clone());
        Ok(loaded)
    }

    pub fn resolve_file(
        &self,
        source: &Value,
        on_progress: &mut dyn FnMut(ResolutionProgress),
    ) -> Result<String> {
        self.operation(on_progress, |progress| {
            let base = Location::Local(self.root.clone());
            let source = self.host_source(source)?;
            let location = Location::parse(&source, &base)?;
            let path = self.resources.materialize(&location, progress)?;
            self.guest_path(&path)
        })
    }

    fn host_source(&self, source: &Value) -> Result<Value> {
        match source {
            Value::String(value)
                if !value.is_empty()
                    && reqwest::Url::parse(value).is_err()
                    && !Path::new(value).is_absolute() =>
            {
                Ok(serde_json::json!(crate::runtime::host_path(
                    &self.root,
                    &self.mounts,
                    value
                )?))
            }
            Value::Object(descriptor) => {
                let mut descriptor = descriptor.clone();
                if let Some(url) = descriptor.get_mut("url") {
                    *url = self.host_source(url)?;
                }
                Ok(Value::Object(descriptor))
            }
            source => Ok(source.clone()),
        }
    }

    fn guest_path(&self, path: &Path) -> Result<String> {
        // Prefer explicit relative mounts (including shared Unit storage), then
        // the Project root. Guest paths use / on every native platform.
        let selected = self
            .mounts
            .iter()
            .filter(|mount| !Path::new(&mount.guest_path).is_absolute())
            .filter_map(|mount| {
                path.strip_prefix(&mount.host_path)
                    .ok()
                    .map(|relative| (mount, relative))
            })
            .max_by_key(|(mount, _)| mount.host_path.components().count());
        let (mount, relative) = selected.with_context(|| {
            format!(
                "resolved file is outside the Project's filesystem preopens: {}",
                path.display()
            )
        })?;
        let mut parts = Vec::new();
        if mount.guest_path != "." {
            parts.push(mount.guest_path.clone());
        }
        for part in relative.components() {
            parts.push(
                part.as_os_str()
                    .to_str()
                    .context("resolved file path must be UTF-8")?
                    .to_owned(),
            );
        }
        Ok(if parts.is_empty() {
            ".".into()
        } else {
            parts.join("/")
        })
    }

    pub fn prepare_config(&self, config: &Value) -> Result<Value> {
        let project = self.project.lock().expect("Project state lock poisoned");
        let mut config = project
            .as_ref()
            .context("Project config has not been loaded")?
            .prepare_config(config)?;
        self.restore_resource_sources(&mut config)?;
        Ok(config)
    }

    fn restore_resource_sources(&self, config: &mut Value) -> Result<()> {
        match config {
            Value::String(path) if path == "gams_modules" || path.starts_with("gams_modules/") => {
                let host = crate::runtime::host_path(&self.root, &self.mounts, path)?;
                if let Some(source) = self.resources.origin(&host)? {
                    *config = serde_json::json!({"$file": source.source_value()});
                }
            }
            Value::Object(values)
                if !values.contains_key("$ref") && !values.contains_key("$file") =>
            {
                for value in values.values_mut() {
                    self.restore_resource_sources(value)?;
                }
            }
            Value::Array(values) => {
                for value in values {
                    self.restore_resource_sources(value)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_default_or_explicit_filename() {
        assert_eq!(config_file(None).unwrap(), "gams.json");
        assert_eq!(
            config_file(Some(OsStr::new("dev config.json"))).unwrap(),
            "dev config.json"
        );
        for name in [
            "",
            ".",
            "..",
            "../dev.json",
            "/dev.json",
            "dir/dev.json",
            "dir\\dev.json",
            "bad\0.json",
        ] {
            assert!(config_file(Some(OsStr::new(name))).is_err(), "{name:?}");
        }
    }

    #[test]
    fn loads_selected_config_without_fallback() {
        let root = project_root();
        let path = root.path().join("dev.json");
        assert!(Project::load(root.path(), None, "dev.json").is_err());
        for config in ["{", "[]"] {
            std::fs::write(&path, config).unwrap();
            assert!(Project::load(root.path(), None, "dev.json").is_err());
        }
        assert!(!root.path().join(MODULES_FOLDER).exists());
        std::fs::write(path, r#"{"dev":true}"#).unwrap();
        let project = Project::load(root.path(), None, "dev.json").unwrap();
        assert_eq!(project.config, serde_json::json!({"dev": true}));
        assert_eq!(project.config_file, "dev.json");
    }

    #[test]
    fn resolves_files_pointers_and_nested_file_relative_references() {
        let root = project_root();
        std::fs::create_dir(root.path().join("config")).unwrap();
        std::fs::write(
            root.path().join("gams.json"),
            r##"{
            "database": {"$ref": "config/settings.json#/database"},
            "copy": {"$ref": "#/database"},
            "values": [{"$ref": "config/values.json"}],
            "escaped": {"$ref": "config/settings.json#/a~1b/~0key/0"},
            "emptyKey": {"$ref": "config/settings.json#/"}
        }"##,
        )
        .unwrap();
        std::fs::write(
            root.path().join("config/settings.json"),
            r##"{
            "database": {"$ref": "values.json#/0"},
            "a/b": {"~key": [42]},
            "": true
        }"##,
        )
        .unwrap();
        std::fs::write(
            root.path().join("config/values.json"),
            r#"[{"path":"data.sqlite"}, null, false, 3, "text"]"#,
        )
        .unwrap();
        let project = Project::load(root.path(), None, "gams.json").unwrap();
        assert_eq!(
            project.config,
            serde_json::json!({
            "database": {"path": "data.sqlite"},
            "copy": {"path": "data.sqlite"},
            "values": [[{"path": "data.sqlite"}, null, false, 3, "text"]],
            "escaped": 42,
            "emptyKey": true
            })
        );
    }

    #[test]
    fn replaces_root_reference_before_validating_config_shape() {
        let root = project_root();
        std::fs::write(root.path().join("gams.json"), r#"{"$ref":"other.json#"}"#).unwrap();
        std::fs::write(root.path().join("other.json"), r#"{"plugins":[]}"#).unwrap();
        assert_eq!(
            Project::load(root.path(), None, "gams.json")
                .unwrap()
                .config,
            serde_json::json!({"plugins": []})
        );
        std::fs::write(root.path().join("other.json"), "[]").unwrap();
        assert!(Project::load(root.path(), None, "gams.json").is_err());
    }

    #[test]
    fn rejects_invalid_references_before_creating_modules() {
        for (config, message) in [
            (r#"{"x":{"$ref":3}}"#, "$ref must be a string"),
            (r#"{"x":{"$ref":""}}"#, "$ref must not be empty"),
            (
                r##"{"x":{"$ref":"#/target","override":true},"target":{}}"##,
                "sibling properties",
            ),
            (r##"{"x":{"$ref":"#missing"}}"##, "starting with /"),
            (r##"{"x":{"$ref":"#/~2"}}"##, "invalid JSON Pointer escape"),
            (r##"{"x":{"$ref":"#/~"}}"##, "invalid JSON Pointer escape"),
            (r##"{"x":{"$ref":"#/missing"}}"##, "JSON Pointer not found"),
            (
                r##"{"x":{"$ref":"#/array/01"},"array":[1,2]}"##,
                "JSON Pointer not found",
            ),
            (r#"{"x":{"$ref":"missing.json"}}"#, "resolve local source"),
            (r#"{"x":{"$ref":"invalid.json"}}"#, "invalid JSON"),
        ] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            std::fs::write(root.path().join("invalid.json"), "{").unwrap();
            let error = Project::load(root.path(), None, "gams.json").err().unwrap();
            assert!(format!("{error:#}").contains(message), "{error:#}");
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    #[test]
    fn rejects_direct_indirect_and_cross_file_cycles() {
        for config in [
            r##"{"$ref":"#"}"##,
            r##"{"x":{"$ref":"#/x"}}"##,
            r##"{"x":{"$ref":"#/y"},"y":{"$ref":"#/x"}}"##,
            r##"{"x":{"$ref":"#"}}"##,
            r#"{"$ref":"other.json"}"#,
        ] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            std::fs::write(root.path().join("other.json"), r#"{"$ref":"./gams.json"}"#).unwrap();
            let error = Project::load(root.path(), None, "gams.json").err().unwrap();
            assert!(format!("{error:#}").contains("circular $ref"), "{error:#}");
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    #[test]
    fn resolves_file_paths_from_the_owning_json_and_preserves_them_on_save() {
        let root = project_root();
        std::fs::create_dir(root.path().join("catalog")).unwrap();
        std::fs::write(
            root.path().join("catalog/node.lua"),
            "return function() end",
        )
        .unwrap();
        std::fs::write(
            root.path().join("catalog/presets.json"),
            r#"{
            "presets": [{"name":"Node","codePath":{"$file":"node.lua"}}]
        }"#,
        )
        .unwrap();
        let original = serde_json::json!({
            "presets": {"$ref": {"url":"catalog/presets.json", "pointer":"/presets"}}
        });
        std::fs::write(root.path().join("gams.json"), original.to_string()).unwrap();
        let project = Project::load(root.path(), None, "gams.json").unwrap();
        let path = root.path().join("catalog/node.lua").canonicalize().unwrap();
        assert_eq!(
            project.config["presets"][0]["codePath"],
            path.to_str().unwrap()
        );
        assert_eq!(project.prepare_config(&project.config).unwrap(), original);
        let mut edited = project.config.clone();
        edited["presets"][0]["name"] = Value::String("Edited".into());
        let saved = project.prepare_config(&edited).unwrap();
        assert_eq!(saved["presets"][0]["name"], "Edited");
        assert_eq!(saved["presets"][0]["codePath"]["$file"], "catalog/node.lua");
        assert_eq!(
            saved["presets"][0]["codePath"].as_object().unwrap().len(),
            1
        );
        std::fs::write(root.path().join("gams.json"), saved.to_string()).unwrap();
        assert_eq!(
            Project::load(root.path(), None, "gams.json")
                .unwrap()
                .config,
            edited
        );
        assert_eq!(
            serde_json::from_str::<Value>(
                &std::fs::read_to_string(root.path().join("catalog/presets.json")).unwrap()
            )
            .unwrap()["presets"][0]["name"],
            "Node"
        );
    }

    #[test]
    fn rejects_invalid_file_expressions_and_descriptors() {
        for config in [
            r#"{"file":{"$file":null}}"#,
            r#"{"file":{"$file":""}}"#,
            r#"{"file":{"$file":"gams.json","extra":true}}"#,
            r#"{"file":{"$file":{"url":"gams.json","unknown":true}}}"#,
            r#"{"file":{"$file":"missing.lua"}}"#,
            r#"{"file":{"$ref":{"url":"gams.json","pointer":3}}}"#,
        ] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            assert!(
                Project::load(root.path(), None, "gams.json").is_err(),
                "{config}"
            );
        }
    }

    #[test]
    fn session_exposes_progress_and_rejects_inaccessible_local_files() {
        let root = project_root();
        let path = root.path().canonicalize().unwrap();
        let session = Session::new(
            path.clone(),
            "gams.json".into(),
            path.join(MODULES_FOLDER),
            vec![crate::runtime::FsPreopen {
                host_path: path.clone(),
                guest_path: ".".into(),
            }],
        );
        let mut progress = Vec::new();
        session.project(&mut |event| progress.push(event)).unwrap();
        assert_eq!(progress.first().unwrap().status, "resolving");
        assert_eq!(progress.last().unwrap().status, "ready");
        let latest = session.progress();
        assert_eq!(latest.operation_id, progress.last().unwrap().operation_id);
        assert_eq!(latest.discovered, latest.completed);
        let outside = tempfile::NamedTempFile::new().unwrap();
        let result = session.resolve_file(&serde_json::json!(outside.path()), &mut |_| {});
        assert!(format!("{:#}", result.unwrap_err()).contains("filesystem preopens"));
        assert_eq!(session.progress().status, "failed");
        assert!(session.progress().error.is_some());
        assert!(session
            .resolve_file(&serde_json::json!("gams.json"), &mut |_| {})
            .is_ok());
        assert_eq!(session.progress().status, "ready");
    }

    #[test]
    fn remote_zip_catalog_files_and_unit_entries_share_one_offline_installation() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, text) in [
            (
                "config/presets.json",
                r##"{"presets":[{"name":"Sum","codePath":{"$file":"../presets/sum.lua"},"data":{"$ref":"../shared.json#/data"}}]}"##,
            ),
            ("shared.json", r#"{"data":{"value":42}}"#),
            ("presets/sum.lua", "return function() end"),
            ("views/editor.js", "export default {}"),
            ("NOTICE", "Retained notice"),
        ] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        let bytes = zip.finish().unwrap().into_inner();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/nodes.zip", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .unwrap();
            stream.write_all(&bytes).unwrap();
        });
        let root = project_root();
        let original = serde_json::json!({
            "presets": {"$ref":{"url":url,"entry":"config/presets.json","pointer":"/presets"}},
            "view": {"$file":{"url":url,"entry":"views/editor.js"}},
            "directory": {"$file":{"url":url,"entry":"presets"}}
        });
        std::fs::write(root.path().join("gams.json"), original.to_string()).unwrap();
        let project = Project::load(root.path(), None, "gams.json").unwrap();
        server.join().unwrap();
        assert_eq!(project.config["presets"][0]["data"]["value"], 42);
        let code_path = Path::new(project.config["presets"][0]["codePath"].as_str().unwrap());
        assert_eq!(
            std::fs::read_to_string(code_path).unwrap(),
            "return function() end"
        );
        let directory = Path::new(project.config["directory"].as_str().unwrap());
        assert_eq!(directory.join("sum.lua"), code_path);
        let view_path = Path::new(project.config["view"].as_str().unwrap());
        let content = directory.parent().unwrap();
        assert_eq!(view_path, content.join("views/editor.js"));
        assert_eq!(
            std::fs::read_to_string(content.join("NOTICE")).unwrap(),
            "Retained notice"
        );
        let installations = std::fs::read_dir(&project.modules_dir).unwrap().count();
        assert_eq!(installations, 1);
        assert_eq!(
            Project::load(root.path(), None, "gams.json")
                .unwrap()
                .config,
            project.config
        );
        let root_path = root.path().canonicalize().unwrap();
        let mounts = vec![
            crate::runtime::FsPreopen {
                host_path: root_path.clone(),
                guest_path: ".".into(),
            },
            crate::runtime::FsPreopen {
                host_path: project.modules_dir.clone(),
                guest_path: "gams_modules".into(),
            },
        ];
        let session = Session::new(
            root_path,
            "gams.json".into(),
            project.modules_dir.clone(),
            mounts,
        );
        let mut current = session.project(&mut |_| {}).unwrap().config;
        let folder = session
            .resolve_file(
                &serde_json::json!({"url":url,"entry":"presets"}),
                &mut |_| {},
            )
            .unwrap();
        assert!(folder.starts_with("gams_modules/"));
        current["copied"] = Value::String(format!("{folder}/sum.lua"));
        let prepared = session.prepare_config(&current).unwrap();
        assert_eq!(
            prepared["copied"],
            serde_json::json!({"$file":{"url":url,"entry":"presets/sum.lua"}})
        );

        let mut changed = project.config.clone();
        changed["presets"][0]["name"] = Value::String("Renamed".into());
        let saved = project.prepare_config(&changed).unwrap();
        assert_eq!(saved["presets"][0]["codePath"]["$file"]["url"], url);
        assert_eq!(
            saved["presets"][0]["codePath"]["$file"]["entry"],
            "presets/sum.lua"
        );
        std::fs::write(root.path().join("gams.json"), saved.to_string()).unwrap();
        assert_eq!(
            Project::load(root.path(), None, "gams.json")
                .unwrap()
                .config,
            changed
        );
    }

    #[test]
    fn saving_does_not_reconnect_aliases_to_changed_referents() {
        for original in [
            serde_json::json!({"a":1,"b":{"$ref":"#/a"}}),
            serde_json::json!({"a":1,"b":{"$ref":"other.json"}}),
        ] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), original.to_string()).unwrap();
            std::fs::write(
                root.path().join("other.json"),
                r##"{"snapshot":{"$ref":"gams.json#/a"}}"##,
            )
            .unwrap();
            let project = Project::load(root.path(), None, "gams.json").unwrap();
            let mut edited = project.config.clone();
            edited["a"] = serde_json::json!(2);
            let saved = project.prepare_config(&edited).unwrap();
            std::fs::write(root.path().join("gams.json"), saved.to_string()).unwrap();
            assert_eq!(
                Project::load(root.path(), None, "gams.json")
                    .unwrap()
                    .config,
                edited
            );
        }
    }

    #[test]
    fn shared_resources_use_the_same_relative_guest_paths_for_config_fs_and_wasm() {
        let root = project_root();
        let shared = tempfile::tempdir().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let shared_path = shared.path().canonicalize().unwrap();
        let file = shared_path.join("plugin.fs.wasm");
        std::fs::write(&file, b"\0asm\x0d\0\x01\0").unwrap();
        let original = serde_json::json!({"plugin":{"$file":file}});
        std::fs::write(root.path().join("gams.json"), original.to_string()).unwrap();
        let mounts = vec![
            crate::runtime::FsPreopen {
                host_path: root_path.clone(),
                guest_path: ".".into(),
            },
            crate::runtime::FsPreopen {
                host_path: shared_path.clone(),
                guest_path: "gams_modules".into(),
            },
        ];
        let session = Session::new(
            root_path.clone(),
            "gams.json".into(),
            shared_path,
            mounts.clone(),
        );
        let project = session.project(&mut |_| {}).unwrap();
        assert_eq!(project.config["plugin"], "gams_modules/plugin.fs.wasm");
        let guest = session
            .resolve_file(&project.config["plugin"], &mut |_| {})
            .unwrap();
        assert_eq!(guest, "gams_modules/plugin.fs.wasm");
        assert_eq!(
            crate::runtime::host_path(&root_path, &mounts, &guest).unwrap(),
            file
        );
        let runtime = crate::runtime::Runtime::new_at(root_path, mounts).unwrap();
        assert_eq!(runtime.add_plugins(vec![guest], false).unwrap().len(), 1);
        assert_eq!(project.prepare_config(&project.config).unwrap(), original);
    }

    fn project_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("gams.json"), r#"{"plugins":[]}"#).unwrap();
        root
    }

    #[test]
    fn reads_config_without_a_filesystem_plugin_and_creates_local_modules() {
        let root = project_root();
        let project = Project::load(root.path(), None, "gams.json").unwrap();
        assert_eq!(project.config, serde_json::json!({"plugins": []}));
        assert_eq!(
            project.modules_dir,
            root.path().join(MODULES_FOLDER).canonicalize().unwrap()
        );
        assert!(project.modules_dir.is_dir());
    }

    #[test]
    fn creates_and_selects_shared_modules_without_local_fallback() {
        let root = project_root();
        let shared = tempfile::tempdir().unwrap();
        let path = shared.path().join("units");
        let project = Project::load(root.path(), Some(path.as_os_str()), "gams.json").unwrap();
        assert_eq!(project.modules_dir, path.canonicalize().unwrap());
        assert!(!root.path().join(MODULES_FOLDER).exists());
    }

    #[test]
    fn rejects_invalid_config_before_creating_modules() {
        for config in ["[1]", "null", "{"] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            assert!(Project::load(root.path(), None, "gams.json").is_err());
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    #[test]
    fn rejects_empty_relative_and_file_module_paths() {
        let root = project_root();
        for path in [OsStr::new(""), OsStr::new("relative/units")] {
            assert!(Project::load(root.path(), Some(path), "gams.json").is_err());
        }
        let file = root.path().join("gams.json");
        assert!(Project::load(root.path(), Some(file.as_os_str()), "gams.json").is_err());
    }
}
