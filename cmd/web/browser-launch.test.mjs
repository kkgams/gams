import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source=stripTypeScriptTypes(await readFile(new URL('./browser-launch.ts',import.meta.url),'utf8'))
  .replace(/^import .* from '\/core\/startup-progress.js';\n/,'')
  .replaceAll("import('/browser-transport.js')","loadModule('/browser-transport.js')")
  .replaceAll("import('/app.js')","loadModule('/app.js')");
const run=new (Object.getPrototypeOf(async function(){}).constructor)(
  'document','loadModule','createStartupProgress','globalThis','location','console',source);

async function launch({backendError,appError,ready=true,closeError,session=true}={}) {
  const elements=new Map();const imported=[];const errors=[];const screens=[];let active=session;let reloaded=0;let closed=0;let forced=0;
  function element() {
    return {style:{},open:false,disabled:false,textContent:'',listeners:{},
      addEventListener(name,listener){this.listeners[name]=listener;},
      remove(){this.removed=true;},
      set innerHTML(markup){
        this.markup=markup;
        for(const match of markup.matchAll(/<(button|output)[^>]*id="([^"]+)"[^>]*>/g)) {
          const child=element();child.disabled=match[0].includes(' disabled');elements.set(match[2],child);
        }
      },
    };
  }
  elements.set('app',element());
  const widgets=[element(),element()];
  const document={createElement:element,getElementById:id=>elements.get(id)??null,querySelectorAll:()=>widgets,
    body:{appendChild(child){elements.set(child.id,child);}}};
  const platform={hasBrowserSession:()=>active,async closeBrowserSession(){closed++;if(closeError)throw closeError;active=false;},forceStopBrowserSession(){forced++;active=false;}};
  const loadModule=async name=>{imported.push(name);if(name==='/browser-transport.js'){if(backendError)throw backendError;return platform;}if(appError)throw appError;return {};};
  const createStartupProgress=(_document,reload)=>{const screen={reload,fail(error){this.error=error;}};screens.push(screen);return screen;};
  await run(document,loadModule,createStartupProgress,ready?{runtime:{}}:{},{reload(){reloaded++;}},{error(...args){errors.push(args);}});
  return {elements,imported,errors,screens,widgets,closed:()=>closed,forced:()=>forced,reloaded:()=>reloaded};
}

test('starts the shared app once without an Open button or welcome page',async()=>{
  const h=await launch();
  assert.deepEqual(h.imported,['/browser-transport.js','/app.js']);
  assert.equal(h.elements.has('browser-open'),false);
  assert.equal(h.elements.has('browser-options'),false);
  assert.equal(h.elements.get('app').markup,undefined);
  assert.equal(h.elements.get('browser-host-controls').open,false);
  assert.equal(h.elements.get('browser-state').textContent,'Project ready. Single-instance OPFS session.');
  assert.equal(h.screens.length,0);
});

test('transport and module import failures use the shared startup error/reload screen',async()=>{
  for(const failure of ['backendError','appError']) {
    const error=new Error('startup failed');const h=await launch({[failure]:error});
    assert.equal(h.screens.length,1);assert.equal(h.screens[0].error,error);
    assert.equal(h.elements.get('browser-host-controls').open,true);
    assert.match(h.elements.get('browser-state').textContent,/startup failed/);
    h.screens[0].reload();assert.equal(h.reloaded(),1);
    assert.equal(h.errors.length,1);
    if(failure==='backendError') {
      assert.deepEqual(h.imported,['/browser-transport.js']);
      assert.equal(h.elements.get('browser-force').disabled,true);
      assert.equal(h.elements.get('browser-close').disabled,true);
    }
  }
});

test('a failure already rendered by the shared app is not replaced by a second error screen',async()=>{
  const h=await launch({ready:false});
  assert.equal(h.screens.length,0);
  assert.equal(h.elements.get('browser-host-controls').open,true);
  assert.match(h.elements.get('browser-state').textContent,/startup failed/);
});

test('a startup rejected before worker creation disables unavailable session actions',async()=>{
  const h=await launch({ready:false,session:false});
  assert.equal(h.elements.get('browser-close').disabled,true);
  assert.equal(h.elements.get('browser-force').disabled,true);
});

test('automatic startup retains checkpointed close, failure retry, force stop and reload controls',async()=>{
  const h=await launch();await h.elements.get('browser-close').listeners.click();
  assert.equal(h.closed(),1);assert.ok(h.widgets.every(widget=>widget.inert&&widget.removed));
  assert.equal(h.elements.get('browser-force').disabled,true);
  assert.match(h.elements.get('browser-state').textContent,/Closed after checkpoint/);
  h.elements.get('browser-reload').listeners.click();assert.equal(h.reloaded(),1);
  const failed=await launch({closeError:new Error('checkpoint failed')});
  await failed.elements.get('browser-close').listeners.click();
  assert.equal(failed.elements.get('browser-close').disabled,false);
  assert.equal(failed.elements.get('browser-force').disabled,false);
  failed.elements.get('browser-force').listeners.click();assert.equal(failed.forced(),1);
  assert.match(failed.elements.get('browser-state').textContent,/Force-stopped/);
});
