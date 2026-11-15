import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes(await readFile(new URL('./browser-worker.ts',import.meta.url),'utf8')).replace(/^import .*?;\n/gm,'');
function worker({loadError=false,failShutdown=false}={}) {
  const messages=[];let checkpoints=0,closes=0;
  const store={async mkdir(){},async flush(){if(++checkpoints===2&&failShutdown)throw Error('checkpoint failed');}};
  class Project {
    async load(){this.onProgress({status:'resolving'});if(loadError)throw Error('invalid config');return {config:{},configFile:'gams.json',modulesDir:'/modules'};}
    async prepareConfig(config){await Promise.resolve();return config;}
    async resolveFile(){this.onProgress({status:'ready'});return 'file';}
  }
  class Components {async close(){closes++;}}
  const handle=runInNewContext(source+'\nhandle',{
    BrowserStore:{open:async()=>store},BrowserProject:Project,BrowserComponents:Components,
    self:{},postMessage:data=>messages.push(structuredClone(data)),performance,
  });
  let id=0;
  return {messages,checkpoints:()=>checkpoints,closes:()=>closes,
    async call(command,args={}){const request=++id;await handle({id:request,command,args});return messages.find(x=>x.id===request&&!x.event);},
    async init(){return this.call('runtime_project',{options:{cwd:'/project',modulesDir:'/modules',pluginCacheDir:'/cache'}});}
  };
}
test('worker acknowledges shutdown retry after the original success and denies other work',async()=>{
  const w=worker();await w.init();
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.equal(w.closes(),1);assert.equal(w.checkpoints(),2);
  assert.match((await w.call('runtime_invoke')).error,/stopped/);
});
test('worker permits checkpointed shutdown after startup failed before components existed',async()=>{
  const w=worker({loadError:true});assert.match((await w.init()).error,/invalid config/);
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.equal(w.closes(),0);assert.equal(w.checkpoints(),1);
});
test('failed shutdown checkpoint does not mark worker stopped and can be retried',async()=>{
  const w=worker({failShutdown:true});await w.init();
  assert.match((await w.call('runtime_shutdown')).error,/checkpoint failed/);
  assert.deepEqual((await w.call('runtime_shutdown')).result,{closed:true});
  assert.equal(w.checkpoints(),3);
});
test('worker awaits async Save preparation and labels progress with the active request',async()=>{
  const w=worker();await w.init();
  assert.deepEqual((await w.call('runtime_prepare_config',{config:{name:'saved'}})).result,{name:'saved'});
  await w.call('runtime_resolve_file',{source:'file'});
  assert.deepEqual(w.messages.filter(x=>x.event).map(x=>x.id),[1,3]);
});
