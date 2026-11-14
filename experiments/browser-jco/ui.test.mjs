import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function openUi(t) {
  const elements = Object.fromEntries([
    'status', 'diagnostics', 'metrics', 'files', 'results', 'logs', 'grant',
    'load', 'upload', 'reset', 'sample', 'loaded', 'compatibility',
  ].map(id => [id, { textContent: '', checked: false, disabled: false, value: 'host' }]));
  const buttons = Object.fromEntries(['transpile', 'instantiate', 'call', 'benchmark']
    .map(operation => [operation, { dataset: { operation }, disabled: false }]));
  const workers = [];
  class Worker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(message) { this.messages.push(message); }
    emit(data) { this.onmessage({ data }); }
  }
  const globals = {
    document: { getElementById: id => elements[id], querySelectorAll: () => Object.values(buttons) },
    Worker,
    crossOriginIsolated: false,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
  };
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
  return { elements, buttons, worker, ready };
}

test('new component load and explicit reset clear the previous logging grant', async t => {
  const { elements, worker, ready } = await openUi(t);
  elements.grant.checked = true;
  const previous = worker();
  await elements.load.onclick();
  assert.equal(previous.terminated, true);
  assert.equal(elements.grant.checked, false, 'new components must require a fresh grant');
  ready();
  elements.grant.checked = true;
  const loaded = worker();
  elements.reset.onclick();
  assert.equal(loaded.terminated, true);
  assert.equal(elements.grant.checked, false, 'reset must revoke the grant');
});

test('pending instantiation disables grant changes until completion, then revocation blocks calls', async t => {
  const { elements, buttons, worker, ready } = await openUi(t);
  await elements.load.onclick();
  ready();
  const transpiling = buttons.transpile.onclick();
  worker().emit({ id: worker().messages.at(-1).id, durationMs: 1, result: { files: [] } });
  await transpiling;
  elements.grant.checked = true;
  elements.grant.onchange();
  const instantiating = buttons.instantiate.onclick();
  const request = worker().messages.at(-1);
  assert.equal(request.operation, 'instantiate');
  assert.equal(request.args.grantLogging, true);
  assert.equal(elements.grant.disabled, true, 'cannot revoke while a granted instance is pending');
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
