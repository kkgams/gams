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
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-operation]')];
let bytes: Uint8Array | undefined;
let ready = false;
let busy = false;
let stage = 'empty';
let worker: Worker;
let sequence = 0;
let hostLogCount = 0;
const measurements: Record<string, unknown> = {};
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function showMetrics() { metrics.textContent = JSON.stringify(measurements, null, 2); }
function update() {
  for (const button of buttons) {
    const op = button.dataset.operation;
    button.disabled = busy || !ready || (op === 'transpile' ? !bytes : op === 'instantiate' ? stage !== 'transpiled' && stage !== 'instantiated' : stage !== 'instantiated');
  }
  element<HTMLButtonElement>('load').disabled = busy;
  element<HTMLInputElement>('upload').disabled = busy;
  grant.disabled = busy;
}
function reset() {
  if (worker) worker.terminate();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('Worker reset; instance and generated output discarded.'));
  }
  pending.clear();
  ready = false;
  stage = bytes ? 'loaded' : 'empty';
  files.textContent = '';
  results.textContent = '';
  logs.textContent = '';
  hostLogCount = 0;
  grant.checked = false;
  diagnostics.textContent = '';
  for (const key of Object.keys(measurements)) delete measurements[key];
  showMetrics();
  status.textContent = 'Initializing Jco worker…';
  worker = new Worker('./vendor/transpiler-worker.js', { type: 'module' });
  worker.onerror = event => {
    diagnostics.textContent = `Worker failure: ${event.message}`;
    ready = false;
    update();
  };
  worker.onmessage = ({ data }) => {
    if (data.event === 'ready') {
      ready = true;
      measurements.jcoInitializationMs = data.initializationMs;
      status.textContent = bytes ? 'Component loaded; ready to transpile.' : 'Jco ready. Load a component.';
      showMetrics(); update();
    } else if (data.event === 'fatal') {
      ready = false;
      status.textContent = 'Jco initialization failed.';
      diagnostics.textContent = data.error;
      update();
    } else if (data.event === 'host-log') {
      hostLogCount++;
      logs.textContent = `Browser host log(${data.value}); received ${hostLogCount} call(s)`;
    } else {
      const request = pending.get(data.id);
      if (!request) throw new Error(`Unexpected worker response ${data.id}`);
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data);
    }
  };
  update();
}
function request(operation: string, args: unknown = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      reset();
      diagnostics.textContent = '30-second operation limit exceeded. Worker terminated.';
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
  bytes = value;
  reset(); // Loading a new component revokes the previous component's capabilities.
  measurements.componentLoadMs = loadMs;
  measurements.componentBytes = bytes.byteLength;
  element('loaded').textContent = `${name}: ${bytes.byteLength} bytes; header ${[...bytes.slice(0, 8)].map(v => v.toString(16).padStart(2, '0')).join(' ')}`;
}
element('reset').onclick = () => reset();
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
grant.onchange = () => {
  // Reinstantiation is required for any capability change.
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
    stage = 'transpiled'; status.textContent = 'Transpilation complete.';
  } else if (operation === 'instantiate') {
    stage = 'transpiled';
    const response = await request('instantiate', { grantLogging: grant.checked });
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
  note: 'Heap diagnostic excludes worker/Wasm memory. No WASI capabilities granted to uploaded components.',
}, null, 2);
reset();
