import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserComponents } from './browser-components.ts';
import { BrowserStore } from './browser-storage.ts';
import { testSchema, unfamiliarSchema } from './test-schemas.mjs';
const bytes = Uint8Array.from([0,97,115,109,13,0,1,0]);
const encode = text => new TextEncoder().encode(text);
const options = { cwd: '/work', modulesDir: '/external/modules', pluginCacheDir: '/cache' };
const fsName = 'gams:fs/fs@1.2.0';
const layoutName = 'gams:layout/layout@1.0.0';
async function fixture(names = [fsName], bindings = {}, schema = () => testSchema(names)) {
  const store = new BrowserStore({dir:{}});
  await store.mkdir('/work'); await store.mkdir('/external/modules'); await store.write('/work/plugin.wasm', bytes);
  let transpilations = 0, instantiations = 0, stops = 0;
  const injection = {
    schema,
    transpile: async () => { transpilations++; return { files: [['component.js',encode('bindings')], ['component.core.wasm',bytes]], imports: [], exports: names.map(name => [name,'instance']) }; },
    instantiate: async () => { instantiations++; return { ...bindings, _util: { isComponentError: error => error?.declared === true, whenIdle: async () => {}, stop: () => stops++ } }; },
  };
  return { store, injection, manager: new BrowserComponents(store, options, injection), counts: () => ({transpilations,instantiations,stops}) };
}
test('singletons, reload, cache survives restart without compiler initialization', async () => {
  const f = await fixture();
  const first = await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.add(['plugin.wasm']), first);
  assert.deepEqual(f.counts(), {transpilations:1,instantiations:1,stops:0});
  await f.manager.add(['plugin.wasm'], true);
  assert.deepEqual(f.counts(), {transpilations:1,instantiations:2,stops:1});
  await f.manager.close();
  const restarted = new BrowserComponents(f.store, options, {instantiate:f.injection.instantiate});
  await restarted.add(['plugin.wasm']);
  assert.equal((await restarted.diagnostics()).cacheHits,1);
  assert.equal((await restarted.diagnostics()).transpilations,0);
  await restarted.close(); await assert.rejects(restarted.add(['plugin.wasm']), /closed/);
});
test('durable artifacts precede completion marker; invoke does not flush', async () => {
  const f = await fixture([fsName], {[fsName]:{list:()=>[]}});
  const markers=[];
  f.store.flush = async () => { const [key] = await f.store.list('/cache'); markers.push((await f.store.list(`/cache/${key}`)).includes('complete')); };
  await f.manager.add(['plugin.wasm']); assert.deepEqual(markers,[false,true]);
  assert.deepEqual(await f.manager.invoke('fs/fs::list',['.']),{ok:[]}); assert.equal(markers.length,2);
});
test('corrupt/missing complete artifacts fail; incomplete cache recompiles; clearCache explicit', async () => {
  const f=await fixture(); await f.manager.add(['plugin.wasm']); await f.manager.close();
  const [key]=await f.store.list('/cache'); await f.store.write(`/cache/${key}/component.js`,encode('corrupt'));
  const next=new BrowserComponents(f.store,options,f.injection);
  await assert.rejects(next.add(['plugin.wasm']),/Corrupt/);
  await f.store.remove(`/cache/${key}/component.js`); await assert.rejects(next.add(['plugin.wasm']),/ENOENT/);
  await f.store.remove(`/cache/${key}/complete`); await next.add(['plugin.wasm']); assert.equal(f.counts().transpilations,2);
  await next.clearCache(); assert.equal((await next.diagnostics()).instances.length,1); await next.close();
  await new BrowserComponents(f.store,options,f.injection).add(['plugin.wasm']); assert.equal(f.counts().transpilations,3);
});
test('different bytes change cache key; invalid component never transpiles', async () => {
  const f=await fixture(); await assert.rejects(f.manager.loadFromBytes(new Uint8Array(),'bad'),/Component Model/);
  await f.manager.loadFromBytes(bytes,'one'); await f.manager.loadFromBytes(Uint8Array.from([...bytes,1]),'two');
  assert.equal((await f.store.list('/cache')).length,2); assert.equal(f.counts().transpilations,2);
});
test('fs modules alias, unchanged write payloads, declared errors versus traps', async () => {
  const calls=[];
  const declared=Object.assign(new Error('declared'),{declared:true,payload:'missing'});
  const f=await fixture([fsName],{[fsName]:{
    list:(...args)=>{calls.push(args);return [{name:'a',type:'file'}];},
    writeText:(...args)=>{calls.push(args);}, rename:(...args)=>{calls.push(args);},
    readText:()=>{throw declared;}, stat:()=>{throw new Error('trap');},
  }});
  await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.invoke('fs/fs::list',['gams_modules/lib']),{ok:[{name:'a',type:'file'}]});
  await f.manager.invoke('fs/fs::write-text',['a','/project/gams_modules/payload']);
  await f.manager.invoke('fs/fs::rename',['gams_modules/a','b']);
  assert.deepEqual(calls,[['gams_modules/lib'],['/project/a','/project/gams_modules/payload'],['gams_modules/a','/project/b']]);
  assert.deepEqual(await f.manager.invoke('fs/fs::read-text',['a']),{err:'missing'});
  await assert.rejects(f.manager.invoke('fs/fs::stat',['a']),/trap/);
  await assert.rejects(f.manager.invoke('fs/fs::list',['../bad']),/parent/);
  await assert.rejects(f.manager.invoke('fs/fs::to-string',[]),/Unsupported|Missing|schema|method|function/i);
});
test('layout WIT field names, options, u64 generation and error records', async () => {
  let request;
  const config={'max-areas':8,'max-handles':8,'min-panel-size':1,'handle-half-size':2};
  const document={'screen-w':1,'screen-h':1,config,generation:1,areas:[],handles:[],preview:null};
  const guestConfig={maxAreas:8,maxHandles:8,minPanelSize:1,handleHalfSize:2};
  const guestDocument={screenW:1,screenH:1,config:guestConfig,generation:1n,areas:[],handles:[],preview:undefined};
  const f=await fixture([layoutName],{[layoutName]:{
    resizeScreen:value=>{request=value;return {document:{...guestDocument,screenW:10,generation:2n},info:{action:'resize-screen',generation:2n}};},
    initScreen:()=>{throw {declared:true,payload:{code:'invalid-arg',message:'bad'}};},
  }});
  await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.invoke('layout/layout::resize-screen',[{document,w:10,h:1,'handle-half-size':2}]),
    {ok:{document:{...document,'screen-w':10,generation:2},info:{action:'resize-screen',generation:2}}});
  assert.deepEqual(request,{document:guestDocument,w:10,h:1,handleHalfSize:2});
  assert.deepEqual(await f.manager.invoke('layout/layout::init-screen',[{w:1,h:1,config,'root-content-id':'root'}]),{err:{code:'invalid-arg',message:'bad'}});
});

