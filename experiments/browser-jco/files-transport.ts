// Browser implementation of the canonical Runtime's transport boundary.
// No Tauri global, filesystem mock, or server computation is involved.
type Report = (message: string) => void;
type Reply = { result: any; storage: string; durationMs: number; checkpointMs: number };

export const projectConfig = {
  plugins: ['components/plugin.fs.wasm'],
  ui: {
    views: {
      'view-files': { url: '/units/view.files/views/view-files.js', label: 'Files', internal: false,
        config: { open: { default: 'files-default' } } },
      'files-rename': { url: '/units/view.files/views/files-rename.js', label: 'Create / rename', internal: true },
      'files-default': { url: '/units/view.files/views/files-default.js', label: 'File metadata', internal: true },
    },
  },
};

class FilesSession {
  readonly worker = new Worker('/vendor/transpiler-worker.js', { type: 'module' });
  readonly ready: Promise<void>;
  private pending = new Map<number, { resolve(value: Reply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private late = new Set<number>();
  private sequence = 0;
  private closed = false;
  private closing = false;
  private blocked = false;
  private cancelReady: (error: Error) => void;
  private report: Report;
  constructor(report: Report) {
    this.report = report;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.blocked = true;
        reject(new Error('Compiler initialization timed out; worker retained. Use explicit force stop if needed.'));
      }, 30000);
      this.cancelReady = error => { clearTimeout(timer); reject(error); };
      this.worker.onerror = event => this.fail(new Error(`Worker failure: ${event.message}`));
      this.worker.onmessage = ({ data }) => {
        if (this.closed) return;
        if (data.event === 'ready') {
          clearTimeout(timer);
          this.report(`Jco initialized in ${data.initializationMs.toFixed(1)} ms`);
          resolve();
          return;
        }
        if (data.event === 'fatal') { this.fail(new Error(data.error)); return; }
        if (data.event) { this.fail(new Error(`Unexpected worker event: ${data.event}`)); return; }
        const request = this.pending.get(data.id);
        if (!request && this.late.delete(data.id)) return;
        if (!request) { this.fail(new Error(`Unexpected worker reply: ${data.id}`)); return; }
        this.pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.error) { request.reject(new Error(data.error)); return; }
        if (!['none', 'memory', 'opfs'].includes(data.storage) || !Number.isFinite(data.checkpointMs)) {
          request.reject(new Error('Malformed worker checkpoint acknowledgement.'));
          return;
        }
        request.resolve(data);
      };
    });
  }
  private fail(error: Error) {
    this.blocked = true;
    this.cancelReady(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.report(error.message);
  }
  private rpc(operation: string, args: unknown = {}): Promise<Reply> {
    if (this.closed || ((this.closing || this.blocked) && operation !== 'shutdown')) {
      return Promise.reject(new Error('Filesystem session is closing or blocked; no new operations are permitted.'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.late.add(id);
        this.blocked = true;
        reject(new Error('Filesystem operation timed out. Worker retained; in-flight persistence is unconfirmed.'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, operation, args });
    });
  }
  async open() {
    await this.ready;
    this.report('Loading unchanged plugin.fs v0.2.3');
    const response = await fetch('/components/plugin.fs.wasm');
    if (!response.ok) throw new Error(`Component download failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const generated = await this.rpc('transpile', { bytes });
    if (!generated.result.exports.some(([name]: [string, string]) => name === 'gams:fs/fs@1.2.0')) {
      throw new Error('Component does not export gams:fs/fs@1.2.0.');
    }
    this.report(`Browser transpilation: ${generated.durationMs.toFixed(1)} ms; ${generated.result.files.length} in-memory files`);
    const instantiated = await this.rpc('instantiate', { grantLogging: false, grantFilesystem: true, filesystemMode: 'opfs' });
    if (instantiated.storage !== 'opfs') throw new Error('Filesystem did not open in OPFS mode.');
    this.report(`plugin.fs instantiated in ${instantiated.durationMs.toFixed(1)} ms; OPFS checkpoint complete`);
  }
  async invoke(target: string, args: unknown[]) {
    const response = await this.rpc('invoke-filesystem', { target, values: args });
    this.report(`${target}: ${response.durationMs.toFixed(1)} ms; checkpoint ${response.checkpointMs.toFixed(1)} ms`);
    return response.result;
  }
  async close() {
    this.closing = true;
    try {
      await this.rpc('shutdown');
    } catch (error) {
      this.closing = false;
      throw error;
    }
    this.closed = true;
    this.worker.terminate();
    this.report('Guest stopped; OPFS disposed/checkpointed.');
  }
  forceStop() {
    this.closed = true;
    this.worker.terminate();
    this.cancelReady(new Error('Worker explicitly force-stopped.'));
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Forced stop: in-flight changes may be lost or partially persisted.'));
    }
    this.pending.clear();
  }
}

let session: FilesSession | null = null;
let opened = false;
let callViewListener: ((event: unknown) => void) | null = null;
let callViewReady = false;

export async function openSession(report: Report) {
  if (session) throw new Error('Close the existing filesystem session before opening another.');
  session = new FilesSession(report);
  await session.open();
  opened = true;
}
export async function closeSession() {
  if (!session) throw new Error('No filesystem session to close.');
  await session.close();
  session = null;
  opened = false;
}
export function forceStopSession() {
  if (!session) throw new Error('No filesystem session to force-stop.');
  session.forceStop();
  session = null;
  opened = false;
}
export function hasSession() { return session !== null; }

// These are the only native-boundary commands exercised by this fixed shell.
// Unimplemented Host facilities reject instead of pretending to work.
export async function invokeCommand(command: string, args: any) {
  if (command === 'runtime_project') {
    if (!opened) throw new Error('Open/grant the browser filesystem before initializing the Host Runtime.');
    return { config: projectConfig, configFile: 'browser-files.json', modulesDir: '/units' };
  }
  if (command === 'runtime_call_view_ready') {
    if (!callViewListener) throw new Error('Call-view listener must be registered before readiness.');
    callViewReady = true;
    return;
  }
  if (command === 'runtime_invoke') {
    if (!session || !opened || !callViewReady) throw new Error('Browser filesystem Runtime is not ready.');
    return await session.invoke(args.target, args.args);
  }
  throw new Error(`Unsupported browser experiment command: ${command}`);
}
export async function listenEvent(name: string, callback: (event: unknown) => void) {
  if (name !== 'gams-runtime-call-view' || callViewListener !== null || typeof callback !== 'function') {
    throw new Error(`Unsupported or duplicate browser Runtime event registration: ${name}`);
  }
  // plugin.fs has no component-to-View import, so it produces no such events.
  // Preserve the real Runtime's registration/readiness handshake without Tauri.
  callViewListener = callback;
  return () => { callViewListener = null; callViewReady = false; };
}
export function createProgressChannel(onProgress: (snapshot: unknown) => void) {
  if (typeof onProgress !== 'function') throw new Error('Progress callback must be a function.');
  return { onmessage: onProgress };
}
