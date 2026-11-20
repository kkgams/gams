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

const flushCallbacks = () => new Promise(resolve => setImmediate(resolve));
const callbackPayload = id => ({ id, target: 'view/editor::update', args: '["hello"]' });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('call-view dispatch is asynchronous and response waits for its own numbered acknowledgement', async t => {
  const h = await transport(t);
  await h.open();
  const events = [];
  let completed = false;
  await h.api.listenEvent('gams-runtime-call-view', async event => {
    events.push(event);
    await h.api.invokeCommand('runtime_call_view_response', { id: event.payload.id, ok: '"done"', err: null });
    completed = true;
  });
  await h.api.invokeCommand('runtime_call_view_ready');
  const parent = h.api.invokeCommand('runtime_invoke', { target: 'plugin::run', args: [] });
  const parentId = h.worker().messages.at(-1).id;
  const payload = callbackPayload('view-1');
  h.worker().emit({ event: 'call-view', payload });
  assert.deepEqual(events, []);
  await flushCallbacks();
  assert.deepEqual(events, [{ payload }]);
  const response = h.worker().messages.at(-1);
  assert.deepEqual(response, { id: 3, command: 'runtime_call_view_response', args: { id: 'view-1', ok: '"done"', err: null } });
  assert.equal(completed, false);
  h.worker().emit({ id: parentId, result: { ok: null } });
  await parent;
  assert.equal(completed, false);
  h.worker().emit({ id: response.id, result: null });
  await flushCallbacks();
  assert.equal(completed, true);
  await assert.rejects(h.api.invokeCommand('runtime_call_view_response', response.args), /No browser component-to-View callback is pending/);
  assert.equal(h.timers.size, 0);
});

for (const state of ['missing', 'not ready', 'throwing', 'rejecting', 'no response']) {
  test(`call-view ${state} listener reports an acknowledged callback error`, async t => {
    const h = await transport(t);
    await h.open();
    let calls = 0;
    if (state !== 'missing') {
      await h.api.listenEvent('gams-runtime-call-view', () => {
        calls++;
        if (state === 'throwing') throw new Error('listener threw');
        if (state === 'rejecting') return Promise.reject(new Error('listener rejected'));
      });
      if (state !== 'not ready') await h.api.invokeCommand('runtime_call_view_ready');
    }
    h.worker().emit({ event: 'call-view', payload: callbackPayload('failed') });
    await flushCallbacks();
    const response = h.worker().messages.at(-1);
    assert.equal(response.command, 'runtime_call_view_response');
    assert.equal(response.args.id, 'failed');
    assert.equal(response.args.ok, null);
    assert.match(response.args.err, /missing or not ready|listener threw|listener rejected|settled without a response/);
    assert.equal(calls, state === 'missing' || state === 'not ready' ? 0 : 1);
    h.worker().reply({ result: null });
    await flushCallbacks();
    assert.equal(h.timers.size, 0);
    await assert.rejects(h.api.invokeCommand('runtime_call_view_response', response.args), /No browser component-to-View callback is pending/);
  });
}

test('nested invoke/release tag only envelopes while the topmost callback awaits its reply', async t => {
  const h = await transport(t);
  await h.open();
  const gates = new Map(['outer', 'inner'].map(id => [id, deferred()]));
  await h.api.listenEvent('gams-runtime-call-view', async ({ payload }) => {
    await gates.get(payload.id).promise;
    await h.api.invokeCommand('runtime_call_view_response', { id: payload.id, ok: 'null', err: null });
  });
  await h.api.invokeCommand('runtime_call_view_ready');
  async function nested(command, expected, args = { value: 1 }) {
    const request = h.api.invokeCommand(command, args);
    const envelope = h.worker().messages.at(-1);
    assert.deepEqual(envelope.args, args);
    assert.equal(envelope.callbackId, expected);
    h.worker().reply({ result: null });
    await request;
  }
  for (const id of ['outer', 'inner']) {
    h.worker().emit({ event: 'call-view', payload: callbackPayload(id) });
    await flushCallbacks();
    await nested('runtime_invoke', id);
    await nested('runtime_release_resource', id);
    await nested('runtime_download', id);
    await nested('runtime_prepare_config', id);
    await nested('runtime_resolve_file', id);
  }
  gates.get('inner').resolve();
  await flushCallbacks();
  h.worker().reply({ result: null });
  await flushCallbacks();
  await nested('runtime_invoke', 'outer');
  gates.get('outer').resolve();
  await flushCallbacks();
  h.worker().reply({ result: null });
  await flushCallbacks();
  await nested('runtime_release_resource', undefined);
  await nested('runtime_invoke', undefined);
  assert.equal(h.timers.size, 0);
});

for (const stop of ['force stop', 'worker failure']) {
  test(`${stop} clears callbacks and late listener failures do not send stale responses`, async t => {
    const h = await transport(t);
    await h.open();
    const gate = deferred();
    let entered = 0;
    await h.api.listenEvent('gams-runtime-call-view', async () => {
      entered++;
      await gate.promise;
      throw new Error('late failure');
    });
    await h.api.invokeCommand('runtime_call_view_ready');
    h.worker().emit({ event: 'call-view', payload: callbackPayload('stopped') });
    await flushCallbacks();
    const request = h.api.invokeCommand('runtime_release_resource', { ref: 'resource' });
    assert.equal(h.worker().messages.at(-1).callbackId, 'stopped');
    if (stop === 'force stop') h.api.forceStopBrowserSession();
    else h.worker().onerror({ message: 'worker crashed' });
    await assert.rejects(request, /force-stopped|worker failed/);
    const count = h.worker().messages.length;
    gate.resolve();
    await flushCallbacks();
    h.worker().emit({ event: 'call-view', payload: callbackPayload('after-stop') });
    await flushCallbacks();
    assert.equal(entered, 1);
    assert.equal(h.worker().messages.length, count);
    assert.equal(h.timers.size, 0);
    await assert.rejects(h.api.invokeCommand('runtime_call_view_response', { id: 'stopped', ok: null, err: 'late' }), /No browser component-to-View callback is pending/);
  });
}

