import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserComponents} from './browser-components.ts';
import {BrowserStore} from './browser-storage.ts';
import {testSchema} from './test-schemas.mjs';
const types='wasi:sql/types@0.2.0-draft', readwrite='wasi:sql/readwrite@0.2.0-draft';
const component=Uint8Array.from([0,97,115,109,13,0,1,0]);
const dispose=Symbol.dispose||Symbol.for('dispose');
async function fixture(){
  const store=new BrowserStore({dir:{}});await store.mkdir('/work');await store.mkdir('/modules');await store.write('/work/sql.wasm',component);
  const events=[];let calls=0;
  const manager=new BrowserComponents(store,{cwd:'/work',modulesDir:'/modules',pluginCacheDir:'/cache'},{
    schema:()=>testSchema([types,readwrite]),
    transpile:()=>({files:[['component.js',new TextEncoder().encode('sql')]],imports:[],exports:[[types,'instance'],[readwrite,'instance']]}),
    instantiate:()=>{
      class Resource{constructor(kind){this.kind=kind;}[dispose](){events.push(`drop:${this.kind}`);}}
      class SqlError extends Resource{constructor(text){super('error');this.text=text;}trace(){assert.ok(this instanceof SqlError);calls++;return this.text;}}
      class Connection extends Resource{static open(name){calls++;if(name==='bad')throw{declared:true,payload:new SqlError('cannot open')};if(name==='trap')throw Error('guest trap');return new Connection('connection');}}
      class Statement extends Resource{static prepare(query,params){calls++;const s=new Statement('statement');s.query=query;s.params=params;return s;}}
      return {[types]:{Connection,Statement,Error:SqlError},[readwrite]:{
        query:(c,s)=>{calls++;assert.ok(c instanceof Connection);assert.ok(s instanceof Statement);if(s.query==='bad')throw{declared:true,payload:new SqlError('no such table')};return [{fieldName:'n',value:{tag:'int64',val:9223372036854775807n}},{fieldName:'b',value:{tag:'binary',val:new Uint8Array([0,255])}},{fieldName:'empty',value:{tag:'null'}}];},
        exec:(c,s)=>{calls++;assert.ok(c instanceof Connection);assert.ok(s instanceof Statement);return 1;},
      },_util:{whenIdle:async()=>{},stop:()=>events.push('stop'),isComponentError:e=>e.declared===true}};
    },
  });await manager.add(['sql.wasm']);return{manager,events,calls:()=>calls};
}
const open=m=>m.invoke('sql/types::[static]connection.open',['memory']).then(r=>r.ok);
const prepare=(m,query='select')=>m.invoke('sql/types::[static]statement.prepare',[query,[]]).then(r=>r.ok);
test('SQL static calls, borrowed query/exec and Native cells preserve resource ownership',async()=>{
  const {manager}=await fixture();const {ok:c}=await manager.invoke('wasi:sql/types@0.2.0-draft::[static]connection.open',['memory']);const s=await prepare(manager);
  assert.equal(c.$resource,'wasi:sql/types');assert.notEqual(c.id,s.id);
  assert.deepEqual(await manager.invoke('sql/readwrite::query',[c,s]),{ok:[{'field-name':'n',value:{case:'int64',value:'9223372036854775807'}},{'field-name':'b',value:{case:'binary',value:[0,255]}},{'field-name':'empty',value:{case:'null',value:null}}]});
  assert.deepEqual(await manager.invoke('sql/readwrite::exec',[c,s]),{ok:1});
  assert.equal((await manager.diagnostics()).jsonResourceRefs,2);
  await manager.releaseResource(s);await manager.releaseResource(c);assert.equal((await manager.diagnostics()).jsonResourceRefs,0);await manager.close();
});
test('SQL declared errors retain returning origin and trace as a raw string; traps reject',async()=>{
  const {manager}=await fixture();const {err:openError}=await manager.invoke('sql/types::[static]connection.open',['bad']);
  assert.equal(openError.$resource,'wasi:sql/types');assert.equal(await manager.invoke('sql/types::[method]error.trace',[openError]),'cannot open');await manager.releaseResource(openError);
  const c=await open(manager),s=await prepare(manager,'bad');const {err}=await manager.invoke('sql/readwrite::query',[c,s]);assert.equal(err.$resource,'wasi:sql/readwrite');
  assert.equal(await manager.invoke('sql/types::[method]error.trace',[err]),'no such table');
  await assert.rejects(manager.invoke('sql/types::[method]error.trace',[{...err,$resource:'wasi:sql/types'}]),/origin/i);
  await manager.releaseResource(err);await assert.rejects(manager.invoke('sql/types::[method]error.trace',[err]),/unknown resource/i);
  await assert.rejects(manager.releaseResource(err),/unknown resource/i);await assert.rejects(manager.invoke('sql/types::[static]connection.open',['trap']),/guest trap/);
  await manager.close();assert.equal((await manager.diagnostics()).jsonResourceRefs,0);
});
test('SQL validates targets, arity, string params, kind and owner before guest entry',async()=>{
  const {manager,calls}=await fixture();const c=await open(manager),s=await prepare(manager);const before=calls();
  for(const [target,args] of [
    ['sql/types::[static]connection.open',[]],['sql/types::[static]connection.open',[12]],
    ['sql/types::[static]statement.prepare',['q',[1]]],['sql/types::[static]statement.prepare',['q',null]],
    ['sql/types::[method]error.trace',[c]],['sql/readwrite::query',[s,c]],['sql/readwrite::exec',[c]],
    ['sql/types::open',['memory']],['sql/types::[static]error.open',['memory']],
    ['sql/types::[method]connection.close',[c]],['sql/readwrite::[method]error.trace',[c]],
    ['gams:sql/types::[static]connection.open',['memory']],['sql/types@9.0.0::[static]connection.open',['memory']],
  ]) await assert.rejects(manager.invoke(target,args));
  assert.equal(calls(),before);
  const other=await fixture();await assert.rejects(other.manager.invoke('sql/readwrite::query',[c,s]),/unknown resource/i);await other.manager.close();
  await manager.loadFromBytes(component,'second.wasm');await assert.rejects(manager.invoke('sql/readwrite::query',[c,s]),/ambiguous/i);await manager.close();
});
test('SQL replacement and shutdown destroy connection, statement and error refs before stop',async()=>{
  const {manager,events}=await fixture();const c=await open(manager);await prepare(manager);await manager.invoke('sql/types::[static]connection.open',['bad']);
  await manager.add(['sql.wasm'],true);assert.deepEqual(events,['drop:connection','drop:statement','drop:error','stop']);
  await assert.rejects(manager.invoke('sql/readwrite::query',[c,c]),/unknown resource/i);
  await open(manager);await prepare(manager);await manager.close();assert.deepEqual(events.slice(4),['drop:connection','drop:statement','stop']);assert.equal((await manager.diagnostics()).jsonResourceRefs,0);
});

