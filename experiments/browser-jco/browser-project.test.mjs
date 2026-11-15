import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BrowserProject } from './browser-project.ts';
import { parseBrowserOptions } from './browser-options.ts';

const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const text = value => new TextDecoder().decode(value);
const options = { cwd: '/project', config: 'gams.dev.json', modulesDir: '/shared/modules', pluginCacheDir: '/compiled' };
class FakeStore {
  entries = new Map([['/', null]]);
  operations = [];
  async stat(path) { this.check(path); return this.entries.get(path) === null ? 'directory' : 'file'; }
  check(path) { assert.ok(path.startsWith('/')); if (!this.entries.has(path)) throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' }); }
  async read(path) { this.check(path); assert.notEqual(this.entries.get(path), null); return this.entries.get(path).slice(); }
  async mkdir(path) { this.entries.set(path, null); this.operations.push(['mkdir', path]); }
  async write(path, value) { this.entries.set(path, value.slice()); this.operations.push(['write', path]); }
  async list(path) { return [...this.entries.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(key => key.slice(path.length + 1)); }
  async remove(path) { for (const key of this.entries.keys()) if (key === path || key.startsWith(path + '/')) this.entries.delete(key); this.operations.push(['remove', path]); }
  async rename(from, to) { assert.ok(!this.entries.has(to)); for (const [path, value] of [...this.entries]) if (path === from || path.startsWith(from + '/')) { this.entries.set(to + path.slice(from.length), value); this.entries.delete(path); } this.operations.push(['rename', from, to]); }
  async flush() { this.operations.push(['flush']); }
  async seed(config, files = {}) { await this.mkdir('/project'); await this.write('/project/gams.dev.json', bytes(config)); for (const [path, value] of Object.entries(files)) await this.write('/project/' + path, bytes(value)); return this; }
}
function downloader(files, calls = []) { return async (url, progress) => { calls.push(url); assert.ok(Object.hasOwn(files, url), `unexpected download ${url}`); const value = bytes(files[url]); progress?.({downloaded: value.length, total: value.length}); return value; }; }
const offline = async () => { throw new Error('offline'); };

test('selected filename, original snapshots, no bundled config fallback', async () => {
  const store = await new FakeStore().seed({name: 'selected'});
  const project = new BrowserProject(store, options);
  assert.deepEqual(await project.load(), {config: {name:'selected'}, configFile:'gams.dev.json', modulesDir:'/shared/modules'});
  const original = project.originalConfig; original.name = 'mutated'; assert.equal(project.originalConfig.name, 'selected');
  await store.remove('/project/gams.dev.json'); await store.write('/project/gams.json', bytes({wrong:true}));
  await assert.rejects(new BrowserProject(store, options).load(), /missing Project resource/);
  for (const config of ['', '../gams.json', '/gams.json', 'a/b.json', '.', '..']) assert.throws(() => new BrowserProject(store, {...options, config}), /filename/);
});

test('local recursive refs, pointers, arrays and document-relative files', async () => {
  const original = {data: {$ref:'config/a.json#/items/0'}, again: {$ref:'#/data'}, slash: {$ref:'config/a.json#/a~1b/~0'}, empty: {$ref:'config/a.json#/'}};
  const store = await new FakeStore().seed(original, {'config/a.json': {items:[{nested:{$ref:'b.json'}, file:{$file:'image.bin'}}], 'a/b': {'~': 3}, '': 9}, 'config/b.json': {ok:true}, 'config/image.bin':'image'});
  const project = new BrowserProject(store, options); const {config} = await project.load();
  assert.deepEqual(config, {data:{nested:{ok:true},file:'config/image.bin'},again:{nested:{ok:true},file:'config/image.bin'},slash:3,empty:9});
  assert.deepEqual(await project.prepareConfig(config), original);
});

test('cycles, pointers, malformed expressions and missing selected config fail', async () => {
  for (const [config, files, message] of [
    [{x:{$ref:'#/x'}},{}, /circular/],
    [{x:{$ref:'a.json'}},{'a.json':{$ref:'gams.dev.json'}}, /circular/],
    [{x:{$ref:'#'}},{}, /circular/],
    [{x:{$ref:'#/missing'}},{}, /missing JSON pointer/],
    [{x:{$ref:'a.json#/a~2'}},{'a.json':{'a~2':1}}, /pointer escape/],
    [{x:{$file:'a', other:1}},{}, /siblings/],
    [{x:{$ref:42}},{}, /descriptor/],
    [[],{}, /JSON object/],
  ]) await assert.rejects(new BrowserProject(await new FakeStore().seed(config,files),options).load(), message);
});

test('same-origin static source uses selected filename and owning document base, persists original bytes', async () => {
  globalThis.location = {href:'http://localhost:8123/host/index.html', origin:'http://localhost:8123'};
  try {
    const calls = []; const original = '{ "data": {"$ref":"config/data.json"} }\n';
    const store = new FakeStore();
    const project = new BrowserProject(store, {...options,source:'/external'}, {download:downloader({
      'http://localhost:8123/external/gams.dev.json':original,
      'http://localhost:8123/external/config/data.json':{file:{$file:'icon.png'}},
      'http://localhost:8123/external/config/icon.png':'png',
    },calls)});
    assert.deepEqual((await project.load()).config, {data:{file:'config/icon.png'}});
    assert.equal(text(await store.read('/project/gams.dev.json')),original);
    assert.deepEqual(calls, ['http://localhost:8123/external/gams.dev.json','http://localhost:8123/external/config/data.json','http://localhost:8123/external/config/icon.png']);
    assert.deepEqual((await new BrowserProject(store,options,{download:offline}).load()).config,{data:{file:'config/icon.png'}});
    assert.doesNotThrow(() => new BrowserProject(store,{...options,source:'https://other.test/project'}));
    assert.throws(() => new BrowserProject(store,{...options,source:'http://other.test/project'}), /HTTPS/);
    assert.throws(() => new BrowserProject(store,{...options,source:'https://user:password@other.test/project'}), /credentials/);
    assert.throws(() => new BrowserProject(store,{...options,source:'file:///project'}), /URL/);
  } finally { delete globalThis.location; }
});

test('remote refs retain remote document base and completed URL caches work offline', async () => {
  const store = await new FakeStore().seed({data:{$ref:'https://cdn.test/folder/a.json#/data'}});
  const calls = []; const project = new BrowserProject(store,options,{download:downloader({
    'https://cdn.test/folder/a.json':{data:{nested:{$ref:'nested/b.json'},file:{$file:'asset.bin'}}},
    'https://cdn.test/folder/nested/b.json':{ok:true}, 'https://cdn.test/folder/asset.bin':'binary',
  },calls)});
  const snapshots = []; project.onProgress = value => snapshots.push(value);
  const {config} = await project.load(); assert.equal(config.data.nested.ok,true);
  assert.match(config.data.file,/^gams_modules\/[a-f0-9]{64}\/asset.bin$/);
  assert.equal(calls.length,3); assert.equal(project.progress.status,'ready'); assert.equal(project.progress.completed,3);
  snapshots[0].status='mutated'; assert.equal(project.progress.status,'ready');
  const copy = new BrowserProject(store,options,{download:offline}); assert.deepEqual((await copy.load()).config,config);
  assert.ok(copy.progress.resources.every(event => event.cached));
  config.data.nested.ok = false; const saved = await project.prepareConfig(config);
  assert.deepEqual(saved.data.file,{$file:'https://cdn.test/folder/asset.bin'});
  assert.equal(saved.data.nested.ok,false);
});

test('ZIP full extraction, selector sharing, local guest aliases, offline missing selector, durable marker order', async () => {
  const url='https://cdn.test/units.zip?version=1'; const original = {
    item:{$ref:{url,entry:'config/main.json',pointer:'/item'}},
    plugin:{$file:{url,entry:'plugins/a.wasm'}}, root:{$file:{url}},
  };
  const store=await new FakeStore().seed(original); let downloads=0; let unzips=0;
  const members = [
    {name:'config/main.json',bytes:bytes({item:{asset:{$file:'../assets'},nested:{$ref:'nested.json#/value'}}})},
    {name:'config/nested.json',bytes:bytes({value:42})}, {name:'assets/',directory:true},
    {name:'assets/icon.png',bytes:new Uint8Array([0,255,42])},
    {name:'LICENSE',bytes:bytes('all notices retained')}, {name:'plugins/a.wasm',bytes:bytes('component')},
  ];
  const project=new BrowserProject(store,options,{download:async()=>{downloads++;return bytes('archive');},unzip:async()=>{unzips++;return members;}});
  const {config}=await project.load();
  assert.equal(downloads,1); assert.equal(unzips,1); assert.equal(config.item.nested,42);
  assert.equal(config.item.asset,config.root+'/assets');
  assert.deepEqual(await store.read('/shared/modules/'+config.root.slice('gams_modules/'.length)+'/assets/icon.png'),new Uint8Array([0,255,42]));
  assert.equal(text(await store.read('/shared/modules/'+config.root.slice('gams_modules/'.length)+'/LICENSE')),'all notices retained');
  const markerIndex=store.operations.findIndex(([op,path])=>op==='write'&&path.endsWith('/.gams-resource.json'));
  assert.equal(store.operations[markerIndex-1][0],'flush'); assert.equal(store.operations[markerIndex+1][0],'flush');
  assert.equal(store.operations[markerIndex+2][0],'rename');
  assert.deepEqual(await project.prepareConfig(config),original);
  const offlineProject=new BrowserProject(store,options,{download:offline,unzip:async()=>assert.fail('must not unzip')});
  await assert.rejects(offlineProject.resolveFile({url,entry:'missing.js'}),/missing cached resource selector/);
  assert.equal(downloads,1);
  const hash=createHash('sha256').update(url).digest('hex'); assert.equal(config.root,'gams_modules/'+hash);
});

test('concurrent same URL shares one install; distinct query strings have distinct cache keys', async () => {
  const store=new FakeStore(); let calls=0;
  const project=new BrowserProject(store,options,{download:async()=>{calls++; await new Promise(resolve=>setTimeout(resolve,5)); return bytes('wasm');}});
  const paths=await Promise.all([project.resolveFile('https://cdn.test/a.wasm?v=1'),project.resolveFile('https://cdn.test/a.wasm?v=1')]);
  assert.equal(paths[0],paths[1]); assert.equal(calls,1);
  assert.notEqual(await project.resolveFile('https://cdn.test/a.wasm?v=2'),paths[0]); assert.equal(calls,2);
});

test('changed Save flattens only edited refs, restores sibling/subtree expressions, and handles changed dependencies', async () => {
  const original={source:{value:1},copy:{$ref:'#/source'},group:{kept:{$ref:'data.json'},edit:{$ref:'data.json'}},plugin:{$file:'https://cdn.test/a.wasm'}};
  const store=await new FakeStore().seed(original,{'data.json':{value:7}});
  const project=new BrowserProject(store,options,{download:async()=>bytes('wasm')});
  const {config}=await project.load(); config.source.value=2; config.group.edit.value=8;
  const saved=await project.prepareConfig(config);
  assert.deepEqual(saved,{source:{value:2},copy:{value:1},group:{kept:{$ref:'data.json'},edit:{value:8}},plugin:original.plugin});
  await store.write('/project/gams.dev.json',bytes(saved));
  assert.deepEqual((await new BrowserProject(store,options,{download:offline}).load()).config,config);
});

test('ZIP rejects unsafe paths, symlinks, encryption, conflicts, CRC and size/member limits without publishing', async () => {
  const badArchives = [
    [{name:'../escape',bytes:bytes('x')}], [{name:'/absolute',bytes:bytes('x')}],
    [{name:'a\\b',bytes:bytes('x')}], [{name:'a:b',bytes:bytes('x')}],
    [{name:'a/./b',bytes:bytes('x')}], [{name:'NUL.txt',bytes:bytes('x')}],
    [{name:'.GAMS-RESOURCE.JSON',bytes:bytes('x')}],
    [{name:'link',bytes:bytes('x'),symlink:true}], [{name:'link',bytes:bytes('x'),mode:0o120777}],
    [{name:'pipe',bytes:bytes('x'),mode:0o010644}], [{name:'secret',bytes:bytes('x'),encrypted:true}],
    [{name:'a',bytes:bytes('x')},{name:'A',bytes:bytes('y')}],
    [{name:'a',bytes:bytes('x')},{name:'a/b',bytes:bytes('y')}],
    [{name:'A/x',bytes:bytes('x')},{name:'a/y',bytes:bytes('y')}],
    [{name:'bad-crc',bytes:bytes('x'),crc32:42}], [{name:'bad-size',bytes:bytes('x'),size:2}],
    [{name:'huge',size:64*1024*1024+1}],
    Array.from({length:5},(_,i)=>({name:`large${i}`,size:64*1024*1024})),
    Array.from({length:10001},(_,i)=>({name:`member${i}`,bytes:bytes('')})),
  ];
  for (const members of badArchives) {
    const store=new FakeStore(); const project=new BrowserProject(store,options,{download:async()=>bytes('archive'),unzip:async()=>members});
    await assert.rejects(project.resolveFile({url:'https://cdn.test/bad.zip',entry:'a'}),/ZIP|symlink|encrypted/);
    assert.ok(![...store.entries.keys()].some(path=>path.endsWith('/.gams-resource.json')));
    assert.ok(![...store.entries.keys()].some(path=>path.includes('/.install-')));
  }
});

test('local ZIP resources share full install and reject unsafe selectors/archive traversal', async () => {
  const store=await new FakeStore().seed({value:{$ref:{url:'units.zip',entry:'a.json'}}},{'units.zip':'archive'});
  const project=new BrowserProject(store,options,{unzip:async()=>[{name:'a.json',bytes:bytes({value:{$file:'../outside'}})}]});
  await assert.rejects(project.load(),/EPERM/);
  for (const entry of ['../a','/a','a\\b','a/../b']) await assert.rejects(project.resolveFile({url:'units.zip',entry}),/ZIP/);
  await assert.rejects(project.resolveFile({url:'https://cdn.test/file.js',entry:'x'}),/ZIP source/);
  await assert.rejects(project.resolveFile({url:'https://cdn.test/a.zip',entry:'x',unknown:true}),/source must/);
});

test('URL policy rejects malformed/unsafe sources before download, accepts empty bytes and loopback', async () => {
  let calls=0; const project=new BrowserProject(new FakeStore(),options,{download:async()=>{calls++;return new Uint8Array();}});
  for (const url of ['file:///etc/passwd','ftp://cdn.test/a','http://cdn.test/a','https://user:password@cdn.test/a','https://cdn.test/a#entry','https://','https:bad','https:/bad',' https://cdn.test/a','https://cdn.test/a\n']) {
    await assert.rejects(project.download(url),/HTTPS|credentials|fragments|URL/);
  }
  assert.equal(calls,0);
  assert.equal((await project.download('http://127.0.0.1:8123/a')).length,0);
  assert.equal((await project.download('https://cdn.test/empty')).length,0);
  const path=await project.resolveFile('https://cdn.test/empty'); assert.match(path,/gams_modules\/.*\/empty/);
  assert.equal(calls,3);
  await assert.rejects(project.resolveFile('../outside'),/outside Project/);
  await assert.rejects(project.resolveFile('https:/bad'),/URL/);
  await assert.rejects(project.resolveFile('//cdn.test/a'),/malformed/);
});

test('download response length bounds apply also to injected transport', async () => {
  const project=new BrowserProject(new FakeStore(),options,{download:async()=>new Uint8Array(64*1024*1024+1)});
  await assert.rejects(project.download('https://cdn.test/a'),/64 MiB/);
});

test('ordinary fetch loads a remote static Project with selected filename, empty assets and HTTP failures', async () => {
  const {createServer}=await import('node:http');
  const requests=[];
  const server=createServer((request,response)=>{
    requests.push(request.url);
    if(request.url==='/source/gams.dev.json') response.end(JSON.stringify({asset:{$file:'empty.bin'},ref:{$ref:'nested/data.json#/ok'}}));
    else if(request.url==='/source/empty.bin') response.end();
    else if(request.url==='/source/nested/data.json') response.end('{"ok":true}');
    else { response.statusCode=404; response.end('missing'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const store=new FakeStore(); const project=new BrowserProject(store,{...options,source:origin+'/source'});
    assert.deepEqual((await project.load()).config,{asset:'empty.bin',ref:true});
    assert.equal((await store.read('/project/empty.bin')).length,0);
    assert.deepEqual(requests,['/source/gams.dev.json','/source/empty.bin','/source/nested/data.json']);
    await assert.rejects(project.download(origin+'/missing'),/HTTP 404/);
    await assert.rejects(new BrowserProject(new FakeStore(),{...options,source:origin+'/missing'}).load(),/HTTP 404/);
    assert.ok(!requests.includes('/source/gams.json'));
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('remote $ref cycles and empty-key pointers are explicit; prototype keys cannot mutate loader objects', async () => {
  const store=await new FakeStore().seed({ref:{$ref:'https://cdn.test/a.json'}});
  const project=new BrowserProject(store,options,{download:downloader({
    'https://cdn.test/a.json':{$ref:'b.json'}, 'https://cdn.test/b.json':{$ref:'a.json'},
  })});
  await assert.rejects(project.load(),/circular/);
  const special=JSON.parse('{"__proto__":{"polluted":true},"value":{"$ref":"#/__proto__/polluted"}}');
  const clean=new BrowserProject(await new FakeStore().seed(special),options);
  const {config}=await clean.load(); assert.equal(config.value,true); assert.equal({}.polluted,undefined);
  assert.ok(Object.hasOwn(config,'__proto__'));
});

test('failed artifact/marker checkpoints never publish a completed cache', async () => {
  for (const failAt of [1,2]) {
    const store=new FakeStore(); let checkpoints=0;
    store.flush=async()=>{store.operations.push(['flush']); if(++checkpoints===failAt) throw new Error('checkpoint failed');};
    const project=new BrowserProject(store,options,{download:async()=>bytes('component')});
    await assert.rejects(project.resolveFile('https://cdn.test/a.wasm'),/checkpoint failed/);
    assert.ok(![...store.entries.keys()].some(path=>path.endsWith('/.gams-resource.json')));
    assert.ok(!store.operations.some(([op])=>op==='rename'));
    assert.ok(![...store.entries.keys()].some(path=>path.includes('/.install-')));
  }
});

test('flattened archive refs canonicalize file expressions rather than save virtual cache paths', async () => {
  const url='https://cdn.test/project.zip';
  const store=await new FakeStore().seed({data:{$ref:{url,entry:'config/main.json'}}});
  const project=new BrowserProject(store,options,{download:async()=>bytes('archive'),unzip:async()=>[
    {name:'config/main.json',bytes:bytes({title:'before',asset:{$file:'../assets/file.bin'}})},
    {name:'assets/file.bin',bytes:bytes('binary')},
  ]});
  const {config}=await project.load(); config.data.title='after';
  const saved=await project.prepareConfig(config);
  assert.deepEqual(saved,{data:{title:'after',asset:{$file:{url,entry:'assets/file.bin'}}}});
  assert.ok(!JSON.stringify(saved).includes('gams_modules/'));
  await store.write('/project/gams.dev.json',bytes(saved));
  assert.deepEqual((await new BrowserProject(store,options,{download:offline}).load()).config,config);
});

test('explicit resolution after startup has a fresh resolving/ready or failed operation', async () => {
  const store=await new FakeStore().seed({});
  const project=new BrowserProject(store,options,{download:downloader({'https://cdn.test/new.txt':'new'})});
  await project.load(); const initialId=project.progress.operationId;
  const snapshots=[]; project.onProgress=value=>snapshots.push(value);
  await project.resolveFile('https://cdn.test/new.txt');
  assert.notEqual(project.progress.operationId,initialId);
  assert.equal(snapshots[0].status,'resolving');
  assert.equal(snapshots.at(-1).status,'ready');
  assert.equal(snapshots.at(-1).completed,snapshots.at(-1).discovered);
  snapshots.length=0;
  await assert.rejects(project.resolveFile('file:///not-allowed'),/invalid resource URL/);
  assert.equal(snapshots[0].status,'resolving');
  assert.equal(snapshots.at(-1).status,'failed');
  assert.ok(snapshots.at(-1).error);
});

test('HTTP Project import prepares explicitly configured local Unit files without rewriting paths', async()=>{
  const config={plugins:['plugins/fs.wasm'],ui:{services:{ctx:{url:'services/context.js'}},views:{files:{url:'views/files.js'}},theme:{url:'themes/base.css'}}};
  const calls=[];
  const project=new BrowserProject(new FakeStore(),{...options,source:'https://project.test/'},{download:downloader({
    'https://project.test/gams.dev.json':config,
    'https://project.test/plugins/fs.wasm':'wasm',
    'https://project.test/services/context.js':'context',
    'https://project.test/views/files.js':'files',
    'https://project.test/themes/base.css':'css',
  },calls)});
  assert.deepEqual((await project.load()).config,config);
  assert.equal(text(await project.store.read('/project/plugins/fs.wasm')),'wasm');
  assert.equal(calls.length,5);
});

test('bare browser startup imports missing default config once and never overwrites an existing config',async()=>{
  const startup=parseBrowserOptions('http://127.0.0.1:8093/browser.html');
  const store=new FakeStore(),calls=[];
  const initial={plugins:[],name:'first-run'};
  const project=new BrowserProject(store,startup,{download:downloader({'http://127.0.0.1:8093/browser-default/gams.json':initial},calls)});
  assert.deepEqual((await project.load()).config,initial);
  assert.equal(calls.length,1);
  const edited={plugins:[],name:'user-edited'};
  await store.write('/projects/default/gams.json',bytes(edited));
  const reopened=new BrowserProject(store,startup,{download:offline});
  assert.deepEqual((await reopened.load()).config,edited);
  await store.write('/projects/default/gams.json',bytes('invalid JSON'));
  await assert.rejects(new BrowserProject(store,startup,{download:offline}).load(),SyntaxError);
  assert.equal(text(await store.read('/projects/default/gams.json')),'invalid JSON');
});

const corsProxy = 'http://127.0.0.1:8787/download';
function fakeBrowser(t, fetcher) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {configurable:true, value:{href:'https://host.test/browser.html', origin:'https://host.test'}});
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'location', previous); else delete globalThis.location; });
  return t.mock.method(globalThis, 'fetch', fetcher);
}
function fetchResponse(url, body = new Uint8Array([0,255,42]), init = {}) {
  const response = new Response(body, init); Object.defineProperty(response, 'url', {value:url}); return response;
}

test('fetch routes cross-origin with exactly one encoded URL parameter and bypasses same-origin', async t => {
  const calls = [];
  fakeBrowser(t, async (url, init) => {
    calls.push(url); assert.equal(init.mode, 'cors'); assert.equal(init.credentials, 'omit');
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.headers, undefined);
    return fetchResponse(url);
  });
  const project = new BrowserProject(new FakeStore(), {...options, corsProxy});
  const original = 'https://cdn.test/folder/%E2%9C%93.bin?a=1&url=https%3A%2F%2Fother.test%2Fx&value=a+b';
  assert.deepEqual(await project.download(original), new Uint8Array([0,255,42]));
  const relay = new URL(calls[0]); assert.equal(relay.origin+relay.pathname, corsProxy);
  assert.deepEqual([...relay.searchParams], [['url', original]]);
  assert.equal(calls[0], corsProxy+'?'+new URLSearchParams({url:original}));
  await project.download('https://host.test/browser-default/gams.json');
  await project.download('https://host.test/widgets/asset.bin?q=1');
  await new BrowserProject(new FakeStore(), options).download(original);
  assert.deepEqual(calls.slice(1), ['https://host.test/browser-default/gams.json','https://host.test/widgets/asset.bin?q=1',original]);
});

test('constructor and original URL validation precede routing; injected transport receives original URLs', async t => {
  const mock = fakeBrowser(t, () => assert.fail('custom download must not fetch'));
  for (const value of ['relative', 'http://remote.test/download', 'https://relay.test/?x=1', false, 12]) assert.throws(() => new BrowserProject(new FakeStore(), {...options, corsProxy:value}), /corsProxy/);
  const calls = [];
  const project = new BrowserProject(new FakeStore(), {...options, corsProxy}, {download:async url => {calls.push(url); return bytes('custom');}});
  for (const source of ['http://remote.test/a', 'file:///a', 'https://user:password@cdn.test/a', 'https://cdn.test/a#x']) await assert.rejects(project.download(source));
  assert.deepEqual(calls, []); assert.equal(text(await project.download('https://cdn.test/a')), 'custom');
  assert.deepEqual(calls, ['https://cdn.test/a']); assert.equal(mock.mock.callCount(), 0);
});

test('relay errors never retry directly and redirects retain endpoint; direct redirects retain URL policy', async t => {
  let handler; const mock = fakeBrowser(t, (url, init) => handler(url, init));
  const project = new BrowserProject(new FakeStore(), {...options, corsProxy}); const original = 'https://cdn.test/a';
  for (const [reply, expected] of [
    [() => {throw new TypeError('network CORS failure');}, /network CORS failure/],
    [url => fetchResponse(url, 'missing', {status:404}), /HTTP 404/],
    [url => fetchResponse(url, 'upstream error', {status:502}), /HTTP 502/],
    [() => fetchResponse('http://127.0.0.1:8788/download'), /changed endpoint/],
    [() => fetchResponse('http://127.0.0.1:8787/other'), /changed endpoint/],
    [() => fetchResponse(original), /changed endpoint/],
  ]) {
    handler = reply; const count = mock.mock.callCount(); await assert.rejects(project.download(original), expected);
    assert.equal(mock.mock.callCount(), count+1); assert.ok(mock.mock.calls.at(-1).arguments[0].startsWith(corsProxy+'?url='));
  }
  handler = url => fetchResponse(url); await project.download(original);
  const direct = new BrowserProject(new FakeStore(), options);
  handler = () => fetchResponse('http://127.0.0.1/final'); await assert.rejects(direct.download(original), /downgrade/);
  handler = () => fetchResponse('https://user:password@cdn.test/final'); await assert.rejects(direct.download(original), /credentials/);
  handler = () => fetchResponse('https://other.test/final'); assert.deepEqual(await direct.download(original), new Uint8Array([0,255,42]));
});

test('relay fetch preserves size bounds, body requirement, empty bytes and timeout', async t => {
  let handler; const mock = fakeBrowser(t, (url, init) => handler(url, init));
  const project = new BrowserProject(new FakeStore(), {...options, corsProxy});
  for (const length of ['67108865', '-1', 'not-a-number']) {
    handler = url => fetchResponse(url, 'x', {headers:{'content-length':length}});
    await assert.rejects(project.download('https://cdn.test/a'), /64 MiB/);
  }
  handler = url => fetchResponse(url, null); await assert.rejects(project.download('https://cdn.test/a'), /no body/);
  let cancelled = false;
  handler = url => fetchResponse(url, new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(33*1024*1024)); }, cancel() { cancelled = true; }}));
  await assert.rejects(project.download('https://cdn.test/a'), /64 MiB/); assert.equal(cancelled, true);
  handler = url => fetchResponse(url, new Uint8Array()); assert.deepEqual(await project.download('https://cdn.test/empty'), new Uint8Array());
  t.mock.timers.enable({apis:['setTimeout']}); handler = () => new Promise(() => {});
  const pending = project.download('https://cdn.test/slow'); t.mock.timers.tick(120_000);
  await assert.rejects(pending, /timeout/); assert.equal(mock.mock.calls.at(-1).arguments[1].signal.aborted, true);
});

