import test from 'node:test';
import assert from 'node:assert/strict';

async function transport(t) {
  const workers = [], requests = [], reports = [], timers = new Map();
  let timerId = 0;
  class Worker {
    messages = [];
    terminated = false;
    constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
    reply(data = {}) {
      this.emit({ id: this.messages.at(-1).id, storage: 'opfs', checkpointMs: 2, durationMs: 3, ...data });
    }
  }
  for (const [name, value] of Object.entries({
    Worker,
    fetch: async url => {
      requests.push(url);
      return { ok: true, arrayBuffer: async () => Uint8Array.of(0, 97, 115, 109).buffer };
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  // A fresh instance of the actual TS module keeps session/listener state isolated.
  const api = await import(`./files-transport.ts?test=${encodeURIComponent(t.name)}`);
  t.after(() => { if (api.hasSession()) api.forceStopSession(); });
  const worker = () => workers.at(-1);
  async function open() {
    const opening = api.openSession(message => reports.push(message));
    worker().emit({ event: 'ready', initializationMs: 1 });
    // Drain the ready/fetch/arrayBuffer continuations without real timers.
    for (let i = 0; i < 10 && worker().messages.length === 0; i++) await Promise.resolve();
    assert.equal(worker().messages.at(-1)?.operation, 'transpile');
    worker().reply({ storage: 'none', result: { exports: [['gams:fs/fs@1.2.0', 'instance']], files: [] } });
    await Promise.resolve();
    assert.equal(worker().messages.at(-1).operation, 'instantiate');
    worker().reply();
    await opening;
  }
  async function ready() {
    await open();
    await api.listenEvent('gams-runtime-call-view', () => {});
    await api.invokeCommand('runtime_call_view_ready', {});
  }
  function timeout() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    assert.equal(timer.delay, 30000);
    timers.delete(id);
    timer.callback();
  }
  return { api, worker, workers, requests, reports, timers, open, ready, timeout };
}

test('open boots the worker, fetches original component bytes, transpiles and explicitly grants OPFS', async t => {
  const h = await transport(t);
  await assert.rejects(h.api.invokeCommand('runtime_project', {}), /Open\/grant/);
  await h.open();
  assert.equal(h.worker().url, '/vendor/transpiler-worker.js');
  assert.deepEqual(h.worker().options, { type: 'module' });
  assert.deepEqual(h.requests, ['/components/plugin.fs.wasm']);
  assert.deepEqual(h.worker().messages, [
    { id: 1, operation: 'transpile', args: { bytes: Uint8Array.of(0, 97, 115, 109) } },
    { id: 2, operation: 'instantiate', args: { grantLogging: false, grantFilesystem: true, filesystemMode: 'opfs' } },
  ]);
  assert.equal(h.api.hasSession(), true);
  assert.equal(h.timers.size, 0);
  const project = await h.api.invokeCommand('runtime_project', {});
  assert.deepEqual(project, { config: h.api.projectConfig, configFile: 'browser-files.json', modulesDir: '/units' });
  await assert.rejects(h.api.openSession(() => {}), /Close the existing/);
  assert.equal(h.workers.length, 1);
});

test('Runtime invocation requires open plus listener/readiness handshake and unlisten revokes readiness', async t => {
  const h = await transport(t);
  const invoke = () => h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] });
  await assert.rejects(invoke(), /not ready/);
  await assert.rejects(h.api.invokeCommand('runtime_call_view_ready', {}), /listener must be registered/);
  await h.open();
  await assert.rejects(invoke(), /not ready/);
  const unlisten = await h.api.listenEvent('gams-runtime-call-view', () => {});
  await assert.rejects(invoke(), /not ready/);
  await h.api.invokeCommand('runtime_call_view_ready', {});
  const pending = invoke();
  h.worker().reply({ result: { ok: [] } });
  assert.deepEqual(await pending, { ok: [] });
  unlisten();
  await assert.rejects(invoke(), /not ready/);
  await assert.rejects(h.api.invokeCommand('runtime_call_view_ready', {}), /listener must be registered/);
  const again = await h.api.listenEvent('gams-runtime-call-view', () => {});
  again();
});

test('invoke-filesystem forwards target/arguments and preserves Host WIT ok/err envelopes', async t => {
  const h = await transport(t);
  await h.ready();
  for (const envelope of [{ ok: [0, 255] }, { ok: null }, { err: 'no-entry' }]) {
    const args = ['file'];
    const pending = h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::read-file', args });
    assert.deepEqual(h.worker().messages.at(-1), {
      id: h.worker().messages.length, operation: 'invoke-filesystem',
      args: { target: 'fs/fs::read-file', values: args },
    });
    h.worker().reply({ result: envelope });
    assert.deepEqual(await pending, envelope);
  }
  const failure = h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] });
  h.worker().reply({ error: 'OPFS checkpoint failed' });
  await assert.rejects(failure, /OPFS checkpoint failed/);
});

