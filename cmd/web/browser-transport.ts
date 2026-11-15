import { parseBrowserOptions } from './browser-options.ts';

const environmentResponse = await fetch('/browser-environment.json', {cache:'no-store',credentials:'omit'});
if (!environmentResponse.ok) throw new Error(`Browser environment could not load: HTTP ${environmentResponse.status}. Rebuild the web assets.`);
const environment = await environmentResponse.json();
if (!environment || typeof environment !== 'object' || Array.isArray(environment) ||
    Object.keys(environment).length !== 1 || !Object.hasOwn(environment,'corsProxy')) {
  throw new Error('Malformed browser build environment.');
}
export function getStartupOptions() { return parseBrowserOptions(location.href,environment); }

type Progress = { onmessage(snapshot: unknown): void };
type Pending = { resolve(value:unknown):void; reject(error:Error):void; timer:ReturnType<typeof setTimeout>; progress?:Progress };
class BrowserSession {
  readonly worker = new Worker('/vendor/browser-worker.js', {type:'module'});
  private sequence = 0;
  private pending = new Map<number,Pending>();
  private late = new Set<number>();
  private blocked = false;
  private closing = false;
  private projectProgress?: Progress;
  constructor() {
    this.worker.onerror = event => {
      this.blocked = true;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Browser Host worker failed: ${event.message}`)); }
      this.pending.clear();
    };
    this.worker.onmessage = ({data}) => {
      if (data.event === 'resolution-progress') {
        const progress = this.pending.get(data.id)?.progress ?? this.projectProgress;
        progress?.onmessage(data.snapshot);
        return;
      }
      if (data.event === 'download-progress') { this.pending.get(data.id)?.progress?.onmessage(data.progress); return; }
      if (data.event) throw new Error(`Unknown browser Host event: ${data.event}`);
      const item = this.pending.get(data.id);
      if (!item && this.late.delete(data.id)) return;
      if (!item) throw new Error(`Unexpected browser Host response: ${data.id}`);
      clearTimeout(item.timer); this.pending.delete(data.id);
      if (data.error !== undefined) item.reject(new Error(data.error));
      else item.resolve(data.result);
    };
  }
  request(command:string, args:any = {}) {
    if ((this.blocked || this.closing) && command !== 'runtime_shutdown') return Promise.reject(new Error('Browser Host is blocked/closing. Close or explicitly force stop before reload.'));
    const {onProgress, ...values} = args;
    if (command === 'runtime_project') this.projectProgress = onProgress;
    if (command === 'runtime_shutdown') this.closing = true;
    return new Promise((resolve,reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id); this.late.add(id); this.blocked = true;
        reject(new Error('Browser Host request timed out. Worker retained; persistence is unconfirmed.'));
      },180000);
      this.pending.set(id,{resolve,reject,timer,progress:onProgress});
      this.worker.postMessage({id,command,args:values});
    });
  }
  forceStop() {
    this.worker.terminate();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser Host force-stopped; in-flight changes may be lost.')); }
    this.pending.clear();
  }
}
let session: BrowserSession | undefined;
let stopped = false;
let listener: ((event:unknown)=>void) | undefined;
let viewReady = false;

export async function invokeCommand(command:string,args:any = {}) {
  if (command === 'runtime_call_view_ready') {
    if (!listener) throw new Error('Register the call-view listener before readiness.');
    viewReady = true; return;
  }
  if (command === 'runtime_call_view_response') throw new Error('No browser component-to-View callback is pending.');
  if (stopped) throw new Error('Browser Host was stopped. Reload to reopen.');
  if (command === 'runtime_project') {
    if (session) throw new Error('Browser Host already has a Project session.');
    const options = getStartupOptions();
    session = new BrowserSession();
    return await session.request(command,{...args,options});
  }
  if (!session) throw new Error('Browser Host Project is not initialized.');
  if (command === 'runtime_invoke' && !viewReady) throw new Error('Browser Runtime is not ready.');
  return await session.request(command,args);
}
export async function listenEvent(name:string,callback:(event:unknown)=>void) {
  if (name !== 'gams-runtime-call-view' || listener || typeof callback !== 'function') throw new Error(`Unsupported/duplicate browser Runtime event: ${name}`);
  listener = callback;
  return () => {listener=undefined;viewReady=false;};
}
export function createProgressChannel(onProgress:(snapshot:unknown)=>void) {
  if (typeof onProgress !== 'function') throw new Error('Progress callback must be a function.');
  return {onmessage:onProgress};
}
export function hasBrowserSession() {return session !== undefined;}
export async function closeBrowserSession() {
  if (!session) throw new Error('No browser Host session to close.');
  await session.request('runtime_shutdown');
  session.worker.terminate(); session=undefined;stopped=true;
}
export function forceStopBrowserSession() {
  if (!session) throw new Error('No browser Host session to force stop.');
  session.forceStop();session=undefined;stopped=true;
}
