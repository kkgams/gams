import { createStartupProgress } from '/core/startup-progress.js';

const app = document.getElementById('app');
if (!app) throw new Error('Browser Host requires #app.');
const controls = document.createElement('details');
controls.id = 'browser-host-controls';
// Collapsed session controls, not a second application startup screen.
Object.assign(controls.style,{position:'fixed',bottom:'8px',left:'8px',zIndex:'2147483646',maxWidth:'min(700px,95vw)',maxHeight:'80vh',overflow:'auto',background:'var(--bg,white)',border:'1px solid',padding:'8px'});
controls.innerHTML = `<summary>Browser Host</summary><fieldset><legend>Session</legend>
<button id="browser-close" type="button" disabled>Checkpoint and close</button>
<button id="browser-force" type="button" disabled>Force stop (may lose changes)</button>
<button id="browser-reload" type="button">Reload</button>
<output id="browser-state">Opening Project…</output></fieldset>`;
document.body.appendChild(controls);
const close = document.getElementById('browser-close') as HTMLButtonElement;
const force = document.getElementById('browser-force') as HTMLButtonElement;
const state = document.getElementById('browser-state')!;
let platform: typeof import('/browser-transport.js') | undefined;

function disableProject() {
  const save = document.getElementById('browser-project-save') as HTMLButtonElement | null;
  if (save) save.disabled=true;
  document.querySelectorAll<HTMLElement>('ui-layout,popup-manager,tooltip-manager,toast-manager').forEach(element=>{element.inert=true;});
}
close.addEventListener('click',async()=>{
  disableProject();
  close.disabled=true;state.textContent='Waiting for guest shutdown and storage checkpoint…';
  try {
    if (!platform.hasBrowserSession()) throw new Error('No browser Host session was started.');
    await platform.closeBrowserSession();
    document.querySelectorAll('ui-layout,popup-manager,tooltip-manager,toast-manager').forEach(element=>element.remove());
    state.textContent='Closed after checkpoint. Reload to reopen.';force.disabled=true;
  } catch(error){state.textContent=String(error);close.disabled=false;}
});
force.addEventListener('click',()=>{
  disableProject();
  platform.forceStopBrowserSession();close.disabled=true;force.disabled=true;
  document.querySelectorAll('ui-layout,popup-manager,tooltip-manager,toast-manager').forEach(element=>element.remove());
  state.textContent='Force-stopped. In-flight changes may be lost or partially persisted. Reload to reopen.';
});
document.getElementById('browser-reload')!.addEventListener('click',()=>location.reload());

try {
  platform = await import('/browser-transport.js');
  close.disabled=false;force.disabled=false;
  await import('/app.js');
  if (globalThis.runtime) await platform.finishShowcaseLaunch();
  state.textContent=globalThis.runtime ? 'Project ready. Single-instance OPFS session.' : 'Project startup failed; see the startup screen.';
  if (!globalThis.runtime) controls.open=true;
} catch(error) {
  controls.open=true;state.textContent=String(error);
  const loading=createStartupProgress(document,()=>location.reload());
  loading.fail(error);
  console.error('[project.open] Startup failed',error);
} finally {
  const active=platform !== undefined && platform.hasBrowserSession();
  close.disabled=!active;force.disabled=!active;
}
