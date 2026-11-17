import test from 'node:test';
import assert from 'node:assert/strict';
import { WitCallSchema } from './wit-call.ts';

const iface = 'test:unit/api@1.0.0';
function graph(types = [], functions = {}) {
  return { world: 0, resolve: {
    worlds: [{ name: 'root', imports: {}, exports: { 'interface-0': { interface: { id: 0 } } }, package: 0 }],
    interfaces: [{ name: 'api', package: 0, types: {}, functions }],
    packages: [{ name: 'test:unit@1.0.0', interfaces: { api: 0 }, worlds: { root: 0 } }],
    types: types.map(kind => ({ name: null, owner: null, kind }))
  } };
}
function fn(type, result = type) { return { name: 'echo', kind: 'freestanding', params: [{ name: 'value', type }], ...(result === undefined ? {} : { result }) }; }
const noResources = { borrow: () => assert.fail('unexpected borrow'), consume: () => assert.fail('unexpected consume'), own: () => assert.fail('unexpected own'), release: async () => assert.fail('unexpected release') };
async function echo(types, type, value, inspect = () => {}, output) {
  const schema = new WitCallSchema(graph(types, { echo: fn(type) }));
  return schema.invoke(iface, 'echo', [value], { [iface]: { echo(v) { inspect(v); return arguments.length && output === undefined ? v : output; } } }, noResources);
}

test('Resolve validation rejects references, cycles, malformed functions and collisions', () => {
  for (const raw of [null, {}, {world:0,resolve:{}}, {...graph(),world:9}, graph([{type:1}]), graph([{type:0}]), graph([{record:{fields:[{name:'x',type:'u8'},{name:'x',type:'u8'}]}}]), graph([], {echo:{...fn('u8'),name:'wrong'}})]) assert.throws(() => new WitCallSchema(raw));
  const raw = graph(); raw.resolve.worlds[0].exports['interface-0'].interface.id = 99;
  assert.throws(() => new WitCallSchema(raw), /interface index/);
  assert.deepEqual(new WitCallSchema(graph()).exports, [iface]);
});

test('all scalar types preserve Native values with strict ranges and lossless 64-bit integers', async () => {
  for (const [type, value, expected] of [['bool',true,true],['u8',255,255],['s8',-128,-128],['u16',65535,65535],['s16',-32768,-32768],['u32',4294967295,4294967295],['s32',-2147483648,-2147483648],['u64','18446744073709551615','18446744073709551615'],['s64','-9223372036854775808','-9223372036854775808'],['s64',42,42],['f32',1.25,1.25],['f64',2.5,2.5],['char','🦄','🦄'],['string','café','café']]) assert.equal(await echo([],type,value),expected);
  for (const [type, value] of [['bool',1],['u8',256],['s8',-129],['u32',1.1],['u64',9007199254740992],['u64','18446744073709551616'],['u64',-1],['s64','-9223372036854775809'],['f32',1e100],['f64',Infinity],['char','ab'],['char','\ud800'],['string',null]]) await assert.rejects(echo([],type,value));
});

test('all numeric lists use pinned Jco typed arrays, including aliases', async () => {
  for (const [type,Ctor,value] of [['u8',Uint8Array,255],['s8',Int8Array,-128],['u16',Uint16Array,65535],['s16',Int16Array,-32768],['u32',Uint32Array,4294967295],['s32',Int32Array,-2147483648],['u64',BigUint64Array,'18446744073709551615'],['s64',BigInt64Array,'-9223372036854775808'],['f32',Float32Array,1.25],['f64',Float64Array,2.5]]) {
    assert.deepEqual(await echo([{type},{list:0}],1,[value],v=>assert.ok(v instanceof Ctor)),[value]);
  }
  await assert.rejects(echo([{list:'u8'}],0,[256]), /range/);
  await assert.rejects(echo([{list:'u8'}],0,new Uint8Array([1])), /list array/);
});