test('raw values stay raw; missing schema methods, inherited exports and ambiguity reject', async () => {
  const name='gams:random/seeded-random@1.0.0'; let seed;
  const f=await fixture([name],{[name]:{getSeed:()=>7n,setSeed:value=>{seed=value;}}});
  await f.manager.add(['plugin.wasm']);
  assert.equal(await f.manager.invoke('random/seeded-random::get-seed',[]),7);
  assert.equal(await f.manager.invoke('random/seeded-random::set-seed',[42]),null); assert.equal(seed,42n);
  await assert.rejects(f.manager.invoke('random/seeded-random::run',[]),/schema|method|function|Unsupported|Missing/i);
  await assert.rejects(f.manager.invoke('random/seeded-random::to-string',[]),/Missing|schema|method|function|Unsupported/i);
  await assert.rejects(f.manager.invoke('random/seeded-random::[constructor]foo',[]),/resource|schema|method|function|Unsupported|Missing/i);
  await f.manager.loadFromBytes(bytes,'second');
  await assert.rejects(f.manager.invoke('random/seeded-random::get-seed',[]),/Ambiguous/);
});
test('failed artifact checkpoint never writes completion marker', async () => {
  const f=await fixture(); f.store.flush=async()=>{throw new Error('disk failure');};
  await assert.rejects(f.manager.add(['plugin.wasm']),/disk failure/);
  const [key]=await f.store.list('/cache'); assert.ok(!(await f.store.list(`/cache/${key}`)).includes('complete'));
  assert.equal((await f.manager.diagnostics()).instances.length,0);
});
test('source gams_modules alias maps external store path, not Project-local path', async () => {
  const f=await fixture(); await f.store.write('/external/modules/hash/plugin.wasm',bytes);
  const [loaded]=await f.manager.add(['gams_modules/hash/plugin.wasm']);
  assert.equal(loaded.path,'/external/modules/hash/plugin.wasm');
  assert.deepEqual(await f.manager.loadFromBytes(bytes,'gams_modules/hash/plugin.wasm'),loaded);
  await assert.rejects(f.manager.add(['gams_modules/../escape']),/escapes/);
});
test('WASI random export is raw and accepts u64 length without guessing results', async () => {
  const name='wasi:random/random@0.2.0'; let length;
  const f=await fixture([name],{[name]:{getRandomBytes:value=>{length=value;return Uint8Array.of(4,5);}}});
  await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.invoke('random/random::get-random-bytes',[2]),[4,5]); assert.equal(length,2n);
});
test('failed completion checkpoint invalidates in-memory marker before retry', async () => {
  const f=await fixture(); let checkpoints=0;
  f.store.flush=async()=>{ if (++checkpoints === 2) throw new Error('marker failure'); };
  await assert.rejects(f.manager.add(['plugin.wasm']),/marker failure/);
  const [key]=await f.store.list('/cache'); assert.ok(!(await f.store.list(`/cache/${key}`)).includes('complete'));
  await f.manager.add(['plugin.wasm']); assert.equal(f.counts().transpilations,2);
});
test('guest paths reject reserved inherited-object segments before entering shim', async () => {
  let calls=0;
  const f=await fixture([fsName],{[fsName]:{list:()=>{calls++;return [];},rename:()=>{calls++;}}});
  await f.manager.add(['plugin.wasm']);
  for (const segment of ['__proto__','constructor','prototype']) {
    await assert.rejects(f.manager.invoke('fs/fs::list',[`gams_modules/${segment}/file`]),/EINVAL/);
    await assert.rejects(f.manager.invoke('fs/fs::rename',['valid',`sub/${segment}`]),/EINVAL/);
  }
  assert.equal(calls,0);
});

