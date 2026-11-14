import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function openUi(t, { autoShutdown = true, fakeTimers = false } = {}) {
  const elements = Object.fromEntries([
    'status', 'diagnostics', 'metrics', 'files', 'results', 'logs', 'grant', 'grant-fs',
    'load', 'upload', 'reset', 'force', 'storage', 'fs-mode', 'sample', 'loaded', 'compatibility',
  ].map(id => [id, { textContent: '', checked: false, disabled: false, value: 'host' }]));
  const buttons = Object.fromEntries(['transpile', 'instantiate', 'call', 'benchmark', 'check-random', 'check-filesystem',
    'flush', 'persistence-write', 'persistence-read', 'persistence-rename', 'persistence-delete', 'persistence-absent']
    .map(operation => [operation, { dataset: { operation }, disabled: false }]));
  const workers = [];
  class Worker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(message) {
      this.messages.push(message);
      if (message.operation === 'shutdown' && autoShutdown) queueMicrotask(() => this.respond());
    }
    emit(data) { this.onmessage({ data: { storage: 'none', checkpointMs: 0, ...data } }); }
    respond(data = {}) { this.emit({ id: this.messages.at(-1).id, durationMs: 1, ...data }); }
  }
  const globals = {
    document: { getElementById: id => elements[id], querySelectorAll: () => Object.values(buttons) },
    Worker,
    crossOriginIsolated: false,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
  };
  const timers = new Map();
  if (fakeTimers) {
    let timerId = 0;
    globals.setTimeout = (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    };
    globals.clearTimeout = id => timers.delete(id);
  }
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  // ui.ts has no exports, so Node also caches it as a CommonJS script.
  delete require.cache[require.resolve('./ui.ts')];
  await import(`./ui.ts?test=${encodeURIComponent(t.name)}`);
  const worker = () => workers.at(-1);
  const ready = () => worker().emit({ event: 'ready', initializationMs: 1 });
  ready();
  return { elements, buttons, worker, workers, ready, timers };
}

test('new component load and explicit reset clear the previous logging grant', async t => {
  const { elements, worker, ready } = await openUi(t);
  elements.grant.checked = true;
  elements['grant-fs'].checked = true;
  const previous = worker();
  await elements.load.onclick();
  assert.equal(previous.terminated, true);
  assert.equal(elements.grant.checked, false, 'new components must require a fresh grant');
  assert.equal(elements['grant-fs'].checked, false, 'new components must require a fresh filesystem grant');
  ready();
  elements.grant.checked = true;
  elements['grant-fs'].checked = true;
  const loaded = worker();
  await elements.reset.onclick();
  assert.equal(loaded.terminated, true);
  assert.equal(elements.grant.checked, false, 'reset must revoke the grant');
  assert.equal(elements['grant-fs'].checked, false, 'reset must revoke the filesystem grant');
});

test('pending instantiation disables grant changes until completion, then revocation blocks calls', async t => {
  const { elements, buttons, worker, ready } = await openUi(t);
  await elements.load.onclick();
  ready();
  const transpiling = buttons.transpile.onclick();
  worker().emit({ id: worker().messages.at(-1).id, durationMs: 1, result: { files: [], exports: [['add', 'function'], ['greet', 'function']] } });
  await transpiling;
  elements.grant.checked = true;
  elements.grant.onchange();
  const instantiating = buttons.instantiate.onclick();
  const request = worker().messages.at(-1);
  assert.equal(request.operation, 'instantiate');
  assert.equal(request.args.grantLogging, true);
  assert.equal(elements.grant.disabled, true, 'cannot revoke while a granted instance is pending');
  assert.equal(elements['grant-fs'].disabled, true, 'filesystem grant cannot race instantiation');
  assert.equal(buttons.call.disabled, true);
  worker().emit({ id: request.id, durationMs: 1, result: { exports: ['add', 'greet'] } });
  await instantiating;
  assert.equal(elements.grant.disabled, false);
  assert.equal(buttons.call.disabled, false);
  elements.grant.checked = false;
  elements.grant.onchange();
  assert.equal(buttons.call.disabled, true, 'revocation requires reinstantiation before calls');
  assert.equal(buttons.instantiate.disabled, false);
});


