import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
async function transport(t, href = 'http://127.0.0.1:8093/browser.html', environment = {corsProxy:null}) {
  const workers = [], timers = new Map();
  let timerId = 0;
  class Worker {
    messages = [];
    terminated = false;
    constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
    // Model the real Worker boundary: callbacks must not enter the payload.
    postMessage(message) { this.messages.push(structuredClone(message)); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
    reply(data = {}) { this.emit({ id: this.messages.at(-1).id, ...data }); }
  }
  const originals = new Map();
  for (const [name, value] of Object.entries({
    Worker, location: { href },
    fetch: async (url, options) => {
      assert.equal(url, '/browser-environment.json');
      assert.equal(options.cache, 'no-store');
      return {ok:true,json:async()=>environment};
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let api;
  t.after(() => {
    try { if (api?.hasBrowserSession()) api.forceStopBrowserSession(); }
    finally {
      for (const [name, original] of originals) {
        if (original) Object.defineProperty(globalThis, name, original);
        else delete globalThis[name];
      }
    }
  });
  // Isolate the actual TypeScript module's session/listener state per test.
  api = await import(`./browser-transport.ts?test=${++moduleId}`);
  const worker = () => workers.at(-1);
  async function open() {
    const pending = api.invokeCommand('runtime_project');
    worker().reply({ result: { config: {}, configFile: 'gams.json' } });
    await pending;
  }
  async function ready() {
    await open();
    await api.listenEvent('gams-runtime-call-view', () => {});
    await api.invokeCommand('runtime_call_view_ready');
  }
  function timeout() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    assert.equal(timer.delay, 180000);
    timers.delete(id);
    timer.callback();
  }
  return { api, workers, worker, timers, open, ready, timeout };
}

test('runtime_project forwards startup options and strips callbacks before structured cloning', async t => {
  const h = await transport(t, 'http://127.0.0.1:8093/browser.html?project-dir=/work&config=other.json&modules-dir=/shared/units&plugin-cache-dir=.jco&source=/project&fs=opfs');
  const pending = h.api.invokeCommand('runtime_project', {
    options: { cwd: '/ignored' }, grantFilesystem: true,
    onProgress: h.api.createProgressChannel(() => {}),
  });
  assert.equal(h.worker().url, '/vendor/browser-worker.js');
  assert.deepEqual(h.worker().options, { type: 'module' });
  assert.deepEqual(h.worker().messages, [{ id: 1, command: 'runtime_project', args: {
    grantFilesystem: true,
    options: { cwd: '/work', config: 'other.json', modulesDir: '/shared/units', pluginCacheDir: '/work/.jco', source: 'http://127.0.0.1:8093/project/' },
  } }]);
  assert.equal(h.api.hasBrowserSession(), true);
  const result = { config: { name: 'work' }, configFile: 'other.json' };
  h.worker().reply({ result });
  assert.deepEqual(await pending, result);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.api.invokeCommand('runtime_project'), /already has a Project session/);
  assert.equal(h.workers.length, 1);
});

test('invoke requires Project plus listener/readiness handshake and unlisten revokes readiness', async t => {
  const h = await transport(t);
  const invoke = () => h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] });
  await assert.rejects(invoke(), /Project is not initialized/);
  await assert.rejects(h.api.invokeCommand('runtime_call_view_ready'), /Register the call-view listener/);
  await h.open();
  await assert.rejects(invoke(), /Runtime is not ready/);
  const unlisten = await h.api.listenEvent('gams-runtime-call-view', () => {});
  await assert.rejects(invoke(), /Runtime is not ready/);
  await h.api.invokeCommand('runtime_call_view_ready');
  const pending = invoke();
  h.worker().reply({ result: { ok: [] } });
  assert.deepEqual(await pending, { ok: [] });
  unlisten();
  await assert.rejects(invoke(), /Runtime is not ready/);
  await assert.rejects(h.api.invokeCommand('runtime_call_view_ready'), /Register the call-view listener/);
  assert.equal(h.worker().messages.length, 2);
});

