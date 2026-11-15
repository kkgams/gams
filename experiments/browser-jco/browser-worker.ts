import { BrowserStore } from './browser-storage';
import { BrowserProject } from './browser-project';
import { BrowserComponents } from './browser-components';
import type { BrowserOptions } from './browser-options';

let store: BrowserStore | undefined;
let project: BrowserProject | undefined;
let components: BrowserComponents | undefined;
let stopped = false;
let activeId = 0;
// Ordering within this one session is not a cross-instance filesystem lock.
let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
async function handle({ id, command, args }: { id:number;command:string;args:any }) {
  const started = performance.now();
  try {
    if (stopped) {
      if (command !== 'runtime_shutdown') throw new Error('Browser Host session is stopped. Reload to reopen.');
      // A timed-out shutdown may finish after the caller stopped awaiting it.
      // Repeated shutdown must acknowledge that durable completion for retry.
      postMessage({id,result:{closed:true},durationMs:performance.now()-started});
      return;
    }
    activeId = id;
    let result: unknown;
    if (command === 'runtime_shutdown') {
      if (components) await components.close();
      result = {closed:true};
    } else if (command === 'runtime_project') {
      if (project) throw new Error('Browser Host Project is already initialized.');
      const options = args.options as BrowserOptions;
      store = await BrowserStore.open();
      await store.mkdir(options.cwd);
      await store.mkdir(options.modulesDir);
      await store.mkdir(options.pluginCacheDir);
      project = new BrowserProject(store, options);
      project.onProgress = snapshot => postMessage({ event:'resolution-progress', id:activeId, snapshot });
      result = await project.load();
      components = new BrowserComponents(store, options);
    } else {
      if (!project || !store || !components) throw new Error('Browser Host Project is not ready.');
      switch (command) {
        case 'runtime_add_plugins': result = await components.add(args.paths, args.reload); break;
        case 'runtime_load_from_bytes': result = await components.loadFromBytes(Uint8Array.from(args.bytes), args.path); break;
        case 'runtime_invoke': result = await components.invoke(args.target, args.args); break;
        case 'runtime_resolve_file': result = await project.resolveFile(args.source); break;
        case 'runtime_download': result = Array.from(await project.download(args.url, progress => postMessage({event:'download-progress', id, progress}))); break;
        case 'runtime_prepare_config': result = await project.prepareConfig(args.config); break;
        case 'runtime_resolution_progress': result = project.progress; break;
        case 'runtime_diagnostics': result = await components.diagnostics(); break;
        case 'runtime_clear_compiled_component_cache': result = await components.clearCache(); break;
        default: throw new Error(`Unsupported browser Host command: ${command}`);
      }
    }
    // Host writes and WASI calls mutate one shared tree. Never acknowledge a
    // successful operation before the injected storage has checkpointed it.
    if (store) await store.flush();
    if (command === 'runtime_shutdown') stopped = true;
    postMessage({ id, result, durationMs:performance.now()-started });
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}
