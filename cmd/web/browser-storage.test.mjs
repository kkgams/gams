import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStore, normalizePath, joinPath } from './browser-storage.ts';
const bytes = text => new TextEncoder().encode(text);
const text = data => new TextDecoder().decode(data);
const code = expected => error => error.code === expected;

test('virtual normalization resolves contained navigation and rejects unsafe paths', () => {
  assert.equal(normalizePath('/a//b/./../c/'), '/a/c');
  assert.equal(normalizePath('../c', '/a/b'), '/a/c');
  assert.equal(joinPath('/a/b', '/absolute'), '/absolute');
  assert.equal(normalizePath(''), '/');
  for (const path of ['/../a', '/a/../../b', '../../x']) assert.throws(() => normalizePath(path), code('EPERM'));
  for (const path of ['/a\\b', '/a\0b', '/__proto__/x', '/constructor', '/prototype']) assert.throws(() => normalizePath(path), code('EINVAL'));
  assert.throws(() => normalizePath('x', 'relative'), code('EINVAL'));
});

test('shared tree mutations preserve root, preopen, and existing descriptor identity', async () => {
  const root = { dir: { project: { dir: { old: { source: 'old' } } } } };
  const store = new BrowserStore(root);
  const preopen = store.entry('/project');
  const descriptor = preopen.dir.old;
  assert.equal(store.root, root);
  await store.write('/project/old', bytes('new'));
  assert.equal(preopen.dir.old, descriptor);
  assert.equal(text(descriptor.source), 'new');
  descriptor.source = bytes('guest');
  assert.equal(text(await store.read('/project/old')), 'guest');
  preopen.dir.guest = { source: 'guest file' };
  assert.equal(text(await store.read('/project/guest')), 'guest file');
  await store.write('/project/nested/deep/file', bytes('host'));
  const moved = store.entry('/project/nested');
  await store.rename('/project/nested', '/project/moved');
  assert.equal(preopen.dir.moved, moved);
  assert.equal(await store.stat('/project/moved/deep/file'), 'file');
  await assert.rejects(store.stat('/project/nested'), code('ENOENT'));
  await store.remove('/project/moved');
  assert.equal(preopen.dir.moved, undefined);
});

test('recursive directories, string files, owned byte buffers and inherited record keys', async () => {
  const store = new BrowserStore({ dir: { z: { source: '世界' } } });
  await store.mkdir('/a/b/c');
  await store.mkdir('/a/b');
  await store.mkdir('/');
  const input = new Uint8Array([0, 255, 3]);
  await store.write('/a/data', input);
  input[0] = 99;
  const output = await store.read('/a/data');
  assert.deepEqual(output, new Uint8Array([0, 255, 3]));
  output[1] = 0;
  assert.deepEqual(await store.read('/a/data'), new Uint8Array([0, 255, 3]));
  assert.equal(text(await store.read('/z')), '世界');
  assert.deepEqual(await store.list('/'), ['a', 'z']);
  await assert.rejects(store.stat('/toString'), code('ENOENT'));
  await store.write('/toString', bytes('own'));
  assert.equal(text(await store.read('/toString')), 'own');
  await assert.rejects(store.mkdir('/__proto__/x'), code('EINVAL'));
  assert.equal(Object.prototype.x, undefined);
});

test('missing paths have ENOENT, while files, roots and symlinks have distinct errors', async () => {
  const store = new BrowserStore({ dir: { file: { source: 'x' }, dir: { dir: {} }, link: { symlink: 'file' } } });
  for (const method of ['read', 'stat', 'list', 'remove']) await assert.rejects(store[method]('/missing'), code('ENOENT'));
  assert.throws(() => store.entry('/missing'), code('ENOENT'));
  await assert.rejects(store.stat('/file/child'), code('ENOTDIR'));
  await assert.rejects(store.mkdir('/file/child'), code('ENOTDIR'));
  await assert.rejects(store.write('/file/child', bytes('x')), code('ENOTDIR'));
  await assert.rejects(store.write('/dir', bytes('x')), code('EISDIR'));
  await assert.rejects(store.read('/dir'), code('EISDIR'));
  await assert.rejects(store.list('/file'), code('ENOTDIR'));
  await assert.rejects(store.remove('/'), code('EBUSY'));
  await assert.rejects(store.rename('/', '/elsewhere'), code('EBUSY'));
  await assert.rejects(store.rename('/file', '/missing/new'), code('ENOENT'));
  await assert.rejects(store.read('/link'), code('ENOTSUP'));
  await assert.rejects(store.write('/link', bytes('x')), code('ENOTSUP'));
});

