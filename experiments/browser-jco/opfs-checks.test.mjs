import test from 'node:test';
import assert from 'node:assert/strict';
import { runPersistenceCheck } from './opfs-checks.ts';

// Native mock-only supplements; these do not establish browser/OPFS persistence.
const DIRECTORY = '/project/opfs-persistence-check';
const TEXT = 'Hello, persistent 世界! 🌍\n';
const BYTES = [0, 1, 127, 128, 254, 255];
function filesystemInstance(style = 'payload') {
  const nodes = new Map([['/project', null], ['/project/keep.txt', new Uint8Array([42])]]);
  function get(path) {
    if (!nodes.has(path)) throw style === 'payload' ? { payload: 'no-entry' } : 'no-entry';
    return nodes.get(path);
  }
  const fs = {
    createDir(path) { assert.ok(!nodes.has(path)); nodes.set(path, null); },
    writeText(path, text) { this.writeFile(path, new TextEncoder().encode(text)); },
    readText(path) { return new TextDecoder().decode(this.readFile(path)); },
    writeFile(path, bytes) { assert.equal(get(DIRECTORY), null); nodes.set(path, bytes.slice()); },
    readFile(path) { const bytes = get(path); assert.ok(bytes instanceof Uint8Array); return bytes.slice(); },
    list(path) {
      assert.equal(get(path), null);
      return Array.from(nodes).filter(([name]) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes('/'))
        .map(([name, bytes]) => ({ name: name.slice(path.length + 1), type: bytes === null ? 'directory' : 'regular-file' }));
    },
    stat(path) { const bytes = get(path); return { type: bytes === null ? 'directory' : 'regular-file', size: BigInt(bytes?.length ?? 0), atime: 0n, mtime: 1n, ctime: 2n }; },
    rename(source, target) { assert.ok(!nodes.has(target)); nodes.set(target, get(source)); nodes.delete(source); },
    removeFile(path) { assert.ok(get(path) instanceof Uint8Array); nodes.delete(path); },
    removeDir(path) { assert.equal(this.list(path).length, 0); nodes.delete(path); },
  };
  return { instance: { 'gams:fs/fs@1.2.0': fs }, fs, nodes };
}

for (const style of ['payload', 'string']) {
  test(`synchronous write/read/rename/read/delete/absent lifecycle with ${style} WIT errors`, () => {
    const { instance, nodes } = filesystemInstance(style);
    const before = Array.from(nodes);
    for (const [action, state] of [['absent', 'absent'], ['write', 'original'], ['read', 'original'], ['rename', 'renamed'], ['read', 'renamed'], ['delete', 'absent'], ['absent', 'absent']]) {
      const report = runPersistenceCheck(instance, action);
      assert.equal(report.check, 'opfs-persistence');
      assert.equal(report.action, action);
      assert.equal(report.state, state);
      assert.equal(report.directory, DIRECTORY);
      assert.deepEqual(report.files, state === 'absent' ? [] : ['bytes.bin', state === 'original' ? 'text.txt' : 'saved.txt']);
      assert.doesNotThrow(() => JSON.stringify(report));
      if (action === 'write') {
        assert.equal(new TextDecoder().decode(nodes.get(`${DIRECTORY}/text.txt`)), TEXT);
        assert.deepEqual(Array.from(nodes.get(`${DIRECTORY}/bytes.bin`)), BYTES);
      }
      if (action === 'rename') assert.equal(nodes.has(`${DIRECTORY}/text.txt`), false);
    }
    assert.deepEqual(Array.from(nodes), before);
  });
}

test('delete accepts the original fixture too', () => {
  const { instance, nodes } = filesystemInstance();
  runPersistenceCheck(instance, 'write');
  assert.equal(runPersistenceCheck(instance, 'delete').state, 'absent');
  assert.deepEqual(Array.from(nodes.keys()), ['/project', '/project/keep.txt']);
});

test('write refuses a preexisting directory or file without mutation', () => {
  for (const existing of [null, new Uint8Array([99])]) {
    const { instance, nodes } = filesystemInstance();
    nodes.set(DIRECTORY, existing);
    nodes.set(`${DIRECTORY}/keep.txt`, new Uint8Array([88]));
    const before = Array.from(nodes);
    assert.throws(() => runPersistenceCheck(instance, 'write'), /must not already exist/);
    assert.deepEqual(Array.from(nodes), before);
  }
});