test('clearCache preserves unrelated files and refuses unfamiliar content in cache entries',async()=>{
  const f=await fixture();await f.manager.add(['plugin.wasm']);
  const [key]=await f.store.list('/cache');
  await f.store.write('/cache/personal.txt',encode('keep'));
  await f.store.write(`/cache/${key}/personal.txt`,encode('keep inside'));
  await assert.rejects(f.manager.clearCache(),/Refusing unfamiliar/);
  assert.equal(new TextDecoder().decode(await f.store.read(`/cache/${key}/personal.txt`)),'keep inside');
  await f.store.remove(`/cache/${key}/personal.txt`);await f.manager.clearCache();
  assert.deepEqual(await f.store.list('/cache'),['personal.txt']);
});

test('Tile Detect typed records, numeric lists and lossless hashes round-trip at Runtime boundary', async () => {
  const name='gams:tile-detect/tile-detect@1.0.0';
  const hash=18446744073709551615n;
  const extracted={tilebank:[{id:1,sourceIndex:0,hash}],tilemap:{width:2,height:1,tileW:8,tileH:8,data:Uint32Array.of(1,1)}};
  const calls=[];
  const f=await fixture([name],{[name]:{
    detectSize:(...args)=>{calls.push(args);return {tileW:8,tileH:8,confidence:0.5};},
    extract:(...args)=>{calls.push(args);return extracted;},
    exportTileset:(...args)=>{calls.push(args);return {data:Uint8Array.of(0,128,255),width:8,height:8,cols:1,rows:1};},
    toTilemap:(...args)=>{calls.push(args);return {layers:[{width:2,data:Uint32Array.of(1,1),props:[['name','extracted']]}],props:[['tileWidth','8']]};},
  }});
  await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.invoke('tile-detect/tile-detect::detect-size',[[0,128,255],4,128]),{ok:{'tile-w':8,'tile-h':8,confidence:0.5}});
  const input={'source-data':[0,128,255],'tile-w':8,'tile-h':8,tolerance:0,'skip-nth-pixel':1};
  const {ok:output}=await f.manager.invoke('tile-detect/tile-detect::extract',[input]);
  assert.deepEqual(output,{tilebank:[{id:1,'source-index':0,hash:hash.toString()}],tilemap:{width:2,height:1,'tile-w':8,'tile-h':8,data:[1,1]}});
  const exported=await f.manager.invoke('tile-detect/tile-detect::export-tileset',[{tilebank:output.tilebank,'source-data':[0,128,255],'source-cols':2,'tile-w':8,'tile-h':8}]);
  assert.deepEqual(exported,{ok:{data:[0,128,255],width:8,height:8,cols:1,rows:1}});
  assert.deepEqual(await f.manager.invoke('tile-detect/tile-detect::to-tilemap',[output]),{ok:{layers:[{width:2,data:[1,1],props:[['name','extracted']]}],props:[['tileWidth','8']]}});
  assert.deepEqual(calls,[
    [Uint8Array.of(0,128,255),4,128],
    [{sourceData:Uint8Array.of(0,128,255),tileW:8,tileH:8,tolerance:0,skipNthPixel:1}],
    [{tilebank:extracted.tilebank,sourceData:Uint8Array.of(0,128,255),sourceCols:2,tileW:8,tileH:8}],
    [extracted],
  ]);
  assert.deepEqual(input['source-data'],[0,128,255]);
});