test('rename prevents subtree cycles and invalid replacements', async () => {
  const store = new BrowserStore({ dir: {} });
  await store.write('/from/file', bytes('value'));
  await store.mkdir('/to');
  const from = store.entry('/from');
  await assert.rejects(store.rename('/from', '/from/child'), code('EINVAL'));
  await store.rename('/from', '/to');
  assert.equal(store.entry('/to'), from);
  await store.rename('/to', '/to');
  await store.write('/occupied/file', bytes('other'));
  await assert.rejects(store.rename('/to', '/occupied'), code('ENOTEMPTY'));
  await assert.rejects(store.rename('/to/file', '/occupied'), code('EISDIR'));
  await assert.rejects(store.rename('/to', '/occupied/file'), code('ENOTDIR'));
  await store.rename('/to/file', '/occupied/file');
  assert.equal(text(await store.read('/occupied/file')), 'value');
});

test('only explicit flush persists; callback failure propagates unchanged', async () => {
  let calls = 0;
  let reject = true;
  const failure = new Error('quota exceeded');
  const store = new BrowserStore({ dir: {} }, async () => { calls++; if (reject) throw failure; });
  await store.write('/a/file', bytes('unsaved'));
  await store.rename('/a/file', '/a/new');
  await store.remove('/a/new');
  await Promise.resolve();
  assert.equal(calls, 0);
  await assert.rejects(store.flush(), error => error === failure);
  assert.equal(calls, 1);
  reject = false;
  await store.flush();
  assert.equal(calls, 2);
});

// Async handle fake: no browser or real OPFS dependency.
class MemoryDirectory {
  kind = 'directory';
  data = new Map();
  events;
  constructor(events = []) { this.events = events; }
  async *entries() { yield* this.data; }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.data.has(name) && create) this.data.set(name, new MemoryDirectory(this.events));
    assert.equal(this.data.get(name)?.kind, 'directory');
    return this.data.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (!this.data.has(name) && create) {
      const events = this.events;
      const entry = {
        kind: 'file', bytes: bytes(''), failClose: false,
        async getFile() {
          events.push('load');
          return { arrayBuffer: async () => entry.bytes.slice().buffer };
        },
        async createWritable() {
          return {
            async write(value) { entry.bytes = value.slice(); events.push('write'); },
            async close() { events.push('close'); if (entry.failClose) throw new Error('close failed'); },
            async abort() { events.push('abort'); },
          };
        },
      };
      this.data.set(name, entry);
    }
    assert.equal(this.data.get(name)?.kind, 'file');
    return this.data.get(name);
  }
  async removeEntry(name) { this.data.delete(name); }
}

test('OPFS isolates namespace, loads once, mirrors guest writes and awaits close', async () => {
  const origin = new MemoryDirectory();
  const namespace = await origin.getDirectoryHandle('test-host', { create: true });
  (await namespace.getFileHandle('original', { create: true })).bytes = bytes('saved');
  const sibling = await origin.getFileHandle('unrelated', { create: true });
  sibling.bytes = bytes('untouched');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { storage: { getDirectory: async () => origin } },
  });
  try {
    const store = await BrowserStore.open('test-host');
    assert.equal(text(await store.read('/original')), 'saved');
    assert.equal(text(await store.read('/original')), 'saved');
    assert.deepEqual(origin.events, ['load']);
    await store.mkdir('/nested');
    await store.rename('/original', '/nested/renamed');
    store.entry('/nested').dir.guest = { source: 'WASI write' };
    await store.flush();
    assert.deepEqual(origin.events, ['load', 'write', 'close', 'write', 'close']);
    assert.equal(namespace.data.has('original'), false);
    assert.equal(text(sibling.bytes), 'untouched');
    const reopened = await BrowserStore.open('test-host');
    assert.equal(text(await reopened.read('/nested/renamed')), 'saved');
    assert.equal(text(await reopened.read('/nested/guest')), 'WASI write');
    const guest = namespace.data.get('nested').data.get('guest');
    guest.failClose = true;
    await assert.rejects(store.flush(), /close failed/);
    assert.equal(origin.events.at(-1), 'abort');
    guest.failClose = false;
    await store.remove('/nested');
    await store.flush();
    assert.deepEqual([...namespace.data], []);
    for (const name of ['', '..', '.', 'a/b', 'a\\b', 'bad\0name', '__proto__']) {
      await assert.rejects(BrowserStore.open(name), code('EINVAL'));
    }
  } finally {
    if (prior) Object.defineProperty(globalThis, 'navigator', prior);
    else delete globalThis.navigator;
  }
});