test('generic SQL schema preserves every declared cell variant and rejects malformed output',async()=>{
  const {WitCallSchema}=await import('./wit-call.ts');
  const schema=new WitCallSchema(testSchema([types,readwrite]));
  const variants=[['int32',-2147483648],['int64',-9223372036854775808n],['uint32',4294967295],['uint64',18446744073709551615n],['float',1.25],['double',2.5],['str','café ✓'],['boolean',true],['date','2026-11-16'],['time','12:34'],['timestamp','2026-11-16T12:34:00Z'],['binary',new Uint8Array([0,128,255])],['null']];
  const resources={borrow:()=>({}),consume:()=>assert.fail('unexpected own'),own:()=>assert.fail('unexpected resource output')};
  const bindings={[readwrite]:{query:()=>variants.map(([tag,val])=>({fieldName:tag,value:tag==='null'?{tag}:{tag,val}}))}};
  assert.deepEqual(await schema.invoke(readwrite,'query',[{},{}],bindings,resources),{ok:variants.map(([tag,val])=>({'field-name':tag,value:{case:tag,value:tag==='null'?null:typeof val==='bigint'?val.toString():val instanceof Uint8Array?Array.from(val):val}}))});
  for(const cells of [null,{},[null],[{}],[{fieldName:'x',value:{tag:'unknown',val:1}}],[{fieldName:'x',value:{tag:'str'}}],[{fieldName:'x',value:{tag:'double',val:Infinity}}]]){
    bindings[readwrite].query=()=>cells;
    await assert.rejects(schema.invoke(readwrite,'query',[{},{}],bindings,resources));
  }
});
