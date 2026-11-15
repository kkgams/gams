import { closeBrowserSession, forceStopBrowserSession, hasBrowserSession, getStartupOptions } from '/browser-transport.js';

const app = document.getElementById('app');
if (!app) throw new Error('Browser Host requires #app.');
const controls = document.createElement('details');
controls.id = 'browser-host-controls';controls.open = true;
// Host shell controls, independent of Project Views/theme/bootstrap.
Object.assign(controls.style,{position:'fixed',bottom:'8px',left:'8px',zIndex:'2147483646',maxWidth:'min(700px,95vw)',maxHeight:'80vh',overflow:'auto',background:'var(--bg,white)',border:'1px solid',padding:'8px'});
controls.innerHTML = `<summary>Browser Host</summary><fieldset><legend>Session</legend>
<button id="browser-open" type="button">Open Project — grant browser filesystem</button>
<button id="browser-close" type="button" disabled>Checkpoint and close</button>
<button id="browser-force" type="button" disabled>Force stop (may lose changes)</button>
<button id="browser-reload" type="button">Reload</button>
<output id="browser-state">Closed.</output></fieldset>`;
document.body.appendChild(controls);
app.innerHTML = `<article><h1>GAMS browser Host</h1><p>The canonical GAMS frontend runs against a browser Host worker, Jco and OPFS. No native backend is required.</p>
<p>With no Project parameters, Open initializes the default Files workspace if its config is missing. Its pinned released Units download directly into gams_modules. First startup requires GitHub download access through the configured relay; installed Units are cached for reopening. Existing configs are not overwritten.</p>
<p>For another Project, use URL parameters: <code>?source=/project/&amp;cwd=/projects/example&amp;config=gams.json</code>. Explicit Project/config selections never fall back to the default. Remote downloads need CORS permission or the configured download relay.</p>
<p>One instance only. Concurrent instances are unsupported; there are no Host writer locks.</p><pre id="browser-options"></pre></article>`;
const open = document.getElementById('browser-open') as HTMLButtonElement;
const close = document.getElementById('browser-close') as HTMLButtonElement;
const force = document.getElementById('browser-force') as HTMLButtonElement;
const state = document.getElementById('browser-state')!;
let options;
try {options=getStartupOptions();document.getElementById('browser-options')!.textContent=JSON.stringify(options,null,2);}
catch(error){open.disabled=true;state.textContent=String(error);}
open.addEventListener('click',async()=>{
  open.disabled=true;close.disabled=false;force.disabled=false;
  state.textContent='Opening Project…';
  try {
    await import('/app.js');
    state.textContent=globalThis.runtime ? 'Project ready. Single-instance OPFS session.' : 'Project startup failed; see the startup screen.';
    if (globalThis.runtime) controls.open=false;
  } catch(error){state.textContent=String(error);}
});
function disableProject() {
  const save = document.getElementById('browser-project-save') as HTMLButtonElement | null;
  if (save) save.disabled=true;
  document.querySelectorAll<HTMLElement>('ui-layout,popup-manager,tooltip-manager,toast-manager').forEach(element=>{element.inert=true;});
}
close.addEventListener('click',async()=>{
  disableProject();
  close.disabled=true;state.textContent='Waiting for guest shutdown and storage checkpoint…';
  try {
    if (!hasBrowserSession()) throw new Error('No browser Host session was started.');
    await closeBrowserSession();
    document.querySelectorAll('ui-layout,popup-manager,tooltip-manager,toast-manager').forEach(element=>element.remove());
    state.textContent='Closed after checkpoint. Reload to reopen.';force.disabled=true;
  } catch(error){state.textContent=String(error);close.disabled=false;}
});
force.addEventListener('click',()=>{
  disableProject();
  forceStopBrowserSession();close.disabled=true;force.disabled=true;
  document.querySelectorAll('ui-layout,popup-manager,tooltip-manager,toast-manager').forEach(element=>element.remove());
  state.textContent='Force-stopped. In-flight changes may be lost or partially persisted. Reload to reopen.';
});
document.getElementById('browser-reload')!.addEventListener('click',()=>location.reload());
