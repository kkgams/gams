import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BrowserComponents } from './browser-components.ts';
import { TestMemoryStore } from './test-memory-store.mjs';
import { unfamiliarSchema } from './test-schemas.mjs';

// Actual plugin.js componentWitJson graph; runtime import version is not
// present in Jco's import key, so capability checks must use the WIT graph.
const jsSchema = JSON.parse(readFileSync(new URL('./fixtures/js.json', import.meta.url)));
const jsName = 'gams:js/js@1.0.0';
const runtimeName = 'gams:runtime/runtime';
const counterName = 'acme:metrics/counter@2.3.0';
const options = { cwd:'/work', modulesDir:'/modules', pluginCacheDir:'/cache' };
async function fixture(graph = jsSchema, next = n=>n+1n) {
  const store = new TestMemoryStore({ dir:{} });
  for (const path of ['/work','/modules']) await store.mkdir(path);
  for (let id=0; id<2; id++) await store.write(`/work/${id}.wasm`, Uint8Array.of(0,97,115,109,13,0,1,0,id));
  let provider, generation;
  const manager = new BrowserComponents(store,options,{
    schema: bytes => bytes[8] ? unfamiliarSchema([counterName]) : graph,
    transpile: (bytes,opts) => {
      if (!bytes[8]) generation=opts;
      return {files:[['component.js',new TextEncoder().encode('fixture')]],imports:bytes[8]?[]:[runtimeName],exports:[[bytes[8]?counterName:jsName,'instance']]};
    },
    instantiate: async (output,imports) => {
      if (output.imports.length) {
        provider=imports.get(runtimeName);
        return {[jsName]:{run: async source => {
          const {target,args}=JSON.parse(source);
          return provider.call(target,args);
        }}};
      }
      return {[counterName]:{nextValue:next}};
    },
  });
  return {store,manager,provider:()=>provider,generation:()=>generation};
}
test('version-checked Runtime callback uses JSPI only for importing components',async()=>{
  const h=await fixture();await h.manager.add(['0.wasm','1.wasm']);
  assert.equal(h.generation().bindgenEnableWasmExnref,true);
  assert.deepEqual(h.generation().asyncMode,{tag:'jspi',val:{imports:[`${runtimeName}#call`],exports:['*']}});
  const result=await h.manager.invoke('js/js::run',[JSON.stringify({target:`${counterName}::next-value`,args:'["18446744073709551610"]'})]);
  assert.deepEqual(JSON.parse(result.ok),'18446744073709551611');
  await h.manager.close();
});
test('Runtime callback validates targets/JSON, preserves declared errors and rejects cycles',async()=>{
  const h=await fixture();await h.manager.add(['0.wasm','1.wasm']);const call=h.provider().call;
  for (const args of ['invalid','null','{}']) await assert.rejects(call(`${counterName}::next-value`,args),/JSON|array/);
  for (const target of ['gams:shell/shell@1.0.0::run','gams/host::missing','missing/api::run','other:metrics/counter::next-value']) await assert.rejects(call(target,'[]'),/Missing|denied|Unsupported/);
  await assert.rejects(call('__proto__.method','[]'),/View|registered|bridge/);
  const recursive=JSON.stringify({target:'js/js::run',args:JSON.stringify(['anything'])});
  await assert.rejects(h.manager.invoke('js/js::run',[recursive]),/already active|reentrant|cycle/);
  assert.equal(await call(`${counterName}::next-value`,'[1]'),'2');
  await h.manager.close();await assert.rejects(call(`${counterName}::next-value`,'[1]'),/closed/);
});
test('Runtime callback bridges only dotted registered UI targets and returns JSON strings',async()=>{
  const h=await fixture();const calls=[];
  h.manager.callView=async(target,args)=>{calls.push([target,args]);if(target==='view.fail')throw Error('View failure');return JSON.stringify({ok:JSON.parse(args)});};
  await h.manager.add(['0.wasm']);
  assert.equal(await h.provider().call('view.echo','["café",42]'),'{"ok":["café",42]}');
  assert.deepEqual(calls,[['view.echo','["café",42]']]);
  await assert.rejects(h.provider().call('view.fail','[]'),/View failure/);
  await assert.rejects(h.provider().call('view.echo','{}'),/array/);
  await h.manager.close();
});
test('versionless generated import cannot grant a different WIT Runtime ABI',async()=>{
  const graph=structuredClone(jsSchema);graph.resolve.packages.find(p=>p.name==='gams:runtime@1.0.0').name='gams:runtime@2.0.0';
  const h=await fixture(graph);await assert.rejects(h.manager.add(['0.wasm']),/denied.*runtime|Unsupported.*runtime/i);
});

test('router failures have explicit declared-error payloads but core traps retain identity',async()=>{
  const h=await fixture(jsSchema,()=>{throw new WebAssembly.RuntimeError('actual core trap');});
  await h.manager.add(['0.wasm','1.wasm']);const call=h.provider().call;
  await assert.rejects(call('missing/api::run','[]'),e=>e.payload===e.message && /Missing/.test(e.payload));
  await assert.rejects(call('missing/api::run','bad json'),e=>typeof e.payload==='string');
  await assert.rejects(call(`${counterName}::next-value`,'[1]'),e=>e instanceof WebAssembly.RuntimeError && !Object.hasOwn(e,'payload'));
  await h.manager.close();
});

test('matching Runtime import name cannot substitute a different function contract',async()=>{
  const mutations=[
    (g,f)=>{f.params[0].type='u32';},
    (g,f)=>{f.params.pop();},
    (g,f)=>{f.result='string';},
    (g,f)=>{g.resolve.types[f.result].kind.result.err='u32';},
    (g,f)=>{g.resolve.types[f.result].kind.result.ok=null;},
    (g,f)=>{g.resolve.interfaces[0].functions.extra={...structuredClone(f),name:'extra'};},
  ];
  for(const mutate of mutations){const graph=structuredClone(jsSchema);mutate(graph,graph.resolve.interfaces[0].functions.call);const h=await fixture(graph);await assert.rejects(h.manager.add(['0.wasm']),/denied Runtime import ABI/);}
});

test('a supported Runtime import cannot authorize a second ABI hidden by a versionless key',async()=>{
  const graph=structuredClone(jsSchema),r=graph.resolve,id=r.interfaces.length,pkg=r.packages.length;
  r.interfaces.push({...structuredClone(r.interfaces[0]),package:pkg});
  r.packages.push({name:'gams:runtime@2.0.0',interfaces:{runtime:id},worlds:{}});
  r.worlds[0].imports['interface-2']={interface:{id}};
  const h=await fixture(graph);await assert.rejects(h.manager.add(['0.wasm']),/denied WIT import/);
});

test('unclassified callee failures remain traps instead of becoming router string errors',async()=>{
  const original=new Error('Component exited successfully');
  const h=await fixture(jsSchema,()=>{throw original;});await h.manager.add(['0.wasm','1.wasm']);
  await assert.rejects(h.manager.invoke(`${counterName}::next-value`,[1]),e=>e===original);
  await assert.rejects(h.provider().call(`${counterName}::next-value`,'[1]'),e=>e instanceof WebAssembly.RuntimeError&&e.message===original.message);
  await h.manager.close();
});
