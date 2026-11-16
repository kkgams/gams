import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFilesystemAdapter} from './browser-filesystem.ts';

test('Project adapter closes reads at/beyond EOF on roots and recursively opened descriptors',()=>{
  const offsets=[];let disposed=false;
  class Descriptor{
    #size;
    constructor(size){this.#size=size;}
    stat(){return {size:this.#size};}
    readViaStream(offset){offsets.push(offset);const size=this.#size;return {blockingRead(length){if(offset===size)throw{tag:'closed'};return new Uint8Array(Number(offset>=size?0n:size-offset<length?size-offset:length));}};}
    openAt(size){return new Descriptor(size);}
    isSameObject(other){return this.#size===other.#size;}
    renameAt(_path,other){assert.ok(other instanceof Descriptor);return other.#size;}
  }
  const root=new Descriptor(0n);
  const adapter=projectFilesystemAdapter({getRoot:()=>root,dispose:()=>{disposed=true;}});
  assert.equal(adapter.getRoot({}),root);assert.equal(adapter.getRoot({}),root);
  for(const offset of [0n,24n,18446744073709551615n])assert.throws(()=>root.readViaStream(offset).blockingRead(16n),e=>e.tag==='closed');
  const file=root.openAt(5n),nested=file.openAt(2n);
  assert.equal(file.readViaStream(3n).blockingRead(4n).length,2);
  assert.throws(()=>file.readViaStream(8n).blockingRead(1n),e=>e.tag==='closed');
  assert.throws(()=>nested.readViaStream(9n).blockingRead(1n),e=>e.tag==='closed');
  assert.deepEqual(offsets,[0n,0n,0n,3n,5n,2n]);
  assert.equal(file.isSameObject(root.openAt(5n)),true);assert.equal(root.renameAt('x',file),5n);
  adapter.dispose();assert.equal(disposed,true);
});