test('filesystem exports enable only their matching checks and require reinstantiation after grant change', async t => {
  const { elements, buttons, worker, ready } = await openUi(t);
  await elements.load.onclick();
  ready();
  const transpiling = buttons.transpile.onclick();
  worker().emit({ id: worker().messages.at(-1).id, durationMs: 1,
    result: { files: [], exports: [['gams:fs/fs@1.2.0', 'instance']] } });
  await transpiling;
  assert.equal(buttons['check-filesystem'].disabled, true);
  elements['grant-fs'].checked = true;
  elements['grant-fs'].onchange();
  const instantiating = buttons.instantiate.onclick();
  const request = worker().messages.at(-1);
  assert.equal(request.args.grantFilesystem, true);
  assert.equal(request.args.grantLogging, false);
  worker().emit({ id: request.id, durationMs: 1, result: { exports: ['gams:fs/fs@1.2.0'] } });
  await instantiating;
  assert.equal(buttons['check-filesystem'].disabled, false);
  for (const operation of ['call', 'benchmark', 'check-random']) assert.equal(buttons[operation].disabled, true);
  elements['grant-fs'].checked = false;
  elements['grant-fs'].onchange();
  assert.equal(buttons['check-filesystem'].disabled, true);
  assert.equal(buttons.instantiate.disabled, false);
});

const persistenceOperations = ['persistence-write', 'persistence-read', 'persistence-rename', 'persistence-delete', 'persistence-absent'];
const filesystemExport = 'gams:fs/fs@1.2.0';

async function transpile(ui, exports = [filesystemExport]) {
  await ui.elements.load.onclick();
  ui.ready();
  const operation = ui.buttons.transpile.onclick();
  ui.worker().respond({ result: { files: [], exports: exports.map(name => [name, 'instance']) } });
  await operation;
}

async function instantiate(ui) {
  const operation = ui.buttons.instantiate.onclick();
  ui.worker().respond({ storage: ui.elements['fs-mode'].value, result: { exports: [filesystemExport] } });
  await operation;
}

for (const trigger of ['reset', 'load']) {
  test(`${trigger} waits for shutdown acknowledgement before terminating the existing worker`, async t => {
    const ui = await openUi(t, { autoShutdown: false });
    const previous = ui.worker();
    ui.elements.grant.checked = true;
    ui.elements['grant-fs'].checked = true;
    ui.elements['fs-mode'].value = 'opfs';
    const operation = ui.elements[trigger].onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(previous.messages.at(-1).operation, 'shutdown');
    assert.equal(previous.terminated, false);
    assert.equal(ui.workers.length, 1);
    assert.equal(ui.elements.grant.checked, true, 'grants remain until shutdown succeeds');
    assert.equal(ui.elements['fs-mode'].value, 'opfs');
    assert.equal(ui.elements[trigger].disabled, true);
    previous.respond({ storage: 'opfs' });
    await operation;
    assert.equal(previous.terminated, true);
    assert.equal(ui.workers.length, 2);
    assert.equal(ui.elements.grant.checked, false);
    assert.equal(ui.elements['grant-fs'].checked, false);
    assert.equal(ui.elements['fs-mode'].value, 'memory');
  });

  test(`${trigger} shutdown failure retains the existing worker and does not claim a checkpoint`, async t => {
    t.mock.method(console, 'error', () => {});
    const ui = await openUi(t, { autoShutdown: false });
    const previous = ui.worker();
    ui.elements.grant.checked = true;
    ui.elements['grant-fs'].checked = true;
    ui.elements['fs-mode'].value = 'opfs';
    const storage = ui.elements.storage.textContent;
    const loaded = ui.elements.loaded.textContent;
    const operation = ui.elements[trigger].onclick();
    await new Promise(resolve => setImmediate(resolve));
    previous.respond({ error: 'checkpoint failed: disk full' });
    await operation;
    assert.equal(previous.terminated, false);
    assert.equal(ui.workers.length, 1);
    assert.equal(ui.elements.grant.checked, true);
    assert.equal(ui.elements['grant-fs'].checked, true);
    assert.equal(ui.elements['fs-mode'].value, 'opfs');
    assert.equal(ui.elements.storage.textContent, storage);
    assert.equal(ui.elements.loaded.textContent, loaded);
    assert.match(ui.elements.diagnostics.textContent, /checkpoint failed: disk full/);
    assert.doesNotMatch(ui.elements.status.textContent, /complete|passed/i);
  });
}

