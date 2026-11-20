import { DirectOpfsStore } from './opfs-store.ts';
import { directFilesystemAdapter } from './opfs-filesystem.ts';
import { BrowserProject } from './browser-project';
import { BrowserComponents } from './browser-components';
import type { BrowserOptions } from './browser-options';

let store: DirectOpfsStore | undefined;
let project: BrowserProject | undefined;
let components: BrowserComponents | undefined;
let stopped = false;
let ready = false;
let closing = false;
let activeId = 0;
// Ordering within this one session is not a cross-instance filesystem lock.
let queue = Promise.resolve();
type Request = { id:number; command:string; args:any; callbackId?:string };
type Callback = { resolve(value:string):void; reject(error:Error):void; queue:Promise<void>; downloads:Set<Promise<void>> };
const downloads = new Set<Promise<void>>();
const callbacks = new Map<string,Callback>();
let nextCallback = 1;
self.onmessage = ({ data }) => { void dispatch(data); };
function dispatch(data: Request): Promise<void> {
  // Replies must not wait behind the guest currently awaiting that reply.
  if (data.command === 'runtime_call_view_response') return handle(data);
  const nested = data.callbackId === undefined ? undefined : callbacks.get(data.callbackId);
  if (data.callbackId !== undefined && (!nested || !['runtime_invoke','runtime_release_resource','runtime_resolve_file','runtime_download','runtime_prepare_config','runtime_resolution_progress','runtime_diagnostics'].includes(data.command))) {
    postMessage({id:data.id,error:!nested ? 'Unknown Runtime callback context' : 'Denied command during Runtime callback'});
    return Promise.resolve();
  }
  if (data.command === 'runtime_download') {
    if (closing && !nested) {
      postMessage({id:data.id,error:stopped ? 'Browser Host session is stopped. Reload to reopen.' : 'Browser Host session is closing.'});
      return Promise.resolve();
    }
    if (ready) {
      // A byte download doesn't touch the Project tree or set its progress ID.
      const job = download(data);
      downloads.add(job);
      nested?.downloads.add(job);
      return job.finally(() => {
        downloads.delete(job);
        nested?.downloads.delete(job);
      });
    }
  }
  if (data.command === 'runtime_shutdown') closing = true;
  // Each callback has a serial nested lane for operations on the Project.
  if (nested) return nested.queue = nested.queue.then(() => handle(data));
  return queue = queue.then(() => handle(data));
}
async function download({id, args}: Request): Promise<void> {
  const started = performance.now();
  try {
    if (!ready || !project) throw new Error('Browser Host Project is not ready.');
    const bytes = await project.download(args.url, progress => postMessage({event:'download-progress', id, progress}));
    postMessage({id,result:Array.from(bytes),durationMs:performance.now()-started});
  } catch (error) {
    postMessage({id,error:error instanceof Error ? error.message : String(error)});
  }
}
function callView(target: string, args: string): Promise<string> {
  const id = `view-call:${nextCallback++}`;
  return new Promise((resolve,reject) => {
    callbacks.set(id,{resolve,reject,queue:Promise.resolve(),downloads:new Set()});
    postMessage({event:'call-view',payload:{id,target,args}});
  });
}
async function respond(args: any): Promise<void> {
  const pending = callbacks.get(args.id);
  if (!pending) throw new Error('Unknown Runtime callback response');
  const ok = args.ok !== null && args.ok !== undefined;
  const err = args.err !== null && args.err !== undefined;
  if (ok === err) throw new Error('Runtime callback response requires exactly one of ok or err');
  if (typeof (ok ? args.ok : args.err) !== 'string') throw new Error('Runtime callback response must be a string');
  callbacks.delete(args.id);
  await Promise.all([pending.queue,...pending.downloads]);
  if (err) pending.reject(new Error(args.err));
  else pending.resolve(args.ok);
}
async function handle(data: Request) {
  const { id, command, args } = data;
  const started = performance.now();
  try {
    if (command === 'runtime_call_view_response') {
      await respond(args);
      postMessage({id,result:null,durationMs:performance.now()-started});
      return; // A reply mutates no files.
    }
    if (stopped) {
      if (command !== 'runtime_shutdown') throw new Error('Browser Host session is stopped. Reload to reopen.');
      // A timed-out shutdown may finish after the caller stopped awaiting it.
      // Repeated shutdown must acknowledge that durable completion for retry.
      postMessage({id,result:{closed:true},durationMs:performance.now()-started});
      return;
    }
    if (command === 'runtime_download') return download(data);
    activeId = id;
    let result: unknown;
    if (command === 'runtime_shutdown') {
      await Promise.all(downloads);
      if (components) await components.close();
      result = {closed:true};
    } else if (command === 'runtime_project') {
      if (project) throw new Error('Browser Host Project is already initialized.');
      const options = args.options as BrowserOptions;
      const direct = store = await DirectOpfsStore.open();
      await store.mkdir(options.cwd);
      await store.mkdir(options.modulesDir);
      await store.mkdir(options.pluginCacheDir);
      project = new BrowserProject(store, options);
      project.onProgress = snapshot => postMessage({ event:'resolution-progress', id:activeId, snapshot });
      result = await project.load();
      components = new BrowserComponents(store, options, {filesystem: async (cwd, modules) => {
        const {createFilesystem} = await import('@bytecodealliance/preview2-shim/filesystem');
        return createFilesystem({adapter:directFilesystemAdapter(direct), preopens:{'.':cwd, '/project':cwd, 'gams_modules':modules}});
      }});
      components.callView = callView;
    } else {
      if (!project || !store || !components) throw new Error('Browser Host Project is not ready.');
      switch (command) {
        case 'runtime_add_plugins': result = await components.add(args.paths, args.reload); break;
        case 'runtime_load_from_bytes': result = await components.loadFromBytes(Uint8Array.from(args.bytes), args.path); break;
        case 'runtime_invoke': result = await components.invoke(args.target, args.args); break;
        case 'runtime_release_resource': await components.releaseResource(args.resource); result = null; break;
        case 'runtime_resolve_file': result = await project.resolveFile(args.source); break;
        case 'runtime_prepare_config': result = await project.prepareConfig(args.config); break;
        case 'runtime_resolution_progress': result = project.progress; break;
        case 'runtime_diagnostics': result = {...await components.diagnostics(), directOpfs:{...store.metrics}}; break;
        case 'runtime_clear_compiled_component_cache': result = await components.clearCache(); break;
        default: throw new Error(`Unsupported browser Host command: ${command}`);
      }
    }
    if (command === 'runtime_project') ready = true;
    if (command === 'runtime_shutdown') { await store?.close(); stopped = true; }
    postMessage({ id, result, durationMs:performance.now()-started });
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}