test('Tile Detect declared errors stay results, traps propagate and invalid calls never reach guest', async () => {
  const name='gams:tile-detect/tile-detect@1.0.0';let calls=0;
  const f=await fixture([name],{[name]:{
    detectSize:()=>{calls++;throw {declared:true,payload:'failed to load image'};},
    extract:()=>{calls++;throw new Error('guest trap');},
  }});
  await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.invoke('tile-detect/tile-detect::detect-size',[[],4,128]),{err:'failed to load image'});
  await assert.rejects(f.manager.invoke('tile-detect/tile-detect::extract',[{'source-data':[],'tile-w':0,'tile-h':8,tolerance:0,'skip-nth-pixel':1}]),/guest trap/);
  const invalid=[
    ['detect-size',[[256],4,128]],['detect-size',[[1],-1,128]],['detect-size',[[1],4]],
    ['extract',[{'source-data':[],'tile-w':8}]],['to-string',[]],
    ['to-tilemap',[{tilebank:[{id:1,'source-index':0,hash:9007199254740992}],tilemap:{width:1,height:1,'tile-w':8,'tile-h':8,data:[1]}}]],
    ['to-tilemap',[{tilebank:[],tilemap:{width:1,height:1,'tile-w':8,'tile-h':8,data:[4294967296]}}]],
  ];
  for(const [method,args] of invalid)await assert.rejects(f.manager.invoke(`tile-detect/tile-detect::${method}`,args));
  assert.equal(calls,2);
  await assert.rejects(f.manager.invoke('tile-detect/tile-detect::[constructor]tile',[]),/resource|schema|method|function|Unsupported|Missing/i);
});

test('Tile Detect requires the requested namespace and version to match its schema',async()=>{
  const name='gams:tile-detect/tile-detect@1.0.0';let calls=0;
  const f=await fixture([name],{[name]:{detectSize:()=>calls++}});
  await f.manager.add(['plugin.wasm']);
  await assert.rejects(f.manager.invoke('tile-detect/tile-detect@2.0.0::detect-size',[[],4,128]));
  await assert.rejects(f.manager.invoke('other:tile-detect/tile-detect::detect-size',[[],4,128]));
  assert.equal(calls,0);
});