test('resolution snapshots and download byte progress dispatch to the matching channels', async t => {
  const h = await transport(t);
  const projectReports = [], downloadReports = [];
  const opening = h.api.invokeCommand('runtime_project', { onProgress: h.api.createProgressChannel(value => projectReports.push(value)) });
  const projectId = h.worker().messages.at(-1).id;
  const snapshot = { operationId: 'prepare', status: 'running', resources: [{ path: 'fs.wasm', loaded: 7, total: 12 }] };
  h.worker().emit({ id: projectId, event: 'resolution-progress', snapshot });
  assert.deepEqual(projectReports, [snapshot]);
  h.worker().reply({ result: {} });
  await opening;
  const complete = { ...snapshot, status: 'complete' };
  h.worker().emit({ id: projectId, event: 'resolution-progress', snapshot: complete });
  assert.deepEqual(projectReports, [snapshot, complete]);
  const downloading = h.api.invokeCommand('runtime_download', {
    url: 'https://example.com/unit.wasm',
    onProgress: h.api.createProgressChannel(value => downloadReports.push(value)),
  });
  const id = h.worker().messages.at(-1).id;
  assert.deepEqual(h.worker().messages.at(-1).args, { url: 'https://example.com/unit.wasm' });
  const bytes = { loaded: 23, total: 100 };
  h.worker().emit({ id, event: 'download-progress', progress: bytes });
  const downloadSnapshot = { operationId: 'download', status: 'running' };
  h.worker().emit({ id, event: 'resolution-progress', snapshot: downloadSnapshot });
  assert.deepEqual(downloadReports, [bytes, downloadSnapshot]);
  assert.deepEqual(projectReports, [snapshot, complete]);
  h.worker().reply({ result: Uint8Array.of(0, 255) });
  assert.deepEqual(await downloading, Uint8Array.of(0, 255));
  h.worker().emit({ id, event: 'download-progress', progress: { loaded: 100, total: 100 } });
  assert.deepEqual(downloadReports, [bytes, downloadSnapshot]);
  assert.equal(h.timers.size, 0);
});

test('runtime_invoke forwards arguments and passes WIT ok/err envelopes through unchanged', async t => {
  const h = await transport(t);
  await h.ready();
  for (const result of [{ ok: [0, 255] }, { ok: null }, { err: 'no-entry' }]) {
    const args = { target: 'fs/fs::read-file', args: ['file'] };
    const pending = h.api.invokeCommand('runtime_invoke', args);
    assert.deepEqual(h.worker().messages.at(-1), { id: h.worker().messages.length, command: 'runtime_invoke', args });
    h.worker().reply({ result });
    assert.strictEqual(await pending, result);
  }
  const pending = h.api.invokeCommand('runtime_invoke', {});
  h.worker().reply({ error: 'OPFS checkpoint failed' });
  await assert.rejects(pending, /OPFS checkpoint failed/);
  assert.equal(h.timers.size, 0);
});

test('close waits for acknowledged runtime_shutdown before termination and requires reload afterward', async t => {
  const h = await transport(t);
  await h.ready();
  let settled = false;
  const closing = h.api.closeBrowserSession().then(() => { settled = true; });
  assert.deepEqual(h.worker().messages.at(-1), { id: 2, command: 'runtime_shutdown', args: {} });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(h.worker().terminated, false);
  assert.equal(h.api.hasBrowserSession(), true);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', {}), /blocked\/closing/);
  h.worker().reply({ result: null });
  await closing;
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasBrowserSession(), false);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.api.invokeCommand('runtime_project'), /Reload to reopen/);
  await assert.rejects(h.api.closeBrowserSession(), /No browser Host session/);
});

test('shutdown error retains worker/session, blocks work and permits shutdown retry', async t => {
  const h = await transport(t);
  await h.ready();
  const closing = h.api.closeBrowserSession();
  h.worker().reply({ error: 'Persistence failure' });
  await assert.rejects(closing, /Persistence failure/);
  assert.equal(h.worker().terminated, false);
  assert.equal(h.api.hasBrowserSession(), true);
  await assert.rejects(h.api.invokeCommand('runtime_project'), /already has a Project session/);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', {}), /blocked\/closing/);
  const retry = h.api.closeBrowserSession();
  assert.equal(h.worker().messages.at(-1).command, 'runtime_shutdown');
  h.worker().reply({ result: null });
  await retry;
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasBrowserSession(), false);
});