test('stale callback IDs cannot respond and callback acknowledgement timeout ignores late reply', async t => {
  const h = await transport(t);
  await h.open();
  await h.api.listenEvent('gams-runtime-call-view', async ({ payload }) => {
    await h.api.invokeCommand('runtime_call_view_response', { id: payload.id, ok: 'null', err: null });
  });
  await h.api.invokeCommand('runtime_call_view_ready');
  h.worker().emit({ event: 'call-view', payload: callbackPayload('timeout') });
  await flushCallbacks();
  const response = h.worker().messages.at(-1);
  const count = h.worker().messages.length;
  for (const id of ['unknown', 'timeout']) {
    await assert.rejects(h.api.invokeCommand('runtime_call_view_response', { id, ok: null, err: 'stale' }), /No browser component-to-View callback is pending/);
  }
  assert.equal(h.worker().messages.length, count);
  h.timeout();
  await flushCallbacks();
  h.worker().emit({ id: response.id, result: null });
  assert.equal(h.timers.size, 0);
  assert.equal(h.worker().messages.length, count);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', {}), /blocked\/closing/);
});

test('callback error acknowledgement failure is reported and releases callback tracking', async t => {
  const errors=[];t.mock.method(console,'error',(...args)=>errors.push(args));
  const h = await transport(t);
  await h.open();
  h.worker().emit({ event: 'call-view', payload: callbackPayload('failed-ack') });
  await flushCallbacks();
  h.worker().reply({ error: 'callback expired in worker' });
  await flushCallbacks();
  assert.equal(errors.length,1);assert.match(String(errors[0][1]),/callback expired/);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.api.invokeCommand('runtime_call_view_response', { id: 'failed-ack', ok: null, err: 'stale' }), /No browser component-to-View callback is pending/);
});

test('malformed response permits a valid error retry and replied contexts cannot tag new work',async t=>{
  const h=await transport(t);await h.open();const gate=deferred();
  await h.api.listenEvent('gams-runtime-call-view',async({payload})=>{
    for(const response of [{ok:undefined,err:null},{ok:1,err:null},{ok:'x',err:'y'}])
      await assert.rejects(h.api.invokeCommand('runtime_call_view_response',{id:payload.id,...response}),/exactly one string/);
    await gate.promise;
    await h.api.invokeCommand('runtime_call_view_response',{id:payload.id,ok:null,err:'invalid result'});
  });await h.api.invokeCommand('runtime_call_view_ready');
  h.worker().emit({event:'call-view',payload:callbackPayload('retry')});await flushCallbacks();
  gate.resolve();await flushCallbacks();const reply=h.worker().messages.at(-1);
  const request=h.api.invokeCommand('runtime_invoke',{target:'counter/next',args:[]});
  assert.equal(h.worker().messages.at(-1).callbackId,undefined);h.worker().reply({result:2});await request;
  h.worker().emit({id:reply.id,result:null});await flushCallbacks();assert.equal(h.timers.size,0);
});

test('graceful close still permits pending callback data operations and its response',async t=>{
  const h=await transport(t);await h.open();const gate=deferred();
  await h.api.listenEvent('gams-runtime-call-view',async({payload})=>{await gate.promise;await h.api.invokeCommand('runtime_call_view_response',{id:payload.id,ok:'null',err:null});});
  await h.api.invokeCommand('runtime_call_view_ready');h.worker().emit({event:'call-view',payload:callbackPayload('closing')});await flushCallbacks();
  const closing=h.api.closeBrowserSession();const closeId=h.worker().messages.at(-1).id;
  const nested=h.api.invokeCommand('runtime_resolve_file',{source:'file'});assert.equal(h.worker().messages.at(-1).callbackId,'closing');h.worker().reply({result:'file'});await nested;
  gate.resolve();await flushCallbacks();h.worker().reply({result:null});await flushCallbacks();h.worker().emit({id:closeId,result:{closed:true}});await closing;
});

test('a successful fresh showcase commit rewrites the URL for ordinary reload', async t => {
  const h = await transport(t, 'https://gams.test/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.1.0%2Ftilemap.zip');
  const original = Object.getOwnPropertyDescriptor(globalThis,'history');
  const changes=[];
  Object.defineProperty(globalThis,'history',{configurable:true,value:{state:null,replaceState(_state,_title,url){changes.push(url.href);}}});
  t.after(()=>{if(original) Object.defineProperty(globalThis,'history',original); else delete globalThis.history;});
  await h.open();
  const finishing=h.api.finishShowcaseLaunch();
  assert.equal(h.worker().messages.at(-1).command,'runtime_commit_showcase');
  assert.deepEqual(changes,[]);
  h.worker().reply({result:null}); await finishing;
  assert.deepEqual(changes,['https://gams.test/app.html?showcase=tilemap']);
});
