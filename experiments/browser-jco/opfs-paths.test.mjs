import test from 'node:test';
import assert from 'node:assert/strict';
import { protectOpfsDescriptor } from './opfs-paths.ts';

const reserved = '.__wasi_symlinks__.json';
test('reject the shim sidecar in every path-taking operation before mutation', () => {
  let calls = 0;
  const operations = [
    ['createDirectoryAt', [reserved]], ['statAt', [{}, reserved]],
    ['setTimesAt', [{}, `child/${reserved}`]], ['linkAt', [{}, reserved, {}, 'ok']],
    ['linkAt', [{}, 'ok', {}, reserved]], ['openAt', [{}, `child/${reserved}/file`]],
    ['readlinkAt', [reserved]], ['removeDirectoryAt', [reserved]],
    ['renameAt', [reserved, {}, 'ok']], ['renameAt', ['ok', {}, reserved]],
    ['symlinkAt', [reserved, 'ok']], ['symlinkAt', ['ok', reserved]],
    ['unlinkFileAt', [reserved]], ['metadataHashAt', [{}, reserved]],
  ];
  const raw = Object.fromEntries(operations.map(([name]) => [name, () => { calls++; }]));
  const descriptor = protectOpfsDescriptor(raw);
  for (const [method, args] of operations) {
    assert.throws(() => descriptor[method](...args), error => error === 'not-permitted', method);
  }
  assert.equal(calls, 0);
});

test('child descriptors preserve the guard and private-field method receivers', () => {
  class Descriptor {
    #value;
    constructor(value) { this.#value = value; }
    openAt() { return new Descriptor('child'); }
    stat() { return this.#value; }
    createDirectoryAt() { throw new Error('must not mutate'); }
    renameAt(oldPath, other, newPath) { return [oldPath, other.#value, newPath]; }
    linkAt(flags, oldPath, other, newPath) { return [flags, oldPath, other.#value, newPath]; }
    isSameObject(other) { return other.#value === this.#value; }
  }
  const descriptor = protectOpfsDescriptor(new Descriptor('root'));
  const child = descriptor.openAt({}, 'child', {}, {});
  assert.equal(descriptor.stat(), 'root');
  assert.equal(child.stat(), 'child');
  assert.throws(() => child.createDirectoryAt(reserved), error => error === 'not-permitted');
  assert.deepEqual(descriptor.renameAt('a', child, 'b'), ['a', 'child', 'b']);
  assert.deepEqual(descriptor.linkAt({}, 'a', child, 'b'), [{}, 'a', 'child', 'b']);
  assert.equal(child.isSameObject(child), true);
});

test('allow unrelated names but reject malformed internal paths', () => {
  const paths = [];
  const descriptor = protectOpfsDescriptor({ unlinkFileAt(path) { paths.push(path); } });
  descriptor.unlinkFileAt('ordinary.txt');
  descriptor.unlinkFileAt(`${reserved}.txt`);
  assert.deepEqual(paths, ['ordinary.txt', `${reserved}.txt`]);
  assert.throws(() => descriptor.unlinkFileAt(null), /Expected a path/);
});