test('records, tuples, enums, flags, variants and nested result use exact Native/Jco shapes', async () => {
  const types = [{enum:{cases:[{name:'red-blue'}]}},{flags:{flags:[{name:'read-only'},{name:'write'}]}},{variant:{cases:[{name:'bytes',type:3},{name:'none',type:null}]}},{list:'u8'},{result:{ok:2,err:'string'}},{tuple:{types:[0,1,4]}},{record:{fields:[{name:'my-field',type:5}]}}];
  const value = {'my-field':['red-blue',['read-only','read-only'],{ok:{case:'bytes',value:[0,255]}}]};
  const result = await echo(types,6,value,v=>{
    assert.equal(v.myField[0],'red-blue'); assert.deepEqual(v.myField[1],{readOnly:true,write:false});
    assert.deepEqual(v.myField[2],{tag:'ok',val:{tag:'bytes',val:new Uint8Array([0,255])}});
  });
  assert.deepEqual(result,{'my-field':['red-blue',['read-only'],{ok:{case:'bytes',value:[0,255]}}]});
  assert.deepEqual(await echo(types,2,{case:'none',value:null}),{case:'none',value:null});
  await assert.rejects(echo(types,4,{ok:{case:'none'},err:'bad'}), /exactly one/);
  await assert.rejects(echo(types,6,{}), /Missing record field/);
  await assert.rejects(echo(types,0,'unknown'), /enum/);
  await assert.rejects(echo(types,1,['unknown']), /flags/);
});

test('nested options alternate nullable/tagged representation as pinned Jco does', async () => {
  const types = [{option:'u32'},{option:0},{type:1},{option:2}];
  for (const type of [0,1,3]) {
    assert.equal(await echo(types,type,null,v=>assert.deepEqual(v,type===1?{tag:'none'}:undefined)),null);
    assert.equal(await echo(types,type,42,v=>assert.deepEqual(v,type===0?42:{tag:'some',val:42})),42);
  }
  assert.equal(await echo(types,1,42,()=>{}, {tag:'some',val:undefined}),null);
  assert.equal(await echo(types,3,42,()=>{}, {tag:'none'}),null);
});
function resourceGraph() {
  const raw = graph(['resource',{type:0},{handle:{own:1}},{handle:{borrow:1}},{result:{ok:2,err:2}}]);
  raw.resolve.types[0] = {name:'thing',owner:{interface:0},kind:'resource'};
  const functions = raw.resolve.interfaces[0].functions;
  functions['[constructor]thing'] = {name:'[constructor]thing',kind:{constructor:0},params:[{name:'name',type:'string'}],result:2};
  functions['[static]thing.create'] = {name:'[static]thing.create',kind:{static:0},params:[],result:4};
  functions['[static]thing.prototype'] = {name:'[static]thing.prototype',kind:{static:0},params:[],result:'string'};
  functions['[method]thing.read'] = {name:'[method]thing.read',kind:{method:0},params:[{name:'self',type:3}],result:'string'};
  functions.take = {name:'take',kind:'freestanding',params:[{name:'a',type:2},{name:'n',type:'u8'}]};
  functions.twice = {name:'twice',kind:'freestanding',params:[{name:'a',type:2},{name:'b',type:3}]};
  return raw;
}
test('constructors/static/method dispatch preserve receivers and canonical aliases', async () => {
  const schema = new WitCallSchema(resourceGraph()); const registered=[];
  class Thing {
    constructor(name) {this.name=name;}
    [Symbol.dispose]() {}
    read() {return this.name;}
    static create() {assert.equal(this,Thing); return new Thing('static');}
    static prototype_() {return 'reserved';}
  }
  const resources = {
    borrow(ref,kind) {assert.equal(kind,`${iface}/thing`);return ref.value;},
    consume:()=>assert.fail('unexpected consume'),
    own(kind,value) {assert.equal(kind,`${iface}/thing`);const ref={value};registered.push(ref);return ref;}
  };
  const bindings = {[iface]:{Thing}};
  const made = await schema.invoke(iface,'[constructor]thing',['instance'],bindings,resources);
  assert.equal(await schema.invoke(iface,'[method]thing.read',[made],bindings,resources),'instance');
  const result = await schema.invoke(iface,'[static]thing.create',[],bindings,resources);
  assert.equal(result.ok.value.name,'static');
  assert.equal(await schema.invoke(iface,'[static]thing.prototype',[],bindings,resources),'reserved');
  assert.equal(registered.length,2);
});

test('ownership stages after all validation, rejects conflicts, and consumes immediately before guest entry', async () => {
  const schema = new WitCallSchema(resourceGraph()); const guest={}; const ref={id:'x'}; const events=[];
  const resources={borrow(){events.push('borrow');return guest;},consume(r,k){assert.equal(r,ref);assert.equal(k,`${iface}/thing`);events.push('consume');},own:noResources.own};
  await assert.rejects(schema.invoke(iface,'take',[ref,999],{[iface]:{take(){events.push('call');}}},resources),/range/);
  assert.deepEqual(events,['borrow']); events.length=0;
  await assert.rejects(schema.invoke(iface,'take',[ref,1],{[iface]:{}},resources),/Missing callable/);
  assert.deepEqual(events,['borrow']); events.length=0;
  await assert.rejects(schema.invoke(iface,'twice',[ref,{id:'x'}],{[iface]:{twice(){}}},resources),/conflict/);
  assert.deepEqual(events,['borrow','borrow']);events.length=0;
  assert.equal(await schema.invoke(iface,'take',[ref,1],{[iface]:{take(value,n){assert.equal(value,guest);assert.equal(n,1);events.push('call');}}},resources),null);
  assert.deepEqual(events,['borrow','consume','call']);
});