test('unsupported commands and unsupported, duplicate or malformed event registrations reject', async t => {
  const h = await transport(t);
  await assert.rejects(h.api.invokeCommand('runtime_save_project', {}), /Unsupported browser experiment command/);
  await assert.rejects(h.api.listenEvent('other', () => {}), /Unsupported or duplicate/);
  await assert.rejects(h.api.listenEvent('gams-runtime-call-view', null), /Unsupported or duplicate/);
  const unlisten = await h.api.listenEvent('gams-runtime-call-view', () => {});
  await assert.rejects(h.api.listenEvent('gams-runtime-call-view', () => {}), /Unsupported or duplicate/);
  unlisten();
  assert.equal(h.workers.length, 0);
});

test('close waits for checkpointed shutdown acknowledgement before terminating and releasing session', async t => {
  const h = await transport(t);
  await h.ready();
  const closing = h.api.closeSession();
  assert.equal(h.worker().messages.at(-1).operation, 'shutdown');
  assert.equal(h.worker().terminated, false);
  assert.equal(h.api.hasSession(), true);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] }), /closing or blocked/);
  assert.equal(h.reports.some(message => message.includes('writer lock released')), false);
  h.worker().reply();
  await closing;
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasSession(), false);
  assert.equal(h.reports.at(-1), 'Guest stopped; OPFS disposed/checkpointed; writer lock released.');
  await assert.rejects(h.api.closeSession(), /No filesystem session/);
});

test('failed shutdown retains the session/worker, refuses replacement and permits a shutdown retry', async t => {
  const h = await transport(t);
  await h.open();
  const closing = h.api.closeSession();
  h.worker().reply({ error: 'Persistence failure' });
  await assert.rejects(closing, /Persistence failure/);
  assert.equal(h.api.hasSession(), true);
  assert.equal(h.worker().terminated, false);
  assert.equal(h.reports.some(message => message.includes('writer lock released')), false);
  await assert.rejects(h.api.openSession(() => {}), /Close the existing/);
  const retry = h.api.closeSession();
  assert.equal(h.worker().messages.at(-1).operation, 'shutdown');
  h.worker().reply();
  await retry;
  assert.equal(h.worker().terminated, true);
});

test('force stop rejects in-flight work without claiming a checkpoint or sending shutdown', async t => {
  const h = await transport(t);
  await h.ready();
  const pending = h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::write-text', args: ['file', 'text'] });
  const reportsBefore = [...h.reports];
  h.api.forceStopSession();
  await assert.rejects(pending, /Forced stop: in-flight changes may be lost or partially persisted/);
  assert.equal(h.worker().terminated, true);
  assert.equal(h.api.hasSession(), false);
  assert.equal(h.worker().messages.some(message => message.operation === 'shutdown'), false);
  assert.deepEqual(h.reports, reportsBefore);
  assert.equal(h.timers.size, 0);
});

test('operation timeout retains worker, blocks invokes even after late reply, but permits shutdown', async t => {
  const h = await transport(t);
  await h.ready();
  const pending = h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::write-text', args: ['file', 'text'] });
  const timedOutId = h.worker().messages.at(-1).id;
  h.timeout();
  await assert.rejects(pending, /timed out.*Worker retained.*persistence is unconfirmed/);
  assert.equal(h.worker().terminated, false);
  assert.equal(h.api.hasSession(), true);
  h.worker().emit({ id: timedOutId, storage: 'opfs', checkpointMs: 1 });
  const messageCount = h.worker().messages.length;
  await assert.rejects(h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] }), /closing or blocked/);
  assert.equal(h.worker().messages.length, messageCount);
  const closing = h.api.closeSession();
  assert.equal(h.worker().messages.at(-1).operation, 'shutdown');
  h.worker().reply();
  await closing;
  assert.equal(h.worker().terminated, true);
});

test('shutdown timeout retains blocked session until a later acknowledged shutdown or explicit force', async t => {
  const h = await transport(t);
  await h.ready();
  const closing = h.api.closeSession();
  h.timeout();
  await assert.rejects(closing, /timed out/);
  assert.equal(h.api.hasSession(), true);
  assert.equal(h.worker().terminated, false);
  await assert.rejects(h.api.invokeCommand('runtime_invoke', { target: 'fs/fs::list', args: ['.'] }), /closing or blocked/);
  const retry = h.api.closeSession();
  assert.equal(h.worker().messages.at(-1).operation, 'shutdown');
  h.worker().reply();
  await retry;
  assert.equal(h.api.hasSession(), false);
});