test('force stop rejects all in-flight requests, sends no shutdown and requires reload', async t => {
  const h = await transport(t);
  await h.ready();
  const pending = [
    h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::write-text', args: ['file', 'text'] }),
    h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] }),
  ];
  h.api.forceStopBrowserSession();
  for (const request of pending) await assert.rejects(request, /force-stopped; in-flight changes may be lost/);
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasBrowserSession(), false);
  assert.equal(h.worker().messages.some(message => message.command === 'runtime_shutdown'), false);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.api.invokeCommand('runtime_project'), /Reload to reopen/);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', {}), /Reload to reopen/);
  assert.throws(() => h.api.forceStopBrowserSession(), /No browser Host session/);
});

test('request timeout retains worker, ignores late reply, blocks work and permits shutdown', async t => {
  const h = await transport(t);
  await h.ready();
  const pending = h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::write-text', args: ['file', 'text'] });
  const id = h.worker().messages.at(-1).id;
  h.timeout();
  await assert.rejects(pending, /timed out.*Worker retained; persistence is unconfirmed/);
  assert.equal(h.worker().terminated, false);
  assert.equal(h.api.hasBrowserSession(), true);
  h.worker().emit({ id, result: { ok: null } });
  const count = h.worker().messages.length;
  await assert.rejects(h.api.invokeCommand('runtime_invoke', {}), /blocked\/closing/);
  assert.equal(h.worker().messages.length, count);
  const closing = h.api.closeBrowserSession();
  assert.equal(h.worker().messages.at(-1).command, 'runtime_shutdown');
  h.worker().reply({ result: null });
  await closing;
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasBrowserSession(), false);
});

test('shutdown timeout and late acknowledgement retain worker until acknowledged shutdown retry', async t => {
  const h = await transport(t);
  await h.ready();
  const closing = h.api.closeBrowserSession();
  const id = h.worker().messages.at(-1).id;
  h.timeout();
  await assert.rejects(closing, /timed out/);
  h.worker().emit({ id, result: null });
  assert.equal(h.worker().terminated, false);
  assert.equal(h.api.hasBrowserSession(), true);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', {}), /blocked\/closing/);
  const retry = h.api.closeBrowserSession();
  h.worker().reply({ result: null });
  await retry;
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasBrowserSession(), false);
});

test('unsupported, duplicate or malformed event registration and unsolicited View response reject', async t => {
  const h = await transport(t);
  await assert.rejects(h.api.listenEvent('other', () => {}), /Unsupported\/duplicate browser Runtime event/);
  await assert.rejects(h.api.listenEvent('gams-runtime-call-view', null), /Unsupported\/duplicate browser Runtime event/);
  const unlisten = await h.api.listenEvent('gams-runtime-call-view', () => {});
  await assert.rejects(h.api.listenEvent('gams-runtime-call-view', () => {}), /Unsupported\/duplicate browser Runtime event/);
  unlisten();
  const again = await h.api.listenEvent('gams-runtime-call-view', () => {});
  again();
  await assert.rejects(h.api.invokeCommand('runtime_call_view_response', {}), /No browser component-to-View callback is pending/);
  assert.throws(() => h.api.createProgressChannel(null), /Progress callback must be a function/);
  assert.equal(h.workers.length, 0);
});

test('browser build environment supplies the proxy to the worker and startup display',async t=>{
  const h=await transport(t,'http://127.0.0.1:8093/browser.html',{corsProxy:'http://127.0.0.1:8787/download'});
  assert.equal(h.api.getStartupOptions().corsProxy,'http://127.0.0.1:8787/download');
  const opening=h.api.invokeCommand('runtime_project');
  assert.equal(h.worker().messages.at(-1).args.options.corsProxy,'http://127.0.0.1:8787/download');
  h.worker().reply({result:{config:{}}});await opening;
});

test('missing build-environment fields fail instead of silently disabling proxy configuration',async t=>{
  await assert.rejects(transport(t,'http://127.0.0.1:8093/browser.html',{}),/Malformed browser build environment/);
});