test('only classified outermost result errors are converted, including resource errors', async () => {
  const schema = new WitCallSchema(graph([{result:{ok:'u32',err:'string'}}],{echo:fn('u8',0)}));
  const component={payload:'component error',[Symbol.dispose]() {}};const trap=new Error('trap');
  const bindings={_util:{isComponentError:e=>e===component},[iface]:{echo(){throw component;}}};
  assert.deepEqual(await schema.invoke(iface,'echo',[1],bindings,noResources),{err:'component error'});
  bindings[iface].echo=()=>42;
  assert.deepEqual(await schema.invoke(iface,'echo',[1],bindings,noResources),{ok:42});
  bindings[iface].echo=()=>{throw trap;};
  await assert.rejects(schema.invoke(iface,'echo',[1],bindings,noResources),e=>e===trap);
  delete bindings._util;bindings[iface].echo=()=>{throw component;};
  await assert.rejects(schema.invoke(iface,'echo',[1],bindings,noResources),e=>e===component);
  const rs=new WitCallSchema(resourceGraph());
  assert.deepEqual(await rs.invoke(iface,'[static]thing.create',[],{_util:{isComponentError:()=>true},[iface]:{Thing:class {static create(){throw {payload:component};}}}},{...noResources,own:(kind,v)=>({kind,v})}),{err:{kind:`${iface}/thing`,v:component}});
});

test('unsupported reachable types reject before ownership consumption or invocation', async () => {
  const raw=resourceGraph();raw.resolve.types.push({name:null,owner:null,kind:{future:'u8'}});
  raw.resolve.interfaces[0].functions.take.result=5;
  const schema=new WitCallSchema(raw);
  await assert.rejects(schema.invoke(iface,'take',[{},1],{[iface]:{take(){assert.fail('called unsupported signature');}}},noResources),/Unsupported WIT/);
  raw.resolve.interfaces[0].functions.take.result=3;
  await assert.rejects(new WitCallSchema(raw).invoke(iface,'take',[{},1],{},noResources),/borrowed WIT resource result/);
});

test('malformed nested output does not register partial resource refs', async () => {
  const raw=resourceGraph();raw.resolve.types.push({name:null,owner:null,kind:{tuple:{types:[2,'u8']}}});
  raw.resolve.interfaces[0].functions.take={name:'take',kind:'freestanding',params:[],result:5};
  const schema=new WitCallSchema(raw);
  await assert.rejects(schema.invoke(iface,'take',[],{[iface]:{take:()=>[{[Symbol.dispose]() {}},999]}},noResources),/range/);
});

test('all type owners, package maps and world package references validate eagerly', () => {
  const mutations = [
    r => { r.resolve.types.push({name:null,owner:{interface:99},kind:{list:'u8'}}); },
    r => { r.resolve.packages[0].interfaces.api=99; },
    r => { r.resolve.packages[0].worlds.root=99; },
    r => { r.resolve.worlds[0].package=99; }
  ];
  for (const mutate of mutations) {const raw=graph();mutate(raw);assert.throws(()=>new WitCallSchema(raw),/index/);}
});

test('free exports do not accidentally dispatch Object.prototype members', async () => {
  const raw=graph([],{'to-string':{name:'to-string',kind:'freestanding',params:[],result:'string'}});
  await assert.rejects(new WitCallSchema(raw).invoke(iface,'to-string',[],{[iface]:{}},noResources),/Missing callable/);
});

test('repeated borrows are allowed and repeated owns reject even through nested records', async () => {
  const raw=resourceGraph();
  raw.resolve.types.push({name:null,owner:null,kind:{record:{fields:[{name:'first',type:2},{name:'second',type:2}]}}});
  raw.resolve.interfaces[0].functions.nested={name:'nested',kind:'freestanding',params:[{name:'value',type:5}]};
  raw.resolve.interfaces[0].functions.borrows={name:'borrows',kind:'freestanding',params:[{name:'a',type:3},{name:'b',type:3}]};
  const schema=new WitCallSchema(raw),guest={},resources={...noResources,borrow:()=>guest};
  await assert.rejects(schema.invoke(iface,'nested',[{first:{id:'a'},second:{id:'a'}}],{[iface]:{nested(){assert.fail('called duplicate own');}}},resources),/Duplicate owned/);
  assert.equal(await schema.invoke(iface,'borrows',[{},{}],{[iface]:{borrows(a,b){assert.equal(a,b);}}},resources),null);
});

