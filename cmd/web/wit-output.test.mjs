import test from 'node:test';
import assert from 'node:assert/strict';
import {WitCallSchema} from './wit-call.ts';
import {BrowserResources} from './browser-resources.ts';
const iface='test:output/api@1.0.0';
function fixture(resultKind,{declared=false,failRegister=0}={}){
  const raw={world:0,resolve:{
    worlds:[{name:'root',package:0,imports:{},exports:{'interface-0':{interface:{id:0}}}}],
    packages:[{name:'test:output@1.0.0',interfaces:{api:0},worlds:{root:0}}],
    interfaces:[{name:'api',package:0,types:{thing:0},functions:{get:{name:'get',kind:'freestanding',params:[],result:declared?3:2}}}],
    types:[{name:'thing',owner:{interface:0},kind:'resource'},{name:null,owner:null,kind:{handle:{own:0}}},{name:null,owner:null,kind:resultKind},...(declared?[{name:null,owner:null,kind:{result:{ok:null,err:2}}}]:[])],
  }};
  const schema=new WitCallSchema(raw),registry=new BrowserResources(),owner={};let registrations=0;
  const resources={borrow:()=>assert.fail('unexpected borrow'),consume:()=>assert.fail('unexpected consume'),own:(kind,value)=>{if(++registrations===failRegister)throw Error('registration failure');return registry.own(owner,iface,kind,value);},release:ref=>registry.release(ref)};
  const invoke=value=>schema.invoke(iface,'get',[],{[iface]:{get(){if(declared)throw{declared:true,payload:value};return value;}},_util:{isComponentError:e=>e.declared===true}},resources);
  return {registry,invoke};
}
function resource(events,label,fail=false){return{[Symbol.dispose](){events.push(label);if(fail)throw Error('drop '+label);}};}
for(const declared of [false,true]){
  test(`malformed ${declared?'error':'success'} output drops owned siblings before and after invalid scalar`,async()=>{
    for(const types of [[1,'u8'],['u8',1]]){
      const {registry,invoke}=fixture({tuple:{types}},{declared}),events=[],value=resource(events,'owned');
      await assert.rejects(invoke(types[0]===1?[value,999]:[999,value]),/range/);
      assert.equal(registry.size,0);assert.deepEqual(events,['owned']);
    }
  });
  test(`malformed ${declared?'error':'success'} resource output creates no partial registration`,async()=>{
    const {registry,invoke}=fixture({tuple:{types:[1,1]}},{declared}),events=[];
    await assert.rejects(invoke([resource(events,'valid'),{}]),/destructor/);
    assert.equal(registry.size,0);assert.deepEqual(events,['valid']);
  });
}
test('duplicate returned owned objects reject and are destroyed exactly once',async()=>{
  const {registry,invoke}=fixture({tuple:{types:[1,1]}}),events=[],value=resource(events,'once');
  await assert.rejects(invoke([value,value]),/Duplicate owned/);assert.equal(registry.size,0);assert.deepEqual(events,['once']);
});
test('failed compound registration rolls back public refs and drops all returned ownership',async()=>{
  const {registry,invoke}=fixture({tuple:{types:[1,1]}},{failRegister:2}),events=[];
  await assert.rejects(invoke([resource(events,'first'),resource(events,'second')]),/registration failure/);
  assert.equal(registry.size,0);assert.deepEqual(events,['first','second']);
});
test('throwing output destructors do not skip other owned cleanup or hide the conversion failure',async()=>{
  const {registry,invoke}=fixture({tuple:{types:[1,'u8',1]}}),events=[];
  await assert.rejects(invoke([resource(events,'first',true),999,resource(events,'last')]),e=>e instanceof AggregateError&&e.errors.length===2&&e.errors[0].message.includes('range')&&e.errors[1].message==='drop first');
  assert.equal(registry.size,0);assert.deepEqual(events,['first','last']);
});
