import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserComponents } from './browser-components.ts';
import { BrowserStore } from './browser-storage.ts';
const bytes = Uint8Array.from([0,97,115,109,13,0,1,0]);
const encode = text => new TextEncoder().encode(text);
const options = { cwd: '/work', modulesDir: '/external/modules', pluginCacheDir: '/cache' };
const fsName = 'gams:fs/fs@1.2.0';
const layoutName = 'gams:layout/layout@1.0.0';
async function fixture(names = [fsName], bindings = {}) {
  const store = new BrowserStore({dir:{}});
  await store.mkdir('/work'); await store.mkdir('/external/modules'); await store.write('/work/plugin.wasm', bytes);
  let transpilations = 0, instantiations = 0, stops = 0;
  const injection = {
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
  await assert.rejects(f.manager.invoke('fs/fs::to-string',[]),/Unsupported/);
});
test('layout WIT field names, options, u64 generation and error records', async () => {
  let request;
  const f=await fixture([layoutName],{[layoutName]:{
    resizeScreen:value=>{request=value;return {document:{screenW:10,generation:2n,preview:undefined},info:{action:'resize-screen',generation:2n}};},
    initScreen:()=>{throw {declared:true,payload:{code:'invalid-arg',message:'bad'}};},
  }});
  await f.manager.add(['plugin.wasm']);
  assert.deepEqual(await f.manager.invoke('layout/layout::resize-screen',[{document:{'screen-w':1,generation:1,preview:null},'handle-half-size':2}]),
    {ok:{document:{'screen-w':10,generation:2,preview:null},info:{action:'resize-screen',generation:2}}});
  assert.deepEqual(request,{document:{screenW:1,generation:1n,preview:undefined},handleHalfSize:2});
  assert.deepEqual(await f.manager.invoke('layout/layout::init-screen',[{}]),{err:{code:'invalid-arg',message:'bad'}});
});
test('raw values stay raw; unknown ABIs, resources, inherited exports and ambiguity reject', async () => {
  const name='gams:random/seeded-random@1.0.0'; let seed;
  const f=await fixture([name,'gams:other/api@1.0.0'],{[name]:{getSeed:()=>7n,setSeed:value=>{seed=value;}}});
  await f.manager.add(['plugin.wasm']);
  assert.equal(await f.manager.invoke('random/seeded-random::get-seed',[]),7);
  assert.equal(await f.manager.invoke('random/seeded-random::set-seed',[42]),null); assert.equal(seed,42n);
  await assert.rejects(f.manager.invoke('other/api::run',[]),/No Host ABI adapter/);
  await assert.rejects(f.manager.invoke('random/seeded-random::to-string',[]),/Missing callable/);
  await assert.rejects(f.manager.invoke('random/seeded-random::[constructor]foo',[]),/resource/);
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
  await assert.rejects(f.manager.invoke('tile-detect/tile-detect::[constructor]tile',[]),/resource/);
});

test('Tile Detect support does not grant a different interface ABI version',async()=>{
  const name='gams:tile-detect/tile-detect@2.0.0';let calls=0;
  const f=await fixture([name],{[name]:{detectSize:()=>calls++}});
  await f.manager.add(['plugin.wasm']);
  await assert.rejects(f.manager.invoke('tile-detect/tile-detect::detect-size',[[],4,128]),/No Host ABI adapter/);
  assert.equal(calls,0);
});