test('resource aliases across interfaces retain defining canonical kind, not return origin', async () => {
  const raw=resourceGraph(); const second='test:unit/consumer@1.0.0';
  raw.resolve.worlds[0].exports['interface-1']={interface:{id:1}};
  raw.resolve.packages[0].interfaces.consumer=1;
  raw.resolve.interfaces.push({name:'consumer',package:0,types:{thing:5},functions:{echo:fn(6,6)}});
  raw.resolve.types.push({name:'thing',owner:{interface:1},kind:{type:0}},{name:null,owner:null,kind:{handle:{own:5}}});
  const guest={[Symbol.dispose]() {}},events=[];
  const resources={borrow(ref,kind){events.push(['borrow',kind]);return guest;},consume(ref,kind){events.push(['consume',kind]);},own(kind,value){assert.equal(value,guest);events.push(['own',kind]);return {kind};}};
  assert.deepEqual(await new WitCallSchema(raw).invoke(second,'echo',[{}],{[second]:{echo:v=>v}},resources),{kind:`${iface}/thing`});
  assert.deepEqual(events.map(e=>e[0]),['borrow','consume','own']);
  assert.ok(events.every(e=>e[1]===`${iface}/thing`));
});

test('unit result cases use null in Native JSON and no val in nested Jco data', async () => {
  const types=[{result:{ok:null,err:null}},{record:{fields:[{name:'result',type:0}]}}];
  assert.deepEqual(await echo(types,1,{result:{ok:null}},v=>assert.deepEqual(v,{result:{tag:'ok'}})),{result:{ok:null}});
  const schema=new WitCallSchema(graph(types,{echo:fn('u8',0)}));
  assert.deepEqual(await schema.invoke(iface,'echo',[0],{[iface]:{echo(){}}},noResources),{ok:null});
});

test('consumed-own refs expire on success, declared errors and traps without double destruction',async()=>{
  const {BrowserResources}=await import('./browser-resources.ts');
  const raw=resourceGraph();raw.resolve.types.push({name:null,owner:null,kind:{result:{ok:null,err:'string'}}});raw.resolve.interfaces[0].functions.take.result=5;
  const schema=new WitCallSchema(raw),registry=new BrowserResources(),owner={};let drops=0;
  const resources={borrow:(ref,kind)=>registry.borrow(ref,owner,kind),consume:(ref,kind)=>registry.consume(ref,owner,kind),own:(kind,value)=>registry.own(owner,iface,kind,value)};
  const kind=`${iface}/thing`;
  for(const failure of [null,new Error('guest trap'),{declared:true,payload:'declared'}]){
    const ref=registry.own(owner,iface,kind,{[Symbol.dispose](){drops++;}});
    const call=()=>schema.invoke(iface,'take',[ref,1],{_util:{isComponentError:e=>e.declared===true},[iface]:{take(){assert.equal(registry.size,0);if(failure)throw failure;}}},resources);
    if(failure instanceof Error)await assert.rejects(call(),e=>e===failure);else assert.deepEqual(await call(),failure?{err:'declared'}:{ok:null});
    assert.throws(()=>registry.borrow(ref,owner,kind),/Unknown/);await assert.rejects(registry.release(ref),/Unknown/);
  }
  await registry.releaseOwner(owner);assert.equal(drops,0);
});

test('Jco casing handles valid uppercase and digit-led WIT parts while preserving JSON names',async()=>{
  const raw=graph([{record:{fields:[{name:'HTTP',type:'string'},{name:'version-2-FOO',type:'u8'}]}}],{HTTP:{name:'HTTP',kind:'freestanding',params:[{name:'value',type:0}],result:0}});
  assert.deepEqual(await new WitCallSchema(raw).invoke(iface,'HTTP',[{HTTP:'ok','version-2-FOO':3}],{[iface]:{http:v=>{assert.deepEqual(v,{http:'ok',version2Foo:3});return v;}}},noResources),{HTTP:'ok','version-2-FOO':3});
  const resource=resourceGraph();resource.resolve.types[0].name='HTTP';const methods=resource.resolve.interfaces[0].functions;resource.resolve.interfaces[0].functions={'[constructor]HTTP':{...methods['[constructor]thing'],name:'[constructor]HTTP'}};
  class Http{[Symbol.dispose]() {}}
  const ref=await new WitCallSchema(resource).invoke(iface,'[constructor]HTTP',['name'],{[iface]:{Http}},{...noResources,own:(kind,value)=>({kind,value})});
  assert.ok(ref.value instanceof Http);assert.equal(ref.kind,`${iface}/HTTP`);
});