test('relay JSON resolution, relative files, cache markers, progress and Save retain original URL identities', async t => {
  const root = 'https://cdn.test/folder/main.json?rev=1', nested = 'https://cdn.test/folder/nested/data.json', asset = 'https://cdn.test/folder/nested/asset.bin';
  const files = {[root]:bytes({nested:{$ref:'nested/data.json'}}), [nested]:bytes({name:'before',file:{$file:'asset.bin'}}), [asset]:new Uint8Array([0,255,42])};
  const calls = [];
  fakeBrowser(t, async relay => {
    const parsed = new URL(relay); assert.equal(parsed.origin+parsed.pathname, corsProxy);
    const original = parsed.searchParams.get('url'); calls.push(original); assert.ok(Object.hasOwn(files, original), original);
    return fetchResponse(relay, files[original]);
  });
  const original = {data:{$ref:root}}, store = await new FakeStore().seed(original);
  const project = new BrowserProject(store, {...options, corsProxy}); const {config} = await project.load();
  assert.deepEqual(calls, [root,nested,asset]);
  const hash = createHash('sha256').update(asset).digest('hex');
  assert.equal(config.data.nested.file, `gams_modules/${hash}/asset.bin`);
  assert.deepEqual(await store.read(`/shared/modules/${hash}/asset.bin`), files[asset]);
  assert.deepEqual(project.progress.resources.map(event => event.resource), calls);
  for (const url of calls) {
    const key = createHash('sha256').update(url).digest('hex');
    assert.equal(JSON.parse(text(await store.read(`/shared/modules/${key}/.gams-resource.json`))).url, url);
  }
  assert.deepEqual(await project.prepareConfig(config), original); config.data.nested.name = 'after';
  assert.deepEqual(await project.prepareConfig(config), {data:{nested:{name:'after',file:{$file:asset}}}});
  const reopened = new BrowserProject(store, {...options, corsProxy:'https://different-relay.test/download'}, {download:offline});
  assert.equal((await reopened.load()).config.data.nested.name, 'before');
  assert.ok(reopened.progress.resources.every(event => event.cached)); assert.equal(calls.length, 3);
});