test('OPFS persistence controls require filesystem exports, grant and OPFS mode, and lock during requests', async t => {
  const ui = await openUi(t);
  const { elements, buttons } = ui;
  const assertPersistenceDisabled = disabled => {
    for (const operation of persistenceOperations) assert.equal(buttons[operation].disabled, disabled, operation);
  };
  assertPersistenceDisabled(true);
  await transpile(ui, ['add', 'greet']);
  elements['grant-fs'].checked = true;
  elements['fs-mode'].value = 'opfs';
  elements['fs-mode'].onchange();
  await instantiate(ui);
  assertPersistenceDisabled(true);
  await transpile(ui);
  assert.equal(elements['fs-mode'].value, 'memory', 'new loads restore the memory default');
  assert.equal(elements['grant-fs'].checked, false);
  await instantiate(ui);
  assertPersistenceDisabled(true);
  assert.equal(buttons.flush.disabled, true);
  elements['grant-fs'].checked = true;
  elements['grant-fs'].onchange();
  await instantiate(ui);
  assertPersistenceDisabled(true);
  assert.equal(buttons.flush.disabled, false);
  elements['fs-mode'].value = 'opfs';
  elements['fs-mode'].onchange();
  assertPersistenceDisabled(true);
  const instantiating = buttons.instantiate.onclick();
  assert.equal(ui.worker().messages.at(-1).args.filesystemMode, 'opfs');
  assertPersistenceDisabled(true);
  ui.worker().respond({ storage: 'opfs', result: { exports: [filesystemExport] } });
  await instantiating;
  assertPersistenceDisabled(false);
  for (const operation of [...persistenceOperations, 'flush']) {
    const running = buttons[operation].onclick();
    const request = ui.worker().messages.at(-1);
    assert.equal(request.operation, operation === 'flush' ? 'flush' : 'persistence');
    if (operation !== 'flush') assert.equal(request.args.action, operation.slice('persistence-'.length));
    assertPersistenceDisabled(true);
    assert.equal(buttons.flush.disabled, true);
    for (const id of ['grant', 'grant-fs', 'fs-mode', 'load', 'upload', 'reset']) assert.equal(elements[id].disabled, true, id);
    ui.worker().respond({ storage: 'opfs', result: { ok: true } });
    await running;
    assertPersistenceDisabled(false);
    assert.equal(buttons.flush.disabled, false);
  }
  elements['grant-fs'].checked = false;
  elements['grant-fs'].onchange();
  assertPersistenceDisabled(true);
  assert.equal(buttons.flush.disabled, true);
});

test('force stop terminates immediately without graceful shutdown and warns of lost writes', async t => {
  t.mock.method(console, 'error', () => {});
  const ui = await openUi(t, { autoShutdown: false });
  ui.elements.force.onclick();
  assert.equal(ui.workers[0].terminated, true);
  assert.deepEqual(ui.workers[0].messages, []);
  ui.ready();
  const previous = ui.worker();
  const closing = ui.elements.reset.onclick();
  assert.equal(previous.messages.at(-1).operation, 'shutdown');
  assert.equal(previous.terminated, false);
  ui.elements.force.onclick();
  await closing;
  assert.equal(previous.terminated, true);
  assert.equal(ui.workers.length, 3);
  assert.match(ui.elements.diagnostics.textContent, /in-flight (?:writes|changes) may be lost/);
  assert.doesNotMatch(ui.elements.storage.textContent, /checkpoint complete/);
});

test('request timeout retains the worker, blocks normal operations and permits explicit force stop', async t => {
  t.mock.method(console, 'error', () => {});
  const ui = await openUi(t, { fakeTimers: true });
  await ui.elements.load.onclick();
  ui.ready();
  const previous = ui.worker();
  const running = ui.buttons.transpile.onclick();
  const request = previous.messages.at(-1);
  const [{ callback, delay }] = [...ui.timers.values()];
  assert.equal(delay, 30000);
  callback();
  await running;
  assert.equal(previous.terminated, false);
  assert.equal(ui.workers.length, 2);
  assert.match(ui.elements.diagnostics.textContent, /Worker retained: persistence is unconfirmed/);
  assert.doesNotMatch(ui.elements.storage.textContent, /checkpoint complete/);
  for (const id of ['load', 'upload', 'reset', 'grant', 'grant-fs', 'fs-mode']) assert.equal(ui.elements[id].disabled, true, id);
  for (const button of Object.values(ui.buttons)) assert.equal(button.disabled, true);
  assert.equal(ui.elements.force.disabled, false);
  assert.doesNotThrow(() => previous.emit({ id: request.id, result: {} }), 'late timed-out replies are ignored');
  assert.equal(previous.terminated, false);
  ui.elements.force.onclick();
  assert.equal(previous.terminated, true);
  assert.equal(ui.workers.length, 3);
});
