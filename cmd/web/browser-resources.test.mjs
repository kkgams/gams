import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserResources} from './browser-resources.ts';
const dispose=Symbol.dispose||Symbol.for('dispose');
function resource(drop=()=>{}){return{[dispose]:drop};}
test('owned resource references are opaque; borrowed identity enforces owner, kind and origin',async()=>{
  const registry=new BrowserResources(),owner={},other={};let drops=0;const value=resource(()=>drops++);
  const ref=registry.own(owner,'gams:image/image','image',value);
  assert.deepEqual(Object.keys(ref).sort(),['$resource','id']);assert.equal(registry.borrow(ref,owner,'image'),value);assert.equal(drops,0);
  assert.throws(()=>registry.borrow(ref,other,'image'),/another component/);
  assert.throws(()=>registry.borrow(ref,owner,'connection'),/kind/);
  await assert.rejects(registry.release({...ref,$resource:'wrong'}),/origin/);assert.equal(registry.size,1);
  await registry.release(ref);assert.equal(drops,1);assert.equal(registry.size,0);await assert.rejects(registry.release(ref),/Unknown/);
  assert.throws(()=>registry.borrow(ref,owner,'image'),/Unknown/);
});
test('ownership cleanup is selective, drops once, and keeps the actual returning interface',async()=>{
  const registry=new BrowserResources(),owner={},other={};const calls=[];
  const a=registry.own(owner,'returned:interface/one','kind',resource(()=>calls.push('a')));
  const b=registry.own(other,'returned:interface/two','kind',resource(()=>calls.push('b')));
  assert.equal(registry.borrow(a,owner,'kind')[dispose] instanceof Function,true);
  await registry.releaseOwner(owner);await registry.releaseOwner(owner);assert.deepEqual(calls,['a']);assert.equal(registry.size,1);
  assert.throws(()=>registry.borrow(a,owner,'kind'),/Unknown/);await registry.release(b);assert.deepEqual(calls,['a','b']);
});
test('invalid resource input rejects and failed destructors consume handles without hiding other cleanup',async()=>{
  const registry=new BrowserResources(),owner={};let drops=0;
  for(const bad of [null,{},1,{$resource:'x',id:1},Object.create({$resource:'x',id:'y'})])assert.throws(()=>registry.borrow(bad,owner,'kind'),/reference/);
  for(const bad of [null,{},1])assert.throws(()=>registry.own(owner,'x','kind',bad),/owned component resource/);
  const ref=registry.own(owner,'x','kind',resource(()=>{drops++;throw Error('destructor trap');}));
  registry.own(owner,'x','kind',resource(()=>drops++));
  await assert.rejects(registry.releaseOwner(owner),error=>error instanceof AggregateError&&error.errors[0].message==='destructor trap');
  assert.equal(drops,2);assert.equal(registry.size,0);await assert.rejects(registry.release(ref),/Unknown/);
});
test('consumed ownership invalidates the public handle without calling its destructor', async()=>{
  const registry=new BrowserResources(),owner={};let drops=0;
  const value=resource(()=>drops++),ref=registry.own(owner,'probe:resource/api','canonical-kind',value);
  assert.throws(()=>registry.consume(ref,{},'canonical-kind'),/another component/);
  assert.throws(()=>registry.consume(ref,owner,'wrong'),/kind/);
  assert.equal(registry.size,1);
  assert.equal(registry.consume(ref,owner,'canonical-kind'),value);
  assert.equal(registry.size,0);assert.equal(drops,0);
  assert.throws(()=>registry.borrow(ref,owner,'canonical-kind'),/Unknown/);
  await assert.rejects(registry.release(ref),/Unknown/);
  await registry.releaseOwner(owner);assert.equal(drops,0);
});
