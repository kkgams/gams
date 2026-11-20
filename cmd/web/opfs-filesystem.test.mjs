import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

const hooks = registerHooks({resolve(name, context, next) {
  if (name !== '@bytecodealliance/preview2-shim/browser-io') return next(name, context);
  return {url:'data:text/javascript,export const inputStreamCreate=x=>x,outputStreamCreate=x=>x,ioErrorCreate=x=>x',shortCircuit:true};
}});
const {directFilesystemAdapter} = await import('./opfs-filesystem.ts');
hooks.deregister();

test('rename uses both directory capabilities and invalidates prior descriptors across adapters', () => {
  const entries = new Map([['/work','directory'],['/other','directory'],['/work/a','file'],['/other/b','file']]);
  const ids = new Map();
  let id = 0n;
  const store = {
    identity(path) { if (!ids.has(path)) ids.set(path, ++id); return ids.get(path); },
    command(op, path, _size, dest) {
      if (op === 'stat') { assert.ok(entries.has(path), path); return [entries.get(path), 0, 0]; }
      assert.equal(op,'rename');
      assert.deepEqual([path,dest],['/work/a','/other/b']);
      entries.set(dest,entries.get(path)); entries.delete(path); ids.delete(path); ids.delete(dest);
    },
    readAt() { return [new Uint8Array(), true]; },
  };
  const adapter = directFilesystemAdapter(store);
  const from = adapter.getRoot('/work');
  const to = adapter.getRoot('/other');
  const open = (root, path) => root.openAt({},path,{}, {read:true});
  const source = open(from,'a');
  const replaced = open(directFilesystemAdapter(store).getRoot('/other'),'b');
  assert.throws(() => open(from,'../other/b'), e => e === 'not-permitted');
  from.renameAt('a',to,'b');
  for (const file of [source,replaced]) assert.throws(() => file.read(1n,0n), e => e === 'bad-descriptor');
  assert.deepEqual(open(to,'b').read(1n,0n), [new Uint8Array(),true]);
});
