function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element: ${id}`);
  return value as T;
}
const status = element('status');
const diagnostics = element('diagnostics');
const metrics = element('metrics');
const files = element('files');
const results = element('results');
const logs = element('logs');
const grant = element<HTMLInputElement>('grant');
const filesystemGrant = element<HTMLInputElement>('grant-fs');
const filesystemMode = element<HTMLSelectElement>('fs-mode');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-operation]')];
let bytes: Uint8Array | undefined;
let ready = false;
let busy = false;
let stalled = false;
let stage = 'empty';
let exportedNames = new Set<string>();
let worker: Worker;
let sequence = 0;
let hostLogCount = 0;
const measurements: Record<string, unknown> = {};
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const timedOut = new Set<number>();

function showMetrics() { metrics.textContent = JSON.stringify(measurements, null, 2); }
function update() {
  for (const button of buttons) {
    const op = button.dataset.operation;
    const wrongExports = op && op.startsWith('persistence-') ? !exportedNames.has('gams:fs/fs@1.2.0') || filesystemMode.value !== 'opfs' || !filesystemGrant.checked
      : op === 'flush' ? !filesystemGrant.checked
      : op === 'check-random' ? !exportedNames.has('gams:random/seeded-random@1.0.0')
      : op === 'check-filesystem' ? !exportedNames.has('gams:fs/fs@1.2.0')
      : op === 'call' ? !exportedNames.has('add') || !exportedNames.has('greet')
      : op === 'benchmark' ? !exportedNames.has('add') : false;
    button.disabled = busy || stalled || !ready || wrongExports || (op === 'transpile' ? !bytes : op === 'instantiate' ? stage !== 'transpiled' && stage !== 'instantiated' : stage !== 'instantiated');
  }
  element<HTMLButtonElement>('load').disabled = busy || stalled;
  element<HTMLInputElement>('upload').disabled = busy || stalled;
  element<HTMLButtonElement>('reset').disabled = busy || stalled || !ready;
  grant.disabled = busy || stalled;
  filesystemGrant.disabled = busy || stalled;
  filesystemMode.disabled = busy || stalled;
}
function startWorker(reason = 'Worker restarted after checkpoint.') {
  if (worker) worker.terminate();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  pending.clear();
  timedOut.clear();
  stalled = false;
  ready = false;
  stage = bytes ? 'loaded' : 'empty';
  exportedNames.clear();
  files.textContent = '';
  results.textContent = '';
  logs.textContent = '';
  hostLogCount = 0;
  grant.checked = false;
  filesystemGrant.checked = false;
  filesystemMode.value = 'memory';
  element('storage').textContent = 'No filesystem session. OPFS data is not deleted by reset.';
  diagnostics.textContent = '';
  for (const key of Object.keys(measurements)) delete measurements[key];
  showMetrics();
  status.textContent = 'Initializing Jco worker…';
  worker = new Worker('./vendor/transpiler-worker.js', { type: 'module' });
  const activeWorker = worker;
  worker.onerror = event => {
    if (worker !== activeWorker) return;
    diagnostics.textContent = `Worker failure: ${event.message}. Force stop may lose in-flight writes.`;
    ready = false;
    stalled = true;
    update();
  };
  worker.onmessage = ({ data }) => {
    if (worker !== activeWorker) return;
    if (data.event === 'ready') {
      ready = true;
      measurements.jcoInitializationMs = data.initializationMs;
      status.textContent = bytes ? 'Component loaded; ready to transpile.' : 'Jco ready. Load a component.';
      showMetrics(); update();
    } else if (data.event === 'fatal') {
      ready = false;
      stalled = true;
      status.textContent = 'Jco initialization failed.';
      diagnostics.textContent = data.error;
      update();
    } else if (data.event === 'host-log') {
      hostLogCount++;
      logs.textContent = `Browser host log(${data.value}); received ${hostLogCount} call(s)`;
    } else {
      const request = pending.get(data.id);
      if (!request && timedOut.delete(data.id)) return;
      if (!request) throw new Error(`Unexpected worker response ${data.id}`);
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else if (!['none', 'memory', 'opfs'].includes(data.storage) || !Number.isFinite(data.checkpointMs)) {
        request.reject(new Error('Malformed worker checkpoint acknowledgement.'));
      } else {
        element('storage').textContent = data.storage === 'opfs'
          ? 'OPFS checkpoint complete: gams-browser-jco-experiment-v1 → /project. Persistent across worker/page restarts.'
          : data.storage === 'memory' ? 'In-memory /project: disposable.' : 'No filesystem session.';
        measurements.checkpointMs = data.checkpointMs;
        request.resolve(data);
      }
    }
  };
  update();
}
async function restartWorker() {
  if (worker) await request('shutdown');
  startWorker();
}
function request(operation: string, args: unknown = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      timedOut.add(id);
      stalled = true;
      reject(new Error('30-second limit exceeded. Worker retained: persistence is unconfirmed. Force stop may lose in-flight writes.'));
      update();
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, operation, args });
  });
}
async function action(run: () => Promise<void>) {
  busy = true; diagnostics.textContent = ''; update();
  try { await run(); }
  catch (error) {
    diagnostics.textContent = String(error);
    console.error(error);
    status.textContent = 'Operation failed. See diagnostics.';
  } finally { busy = false; showMetrics(); update(); }
}
async function load(value: Uint8Array, name: string, loadMs: number) {
  await restartWorker(); // Checkpoint/dispose before revoking the old session.
  bytes = value;
  stage = 'loaded';
  measurements.componentLoadMs = loadMs;
  measurements.componentBytes = bytes.byteLength;
  element('loaded').textContent = `${name}: ${bytes.byteLength} bytes; header ${[...bytes.slice(0, 8)].map(v => v.toString(16).padStart(2, '0')).join(' ')}`;
}
element('reset').onclick = () => action(() => restartWorker());
element('force').onclick = () => {
  const warning = 'Forced stop: in-flight changes may be lost or partially persisted. The last checkpoint is the last confirmed state, not a rollback snapshot.';
  startWorker(warning);
  diagnostics.textContent = warning;
};
element('load').onclick = () => action(async () => {
  const start = performance.now();
  const name = element<HTMLSelectElement>('sample').value;
  const response = await fetch(`./components/${name}.wasm`);
  if (!response.ok) throw new Error(`Component download failed: ${response.status}`);
  await load(new Uint8Array(await response.arrayBuffer()), name, performance.now() - start);
});
element<HTMLInputElement>('upload').onchange = event => action(async () => {
  const selected = (event.target as HTMLInputElement).files;
  if (!selected || selected.length === 0) return;
  if (selected[0].size > 16 * 1024 * 1024) throw new Error('Experiment input limit: 16 MiB.');
  const start = performance.now();
  await load(new Uint8Array(await selected[0].arrayBuffer()), selected[0].name, performance.now() - start);
});
grant.onchange = filesystemGrant.onchange = filesystemMode.onchange = () => {
  if (stage === 'instantiated') stage = 'transpiled';
  update();
};
for (const button of buttons) button.onclick = () => action(async () => {
  const operation = button.dataset.operation;
  if (operation === 'transpile') {
    stage = 'loaded'; files.textContent = ''; results.textContent = '';
    status.textContent = 'Transpiling in browser worker…';
    const response = await request('transpile', { bytes });
    measurements.transpilationMs = response.durationMs;
    measurements.generatedBytes = response.result.files.reduce((sum: number, file: any) => sum + file.bytes, 0);
    files.textContent = JSON.stringify(response.result, null, 2);
    exportedNames = new Set(response.result.exports.map(([name]: [string, string]) => name));
    stage = 'transpiled'; status.textContent = 'Transpilation complete.';
  } else if (operation === 'instantiate') {
    stage = 'transpiled';
    const response = await request('instantiate', {
      grantLogging: grant.checked, grantFilesystem: filesystemGrant.checked, filesystemMode: filesystemMode.value,
    });
    measurements.instantiationMs = response.durationMs;
    delete measurements.firstAddMs;
    delete measurements.greetMs;
    delete measurements.repeatedExecution;
    stage = 'instantiated'; status.textContent = `Instantiated: ${response.result.exports.join(', ')}`;
  } else if (operation === 'call') {
    const add = await request('call', { name: 'add', values: [10, 20] });
    const greet = await request('call', { name: 'greet', values: ['GAMS'] });
    if (!('firstAddMs' in measurements)) measurements.firstAddMs = add.durationMs;
    measurements.greetMs = greet.durationMs;
    results.textContent = JSON.stringify({ add: add.result, greet: greet.result }, null, 2);
    status.textContent = 'Exports executed in browser.';
  } else if (operation === 'check-random' || operation === 'check-filesystem') {
    const response = await request(operation);
    measurements.pluginChecksMs = response.durationMs;
    results.textContent = JSON.stringify(response.result, null, 2);
    status.textContent = 'Plugin checks passed in browser.';
  } else if (operation === 'flush') {
    const response = await request('flush');
    measurements.flushMs = response.durationMs;
    status.textContent = 'Filesystem checkpoint complete.';
  } else if (operation && operation.startsWith('persistence-')) {
    const response = await request('persistence', { action: operation.slice('persistence-'.length) });
    measurements.persistenceCheckMs = response.durationMs;
    results.textContent = JSON.stringify(response.result, null, 2);
    status.textContent = 'OPFS persistence check passed; checkpoint complete.';
  } else if (operation === 'benchmark') {
    const response = await request('benchmark');
    measurements.repeatedExecution = { ...response.result, meanMs: response.result.totalMs / response.result.count };
  }
  const memory = (performance as any).memory;
  measurements.mainThreadJsHeapBytes = memory ? memory.usedJSHeapSize : 'Unavailable';
});
element('compatibility').textContent = JSON.stringify({
  userAgent: navigator.userAgent, jco: '1.42.0', backend: '0.24.0', preview2Shim: '0.31.1',
  webAssembly: typeof WebAssembly !== 'undefined', moduleWorker: typeof Worker !== 'undefined',
  blobModules: typeof URL.createObjectURL === 'function', crossOriginIsolated,
  jspi: typeof (WebAssembly as any).Suspending === 'function',
  opfs: typeof navigator.storage?.getDirectory === 'function', webLocks: !!navigator.locks,
  note: 'Heap excludes worker/Wasm memory. Filesystem grant: memory or isolated OPFS /project; no native disk or network.',
}, null, 2);
startWorker();
