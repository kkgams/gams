import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes(await readFile(new URL('./browser-worker.ts',import.meta.url),'utf8')).replace(/^import .*?;\n/gm,'');
function worker({loadError=false,failShutdown=false,invoke=async()=>null}={}) {
  const messages=[],released=[];let storageCloses=0,closes=0;
  const store={async mkdir(){},async close(){if(++storageCloses===1&&failShutdown)throw Error('storage close failed');}};
  class Project {
    async load(){this.onProgress({status:'resolving'});if(loadError)throw Error('invalid config');return {config:{},configFile:'gams.json',modulesDir:'/modules'};}
    async prepareConfig(config){await Promise.resolve();return config;}
    async resolveFile(){this.onProgress({status:'ready'});return 'file';}
  }
  class Components {async close(){closes++;}async releaseResource(ref){released.push(ref);}async invoke(target,args){return invoke(this,target,args);}}
  const handle=runInNewContext(source+'\ndispatch',{
    DirectOpfsStore:{open:async()=>store},BrowserProject:Project,BrowserComponents:Components,
    self:{},postMessage:data=>messages.push(structuredClone(data)),performance,
  });
  let id=0;
  return {messages,released,storageCloses:()=>storageCloses,closes:()=>closes,
    async call(command,args={},callbackId){const request=++id;await handle({id:request,command,args,...(callbackId===undefined?{}:{callbackId})});return messages.find(x=>x.id===request&&!x.event);},
    async init(){return this.call('runtime_project',{options:{cwd:'/project',modulesDir:'/modules',pluginCacheDir:'/cache'}});}
  };
}
test('worker acknowledges shutdown retry after the original success and denies other work',async()=>{
  const w=worker();await w.init();
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.equal(w.closes(),1);assert.equal(w.storageCloses(),1);
  assert.match((await w.call('runtime_invoke')).error,/stopped/);
});
test('worker permits checkpointed shutdown after startup failed before components existed',async()=>{
  const w=worker({loadError:true});assert.match((await w.init()).error,/invalid config/);
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.equal(w.closes(),0);assert.equal(w.storageCloses(),1);
});
test('failed storage close does not mark worker stopped and can be retried',async()=>{
  const w=worker({failShutdown:true});await w.init();
  assert.match((await w.call('runtime_shutdown')).error,/storage close failed/);
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.equal(w.storageCloses(),2);
});
test('worker awaits async Save preparation and labels progress with the active request',async()=>{
  const w=worker();await w.init();
  assert.deepEqual((await w.call('runtime_prepare_config',{config:{name:'saved'}})).result,{name:'saved'});
  await w.call('runtime_resolve_file',{source:'file'});
  assert.deepEqual(w.messages.filter(x=>x.event).map(x=>x.id),[1,3]);
});
test('worker routes resource release without closing storage',async()=>{
  const w=worker();await w.init();const ref={$resource:'gams:image/image',id:'opaque'};
  assert.equal((await w.call('runtime_release_resource',{resource:ref})).result,null);
  assert.deepEqual(w.released,[ref]);assert.equal(w.storageCloses(),0);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('View reply and ordered nested invocations bypass the suspended parent queue',async()=>{
  const order=[];
  const w=worker({invoke:async(c,target)=>{
    if(target==='outer')return c.callView('view.read','[]');
    order.push(target);await tick();return target;
  }});await w.init();
  const outer=w.call('runtime_invoke',{target:'outer',args:[]});await tick();
  const event=w.messages.find(x=>x.event==='call-view');assert.equal(event.payload.target,'view.read');
  const a=w.call('runtime_invoke',{target:'first',args:[]},event.payload.id);
  const b=w.call('runtime_invoke',{target:'second',args:[]},event.payload.id);
  const ordinary=w.call('runtime_invoke',{target:'queued',args:[]});
  await Promise.all([a,b]);assert.deepEqual(order,['first','second']);
  assert.equal((await w.call('runtime_call_view_response',{id:event.payload.id,ok:'[42]',err:null})).result,null);
  assert.equal((await outer).result,'[42]');await ordinary;assert.deepEqual(order,['first','second','queued']);
  assert.match((await w.call('runtime_call_view_response',{id:event.payload.id,ok:'[]',err:null})).error,/unknown.*callback/i);
});
test('callback restrictions and invalid replies do not consume a pending request',async()=>{
  const w=worker({invoke:(c)=>c.callView('view.read','[]')});await w.init();
  const outer=w.call('runtime_invoke',{target:'outer',args:[]});await tick();
  const {id}=w.messages.find(x=>x.event==='call-view').payload;
  assert.match((await w.call('runtime_add_plugins',{paths:[]},id)).error,/denied.*callback/i);
  assert.match((await w.call('runtime_invoke',{target:'x',args:[]},'stale')).error,/unknown.*callback/i);
  assert.match((await w.call('runtime_call_view_response',{id,ok:'x',err:'y'})).error,/exactly one|both/);
  assert.match((await w.call('runtime_call_view_response',{id,ok:4,err:null})).error,/string/);
  await w.call('runtime_call_view_response',{id,ok:null,err:'removed View'});
  assert.match((await outer).error,/removed View/);
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
});
test('nested View callbacks use separate lanes and resource releases',async()=>{
  const w=worker({invoke:(c,target)=>c.callView(target,'[]')});await w.init();
  const outer=w.call('runtime_invoke',{target:'view.outer',args:[]});await tick();
  const first=w.messages.find(x=>x.event==='call-view').payload.id;
  const nested=w.call('runtime_invoke',{target:'view.inner',args:[]},first);await tick();
  const second=w.messages.filter(x=>x.event==='call-view').at(-1).payload.id;
  const ref={$resource:'a',id:'b'};
  await w.call('runtime_release_resource',{resource:ref},second);assert.deepEqual(w.released,[ref]);
  await w.call('runtime_call_view_response',{id:second,ok:'42',err:null});assert.equal((await nested).result,'42');
  await w.call('runtime_call_view_response',{id:first,ok:'"done"',err:null});assert.equal((await outer).result,'"done"');
});

test('registered UI callbacks can resolve/download/prepare data; lifecycle mutations fail rather than deadlock',async()=>{
  const w=worker({invoke:c=>c.callView('project.save','[]')});await w.init();
  const outer=w.call('runtime_invoke',{target:'outer',args:[]});await tick();const {id}=w.messages.find(x=>x.event==='call-view').payload;
  assert.equal((await w.call('runtime_resolve_file',{source:'file'},id)).result,'file');
  assert.deepEqual((await w.call('runtime_prepare_config',{config:{saved:true}},id)).result,{saved:true});
  for(const command of ['runtime_add_plugins','runtime_load_from_bytes','runtime_clear_compiled_component_cache'])
    assert.match((await w.call(command,{},id)).error,/Denied command/);
  await w.call('runtime_call_view_response',{id,ok:'true',err:null});assert.equal((await outer).result,'true');
});
