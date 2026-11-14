import test from 'node:test';
import assert from 'node:assert/strict';
import { runRandomChecks, runFilesystemChecks } from './plugin-checks.ts';

// Mock-only unit supplements, not browser/component compatibility evidence.
function randomInstance() {
  let seed, generation;
  return {
    'gams:random/seeded-random@1.0.0': {
      setSeed(value) { seed = value; generation = 0n; },
      getSeed() { return seed; }, getGeneration() { return generation; },
    },
    'wasi:random/random@0.2.0': {
      getRandomBytes(length) { assert.equal(length, 16n); generation += 2n; return new Uint8Array(16).fill(Number(seed)); },
      getRandomU64() { generation++; return 18446744073709551615n; },
    },
  };
}
function filesystemInstance(style = 'payload') {
  const nodes = new Map([['/project', null], ['/project/keep.txt', new TextEncoder().encode('keep')]]);
  function fail(message) { throw style === 'payload' ? { payload: message } : message; }
  function get(path) { if (!nodes.has(path)) fail('no-entry'); return nodes.get(path); }
  const fs = {
    createDir(path) { assert.equal(path, '/project/browser-jco-check'); nodes.set(path, null); },
    writeText(path, text) { this.writeFile(path, new TextEncoder().encode(text)); },
    readText(path) { return new TextDecoder().decode(this.readFile(path)); },
    writeFile(path, bytes) {
      if (path.includes('..') || !path.startsWith('/project/')) fail('not-permitted');
      nodes.set(path, bytes.slice());
    },
    readFile(path) { const bytes = get(path); assert.ok(bytes instanceof Uint8Array); return bytes.slice(); },
    list(path) {
      assert.equal(get(path), null);
      return Array.from(nodes).filter(([name]) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes('/'))
        .map(([name, bytes]) => ({ name: name.slice(path.length + 1), type: bytes === null ? 'directory' : 'regular-file' }));
    },
    stat(path) { const bytes = get(path); return { type: bytes === null ? 'directory' : 'regular-file', size: BigInt(bytes?.length ?? 0), atime: 0n, mtime: 1n, ctime: 2n }; },
    rename(source, target) { nodes.set(target, get(source)); nodes.delete(source); },
    removeFile(path) { assert.ok(get(path) instanceof Uint8Array); nodes.delete(path); },
    removeDir(path) { assert.equal(this.list(path).length, 0); nodes.delete(path); },
  };
  return { instance: { 'gams:fs/fs@1.2.0': fs }, fs, nodes };
}
test('dispatch namespaced camelCase random exports; return decimal JSON-safe u64', () => {
  const report = runRandomChecks(randomInstance());
  assert.equal(report.checks.length, 4);
  assert.deepEqual(report.checks.at(-1).result, { value: '18446744073709551615', seed: '123', generation: '3' });
  assert.doesNotThrow(() => JSON.stringify(report));
});
test('fail on wrong random generation or repeat', () => {
  const instance = randomInstance();
  instance['gams:random/seeded-random@1.0.0'].getGeneration = () => 0n;
  assert.throws(() => runRandomChecks(instance), /generation after 16 bytes/);
  const another = randomInstance();
  const random = another['wasi:random/random@0.2.0'];
  const original = random.getRandomBytes;
  let count = 0;
  random.getRandomBytes = length => { const bytes = original(length); bytes[0] = count++; return bytes; };
  assert.throws(() => runRandomChecks(another), /seeded repeat/);
});
test('require exact interfaces and methods', () => {
  assert.throws(() => runRandomChecks({ seededRandom: {} }), /missing interface gams:random/);
  assert.throws(() => runFilesystemChecks({ 'gams:fs/fs@1.2.0': {} }), /missing .*createDir/);
});
for (const style of ['payload', 'string']) {
  test(`filesystem plain successes, ${style} errors and root preservation`, () => {
    const { instance, nodes } = filesystemInstance(style);
    const before = Array.from(nodes);
    const report = runFilesystemChecks(instance);
    for (const label of ['deny traversal', 'deny outside preopen']) assert.ok(report.checks.some(check => check.label === label && check.result === 'not-permitted'));
    assert.equal(report.checks.at(-1).label, 'project root unchanged');
    assert.deepEqual(Array.from(nodes), before);
    assert.doesNotThrow(() => JSON.stringify(report));
  });
}
test('preserve preexisting check directory', () => {
  const { instance, nodes } = filesystemInstance();
  nodes.set('/project/browser-jco-check', null);
  const before = Array.from(nodes);
  assert.throws(() => runFilesystemChecks(instance), /must not already exist/);
  assert.deepEqual(Array.from(nodes), before);
});
test('wrong filesystem result fails and cleans owned paths', () => {
  const { instance, fs, nodes } = filesystemInstance();
  fs.readText = () => 'wrong';
  assert.throws(() => runFilesystemChecks(instance), /UTF-8 text roundtrip/);
  assert.deepEqual(Array.from(nodes.keys()), ['/project', '/project/keep.txt']);
});
test('unexpected successful denial fails and removes its side effect', () => {
  const { instance, fs, nodes } = filesystemInstance();
  const write = fs.writeText.bind(fs);
  fs.writeText = (path, text) => {
    if (path === '/project/../escape.txt') nodes.set(path, new TextEncoder().encode(text));
    else write(path, text);
  };
  assert.throws(() => runFilesystemChecks(instance), /deny traversal: expected an error/);
  assert.deepEqual(Array.from(nodes.keys()), ['/project', '/project/keep.txt']);
});
test('programming exceptions are not expected WIT errors', () => {
  const { instance, fs, nodes } = filesystemInstance();
  const read = fs.readFile.bind(fs);
  fs.readFile = path => { if (path.endsWith('/missing.bin')) throw new TypeError('broken adapter'); return read(path); };
  assert.throws(() => runFilesystemChecks(instance), /expected a WIT string error/);
  assert.deepEqual(Array.from(nodes.keys()), ['/project', '/project/keep.txt']);
});