test('schema is extracted once and durably hashed; offline cache never initializes extractor',async()=>{
  let extractions=0;
  const f=await fixture([fsName],{[fsName]:{list:()=>[]}},async source=>{assert.deepEqual(source,bytes);extractions++;return testSchema([fsName]);});
  const instantiate=f.injection.instantiate;
  f.injection.instantiate=(output,...args)=>{assert.ok(output.files.every(([name])=>name!=='schema.json'));return instantiate(output,...args);};
  await f.manager.add(['plugin.wasm']);await f.manager.add(['plugin.wasm'],true);
  assert.equal(extractions,1);
  const [key]=await f.store.list('/cache');
  const manifest=JSON.parse(new TextDecoder().decode(await f.store.read(`/cache/${key}/manifest.json`)));
  assert.equal(manifest.identity.schema,2);
  const schemaFile=manifest.files.find(file=>file.name==='schema.json');assert.ok(schemaFile);
  const schemaBytes=await f.store.read(`/cache/${key}/schema.json`);
  assert.equal(schemaFile.hash,Buffer.from(await crypto.subtle.digest('SHA-256',schemaBytes)).toString('hex'));
  await f.manager.close();
  const restarted=new BrowserComponents(f.store,options,{instantiate:f.injection.instantiate,schema:()=>assert.fail('cached schema must not be re-extracted'),transpile:()=>assert.fail('cached bindings must not be recompiled')});
  await restarted.add(['plugin.wasm']);assert.deepEqual(await restarted.invoke('fs/fs::list',['.']),{ok:[]});await restarted.close();
});

test('complete cache rejects changed or missing schema instead of falling back',async()=>{
  const f=await fixture();await f.manager.add(['plugin.wasm']);await f.manager.close();
  const [key]=await f.store.list('/cache');
  await f.store.write(`/cache/${key}/schema.json`,encode('{}'));
  const next=new BrowserComponents(f.store,options,f.injection);
  await assert.rejects(next.add(['plugin.wasm']),/Corrupt/);
  await f.store.remove(`/cache/${key}/schema.json`);
  await assert.rejects(next.add(['plugin.wasm']),/ENOENT/);
  assert.equal(f.counts().transpilations,1);assert.equal(f.counts().instantiations,1);
});

test('missing, malformed and mismatched extracted schemas never instantiate or mark complete',async()=>{
  for(const schema of [()=>undefined,()=>({world:0,resolve:{}}),()=>unfamiliarSchema()]){
    const f=await fixture([fsName],{},schema);await f.store.mkdir('/cache');
    await assert.rejects(f.manager.add(['plugin.wasm']));assert.equal(f.counts().instantiations,0);
    for(const key of await f.store.list('/cache'))assert.ok(!(await f.store.list(`/cache/${key}`)).includes('complete'));
  }
});

test('unfamiliar schema drives generic operation and exact namespace/version resolution',async()=>{
  const names=['acme:metrics/counter@2.3.0','other:metrics/counter@2.3.0','acme:metrics/counter@3.0.0'];
  const calls=[];
  const f=await fixture(names,Object.fromEntries(names.map((name,index)=>[name,{nextValue:value=>{calls.push([name,value]);return value+BigInt(index+1);}}])),()=>unfamiliarSchema(names));
  await f.manager.add(['plugin.wasm']);
  assert.equal(await f.manager.invoke('acme:metrics/counter@2.3.0::next-value',['18446744073709551610']),'18446744073709551611');
  assert.equal(await f.manager.invoke('other:metrics/counter::next-value',[1]),3);
  assert.equal(await f.manager.invoke('acme:metrics/counter@3.0.0::next-value',[1]),4);
  await assert.rejects(f.manager.invoke('metrics/counter::next-value',[1]),/Ambiguous/i);
  await assert.rejects(f.manager.invoke('acme:metrics/counter@9.0.0::next-value',[1]));
  await assert.rejects(f.manager.invoke('unknown:metrics/counter::next-value',[1]));
  await assert.rejects(f.manager.invoke('acme:metrics/counter@2.3.0::missing',[1]));
  assert.equal(calls.length,3);assert.equal(calls[0][1],18446744073709551610n);
});

test('valid uppercase WIT identifiers pass target selection without changing their public spelling',async()=>{
  const name='ACME:METRICS/API@1.0.0',schema=unfamiliarSchema([name]);
  const fn=schema.resolve.interfaces[0].functions['next-value'];fn.name='HTTP';
  schema.resolve.interfaces[0].functions={HTTP:fn};
  const f=await fixture([name],{[name]:{http:v=>v+1n}},()=>schema);
  await f.manager.add(['plugin.wasm']);
  assert.equal(await f.manager.invoke('ACME:METRICS/API@1.0.0::HTTP',[41]),42);
  await f.manager.close();
});
