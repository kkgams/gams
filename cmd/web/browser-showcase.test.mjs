import test from 'node:test';
import assert from 'node:assert/strict';
import {openShowcase} from './browser-showcase.ts';
import {TestMemoryStore} from './test-memory-store.mjs';

const zip = 'https://github.com/kkgams/showcases/releases/download/v0.1.0/tilemap.zip';
const fresh = {id:'tilemap',zip}, saved = {id:'tilemap'};
const root = '/.gams-showcases/tilemap';
const text = value => new TextDecoder().decode(value);
const bytes = value => new TextEncoder().encode(value);
const member = (name, value) => ({name,bytes:bytes(value)});
const config = member('gams.json','{"example":{"$ref":"maps/meta.json#/title"}}');
const files = [config, member('maps/meta.json','{"title":"Courtyard"}'), member('maps/sample.bin','original')];
const deps = (members = files) => ({download:async url=>{assert.equal(url,zip);return bytes('ZIP');},unzip:async()=>members});
const offline = {download:async()=>{throw Error('offline');}};
const open = (store, settings, dependencies=deps(), notify=()=>{}) => openShowcase(store,settings,undefined,notify,dependencies);

test('commit switches saved demo only after a fresh Project is ready; reopen is offline', async () => {
  const store = new TestMemoryStore({dir:{}});
  const progress=[];
  await store.write('/projects/default/gams.json',bytes('{"work":"untouched"}'));
  await assert.rejects(open(store,saved), /No saved tilemap demo/);
  const first=await open(store,fresh,deps(),snapshot=>progress.push(snapshot));
  assert.equal(first.result.config.example,'Courtyard');
  assert.ok(progress.some(snapshot=>snapshot.resources[0]?.phase==='extracting'));
  assert.equal(text(await store.read(`${first.project.options.cwd}/maps/sample.bin`)),'original');
  await assert.rejects(open(store,saved), /No saved tilemap demo/);
  await first.pending.commit();
  await store.write(`${first.project.options.cwd}/maps/sample.bin`,bytes('edited'));
  const second=await open(store,fresh);
  assert.notEqual(second.project.options.cwd, first.project.options.cwd);
  const savedBefore=await open(store,saved,offline);
  assert.equal(text(await store.read(`${savedBefore.project.options.cwd}/maps/sample.bin`)),'edited');
  await second.pending.commit();
  const savedAfter=await open(store,saved,offline);
  assert.equal(savedAfter.project.options.cwd,second.project.options.cwd);
  assert.equal(text(await store.read(`${savedAfter.project.options.cwd}/maps/sample.bin`)),'original');
  await assert.rejects(store.stat(first.project.options.cwd),{code:'ENOENT'});
  assert.equal(text(await store.read('/projects/default/gams.json')),'{"work":"untouched"}');
});

test('invalid downloads/configs and discarded startups preserve the saved demo', async () => {
  const store = new TestMemoryStore({dir:{}});
  const first=await open(store,fresh); await first.pending.commit();
  const active=text(await store.read(`${root}/current`));
  for (const [dependencies,reason] of [
    [offline,/offline/], [deps([]),/gams.json at its root/], [deps([member('gams.json','{')]),/JSON/],
    [deps([config,member('../escape','bad')]),/unsafe ZIP/], [deps([config,member('gams_modules/bad','bad')]),/Unit cache/],
  ]) await assert.rejects(open(store,fresh,dependencies),reason);
  const second=await open(store,fresh); await second.pending.discard();
  assert.deepEqual(await store.list(root),[active,'current'].sort());
  assert.equal((await open(store,saved,offline)).project.options.cwd,first.project.options.cwd);
  await store.write(`${root}/current`,bytes('../default'));
  await assert.rejects(open(store,saved,offline), /Invalid saved showcase location/);
});