test('resource dispatch rejects inherited classes and Object.prototype methods',async()=>{
  const raw=resourceGraph();const schema=new WitCallSchema(raw);
  class Thing{[Symbol.dispose]() {}}
  await assert.rejects(schema.invoke(iface,'[constructor]thing',['x'],{[iface]:Object.create({Thing})},{...noResources,own:()=>assert.fail('inherited constructor ran')}),/Missing callable/);
  for(const member of ['to-string','constructor']){
    const method=`[method]thing.${member}`;raw.resolve.interfaces[0].functions[method]={name:method,kind:{method:0},params:[{name:'self',type:3}],result:'string'};
    await assert.rejects(new WitCallSchema(raw).invoke(iface,method,[{}],{[iface]:{Thing}},{...noResources,borrow:()=>new Thing()}),/Missing callable/);
  }
});

test('empty resource members and wrong constructor ownership reject during schema validation',()=>{
  for(const tag of ['static','method']){
    const raw=resourceGraph(),key=`[${tag}]thing.`;raw.resolve.interfaces[0].functions[key]={name:key,kind:{[tag]:0},params:tag==='method'?[{name:'self',type:3}]:[],result:'string'};
    assert.throws(()=>new WitCallSchema(raw),/name mismatch/);
  }
  for(const result of [undefined,null,'string',3,4]){
    const raw=resourceGraph();raw.resolve.interfaces[0].functions['[constructor]thing'].result=result;
    assert.throws(()=>new WitCallSchema(raw),/constructor result/);
  }
});

test('variants, nested results, tagged options and flags require own discriminators/properties',async()=>{
  const types=[{variant:{cases:[{name:'none',type:null}]}},{flags:{flags:[{name:'read'}]}},{result:{ok:null,err:null}},{option:'u8'},{option:3}];
  const values={case:'none',tag:'none',read:true};
  for(const [key,value] of Object.entries(values))Object.defineProperty(Object.prototype,key,{configurable:true,value});
  try{
    await assert.rejects(echo(types,0,{}),/own WIT variant/);
    await assert.rejects(echo(types,1,[],()=>{},{ }),/flag boolean/);
    await assert.rejects(echo(types,4,1,()=>{},{}),/own Jco option tag/);
  }finally{for(const key of Object.keys(values))delete Object.prototype[key];}
  Object.defineProperty(Object.prototype,'tag',{configurable:true,value:'ok'});
  types.push({record:{fields:[{name:'nested',type:2}]}});
  try{await assert.rejects(echo(types,5,{nested:{ok:null}},()=>{},{nested:{}}),/result tag/);}finally{delete Object.prototype.tag;}
});

test('resource dispatch uses the declared alias class while registry identity stays canonical',async()=>{
  const raw=resourceGraph();raw.resolve.types.push({name:'local-thing',owner:{interface:0},kind:{type:0}},{name:null,owner:null,kind:{handle:{own:5}}},{name:null,owner:null,kind:{handle:{borrow:5}}});
  const functions=raw.resolve.interfaces[0].functions;
  functions['[constructor]local-thing']={name:'[constructor]local-thing',kind:{constructor:5},params:[],result:6};
  functions['[method]local-thing.read']={name:'[method]local-thing.read',kind:{method:5},params:[{name:'self',type:7}],result:'string'};
  class LocalThing{read(){assert.ok(this instanceof LocalThing);return 'alias';}[Symbol.dispose]() {}}
  const schema=new WitCallSchema(raw),bindings={[iface]:{LocalThing}},resources={...noResources,own:(kind,value)=>{assert.equal(kind,`${iface}/thing`);return{value};},borrow:ref=>ref.value};
  const ref=await schema.invoke(iface,'[constructor]local-thing',[],bindings,resources);
  assert.equal(await schema.invoke(iface,'[method]local-thing.read',[ref],bindings,resources),'alias');
});

test('enum and variant case spellings remain distinct even when Jco field casing would collide',async()=>{
  const types=[{enum:{cases:[{name:'HTTP'},{name:'http'}]}},{variant:{cases:[{name:'HTTP',type:null},{name:'http',type:null}]}}];
  for(const caseName of ['HTTP','http']){
    assert.equal(await echo(types,0,caseName),caseName);
    assert.deepEqual(await echo(types,1,{case:caseName,value:null}),{case:caseName,value:null});
  }
});
