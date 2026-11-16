import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserComponents} from './browser-components.ts';
import {BrowserStore} from './browser-storage.ts';
const name='gams:image/image@1.0.0';
const component=Uint8Array.from([0,97,115,109,13,0,1,0]);
const dispose=Symbol.dispose||Symbol.for('dispose');
async function fixture({failDrop=false,failReload=false,failStopGeneration=0}={}){
  const store=new BrowserStore({dir:{}});await store.mkdir('/work');await store.mkdir('/modules');await store.write('/work/image.wasm',component);
  const events=[];let generation=0;
  const manager=new BrowserComponents(store,{cwd:'/work',modulesDir:'/modules',pluginCacheDir:'/cache'},{
    transpile:()=>({files:[['component.js',new TextEncoder().encode('image')]],imports:[],exports:[[name,'instance']]}),
    instantiate:()=>{const owner=++generation;if(failReload&&owner===2)throw Error('new component failed');class Image{constructor(w,h){this.w=w;this.h=h;}[dispose](){events.push(`drop:${owner}`);if(failDrop)throw Error('destructor trap');}}
      return {[name]:{create:(w,h)=>{if(w===0)throw{declared:true,payload:'invalid dimensions'};if(w===99)throw Error('image trap');return new Image(w,h);},crop:(image,rect)=>{assert.ok(image instanceof Image);return new Image(rect.x1-rect.x0,rect.y1-rect.y0);},info:image=>({width:image.w,height:image.h,pixelFormat:'rgba8'}),export:()=>new Uint8Array([0,127,255])},_util:{whenIdle:async()=>{events.push(`idle:${owner}`);},stop:()=>{events.push(`stop:${owner}`);if(owner===failStopGeneration)throw Error('stop failed');},isComponentError:e=>e.declared===true}};},
  });await manager.add(['image.wasm']);return{manager,events,store};
}
test('image owned returns, borrowed calls, unchanged original and explicit release',async()=>{
  const {manager}=await fixture();const {ok:source}=await manager.invoke('image/image::create',[4,3,null]);
  assert.equal(source.$resource,'gams:image/image');assert.equal(typeof source.id,'string');assert.deepEqual(Object.keys(source).sort(),['$resource','id']);
  const {ok:crop}=await manager.invoke('image/image::crop',[source,{x0:1,y0:0,x1:3,y1:2}]);assert.notEqual(source.id,crop.id);
  assert.deepEqual(await manager.invoke('image/image::info',[source]),{ok:{width:4,height:3,'pixel-format':'rgba8'}});
  assert.deepEqual(await manager.invoke('image/image::info',[crop]),{ok:{width:2,height:2,'pixel-format':'rgba8'}});
  assert.deepEqual(await manager.invoke('image/image::export',[crop,'qoi']),{ok:[0,127,255]});
  assert.equal((await manager.diagnostics()).jsonResourceRefs,2);
  await manager.releaseResource(crop);await assert.rejects(manager.invoke('image/image::info',[crop]),/unknown resource/i);await assert.rejects(manager.releaseResource(crop),/unknown resource/i);
  await manager.releaseResource(source);assert.equal((await manager.diagnostics()).jsonResourceRefs,0);await manager.close();
});
test('image refs reject forgery and foreign sessions; reload/close drop before stop',async()=>{
  const a=await fixture(),b=await fixture();const {ok:ref}=await a.manager.invoke('image/image::create',[2,2,null]);
  await assert.rejects(b.manager.invoke('image/image::info',[ref]),/unknown resource/i);
  await assert.rejects(a.manager.invoke('image/image::info',[{...ref,$resource:'wasi:sql/types'}]),/origin/i);
  await a.manager.add(['image.wasm'],true);assert.deepEqual(a.events,['idle:1','drop:1','stop:1']);
  await assert.rejects(a.manager.invoke('image/image::info',[ref]),/unknown resource/i);
  const {ok:newRef}=await a.manager.invoke('image/image::create',[1,1,null]);assert.notEqual(ref.id,newRef.id);
  await a.manager.close();await a.manager.close();assert.deepEqual(a.events,['idle:1','drop:1','stop:1','idle:2','drop:2','stop:2']);
  await assert.rejects(a.manager.releaseResource(newRef),/closed/);await b.manager.close();
});
test('failed new instantiation preserves old handles and the callable old instance',async()=>{
  const {manager,events}=await fixture({failReload:true});const {ok:ref}=await manager.invoke('image/image::create',[2,2,null]);
  await assert.rejects(manager.add(['image.wasm'],true),/new component failed/);
  assert.deepEqual(events,[]);assert.equal((await manager.invoke('image/image::info',[ref])).ok.width,2);
  await manager.close();assert.deepEqual(events,['idle:1','drop:1','stop:1']);
});
test('failed old destruction evicts the old instance and cleans the uninstalled replacement',async()=>{
  const {manager,events}=await fixture({failDrop:true,failStopGeneration:2});await manager.invoke('image/image::create',[1,1,null]);
  await assert.rejects(manager.add(['image.wasm'],true),error=>error.message.includes('destructor trap')&&error.message.includes('stop failed'));
  assert.deepEqual(events,['idle:1','drop:1','stop:1','idle:2','stop:2']);
  const diagnostics=await manager.diagnostics();assert.equal(diagnostics.jsonResourceRefs,0);assert.equal(diagnostics.instances.length,0);
  await assert.rejects(manager.invoke('image/image::create',[1,1,null]),/Missing exported interface/);await manager.close();
});
test('close attempts every instance after destructor/stop failures and invalidates all handles',async()=>{
  const {manager,events}=await fixture({failDrop:true,failStopGeneration:1});await manager.invoke('image/image::create',[1,1,null]);
  await manager.loadFromBytes(component,'second.wasm');
  await assert.rejects(manager.close(),error=>error.message.includes('destructor trap')&&error.message.includes('stop failed'));
  assert.deepEqual(events,['idle:1','drop:1','stop:1','idle:2','stop:2']);
  const diagnostics=await manager.diagnostics();assert.equal(diagnostics.jsonResourceRefs,0);assert.equal(diagnostics.instances.length,0);assert.equal(diagnostics.closed,true);
  await assert.rejects(manager.invoke('image/image::create',[1,1,null]),/closed/);await manager.close();assert.equal(events.length,5);
});
test('image declared errors stay results, traps reject, and failures allocate no public refs',async()=>{
  const {manager}=await fixture();assert.deepEqual(await manager.invoke('image/image::create',[0,1,null]),{err:'invalid dimensions'});
  await assert.rejects(manager.invoke('image/image::create',[99,1,null]),/image trap/);assert.equal((await manager.diagnostics()).jsonResourceRefs,0);
  const {ok:ref}=await manager.invoke('image/image::create',[1,1,null]);await manager.releaseResource(ref);await manager.close();
});