for (const action of ['read', 'rename', 'delete']) {
  test(`${action} refuses unknown, missing, corrupted or mistyped fixture entries without mutation`, () => {
    for (const corrupt of [
      nodes => nodes.set(`${DIRECTORY}/keep.txt`, new Uint8Array([88])),
      nodes => nodes.delete(`${DIRECTORY}/bytes.bin`),
      nodes => nodes.set(`${DIRECTORY}/text.txt`, new TextEncoder().encode('wrong')),
      nodes => nodes.set(`${DIRECTORY}/bytes.bin`, new Uint8Array([0, 1, 127, 128, 254, 0])),
      nodes => nodes.set(`${DIRECTORY}/bytes.bin`, null),
      nodes => nodes.set(`${DIRECTORY}/saved.txt`, new TextEncoder().encode(TEXT)),
    ]) {
      const { instance, nodes } = filesystemInstance();
      runPersistenceCheck(instance, 'write');
      corrupt(nodes);
      const before = Array.from(nodes);
      assert.throws(() => runPersistenceCheck(instance, action), /Persistence check failed/);
      assert.deepEqual(Array.from(nodes), before);
    }
  });
}

test('rename refuses an already renamed fixture without mutation', () => {
  const { instance, nodes } = filesystemInstance();
  runPersistenceCheck(instance, 'write');
  runPersistenceCheck(instance, 'rename');
  const before = Array.from(nodes);
  assert.throws(() => runPersistenceCheck(instance, 'rename'), /requires original fixture/);
  assert.deepEqual(Array.from(nodes), before);
});

test('absence rejects existing paths, unrelated WIT errors, adapter exceptions and traps', () => {
  const { instance, fs } = filesystemInstance();
  runPersistenceCheck(instance, 'write');
  assert.throws(() => runPersistenceCheck(instance, 'absent'), /expected WIT no-entry/);
  for (const error of ['not-permitted', { payload: 'not-permitted' }, { payload: 1 }, new Error('no-entry'), new TypeError('broken adapter'), new WebAssembly.RuntimeError('unreachable')]) {
    fs.stat = () => { throw error; };
    assert.throws(() => runPersistenceCheck(instance, 'absent'), /expected WIT no-entry/);
  }
});

test('rename checks old-path absence and new-path contents', () => {
  for (const brokenRename of [
    nodes => nodes.set(`${DIRECTORY}/saved.txt`, nodes.get(`${DIRECTORY}/text.txt`)),
    nodes => { nodes.delete(`${DIRECTORY}/text.txt`); nodes.set(`${DIRECTORY}/saved.txt`, new Uint8Array([1])); },
  ]) {
    const { instance, fs, nodes } = filesystemInstance();
    runPersistenceCheck(instance, 'write');
    fs.rename = () => brokenRename(nodes);
    assert.throws(() => runPersistenceCheck(instance, 'rename'), /old text path absent|UTF-8 fixture contents/);
  }
});

test('reject incorrect byte sizes before deleting', () => {
  const { instance, fs, nodes } = filesystemInstance();
  runPersistenceCheck(instance, 'write');
  const stat = fs.stat.bind(fs);
  fs.stat = path => ({ ...stat(path), size: 999n });
  const before = Array.from(nodes);
  assert.throws(() => runPersistenceCheck(instance, 'delete'), /UTF-8 fixture byte size/);
  assert.deepEqual(Array.from(nodes), before);
});

test('require the exact interface, camelCase methods and known action', () => {
  assert.throws(() => runPersistenceCheck({ fs: {} }, 'read'), /missing interface gams:fs\/fs@1.2.0/);
  assert.throws(() => runPersistenceCheck({ 'gams:fs/fs@1.2.0': { 'create-dir'() {} } }, 'read'), /missing .*createDir/);
  assert.throws(() => runPersistenceCheck(filesystemInstance().instance, 'clear'), /unknown action/);
});
