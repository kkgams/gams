import { openSession, closeSession, forceStopSession, hasSession } from '/core/runtime/native.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing Files shell element: ${id}`);
  return value as T;
}
const status = element('files-status');
const diagnostics = element('files-errors');
const log = element('files-log');
const surface = element('files-surface');
const openButton = element<HTMLButtonElement>('files-open');
const closeButton = element<HTMLButtonElement>('files-close');
const forceButton = element<HTMLButtonElement>('files-force');
let busy = false;
let forceStopped = false;
let runtime: any;
let mounted: { area: HTMLElement; popup: any; toast: HTMLElement; context: { dispose(): void }; observer: ResizeObserver } | null = null;
const messages: string[] = [];
function report(message: string) {
  messages.push(message);
  if (messages.length > 60) messages.shift();
  log.textContent = messages.join('\n');
}
function update() {
  openButton.disabled = busy || hasSession() || forceStopped;
  closeButton.disabled = busy || !hasSession() || forceStopped;
  forceButton.disabled = !hasSession();
}
function fail(error: unknown) {
  const message = String(error);
  diagnostics.textContent = message;
  status.textContent = 'Operation failed; inspect diagnostics. Failed close does not discard the worker.';
  report(message);
  console.error(error);
}
async function action(run: () => Promise<void>) {
  busy = true; diagnostics.textContent = ''; update();
  try { await run(); }
  catch (error) { fail(error); }
  finally { busy = false; update(); }
}

async function mountFiles() {
  const host = await import('/core/runtime.js');
  runtime = host.runtime;
  await runtime.ready;
  const [{ createUiContext }] = await Promise.all([
    import('/units/ui-service.context/ui-plugins/context.js'),
    import('/units/ui-service.popup/ui-plugins/popup.js'),
    import('/units/ui-service.toast/ui-plugins/toast.js'),
    import('/units/ui-service.layout/ui-plugins/layout.js'),
  ]);
  if (!hasSession()) throw new Error('Filesystem session was cancelled before mounting the View.');
  const registry = new Map();
  for (const [tag, config] of Object.entries(runtime.config.ui.views) as [string, any][]) {
    registry.set(tag, {
      label: config.label, internal: config.internal,
      async create(options: { attrs?: Record<string, string> } = {}) {
        await import(config.url);
        if (!customElements.get(tag)) throw new Error(`Released View did not register ${tag}`);
        const view = document.createElement(tag) as any;
        view.viewConfig = config;
        if (config.config !== undefined) view.config = config.config;
        if (options.attrs) for (const [name, value] of Object.entries(options.attrs)) view.setAttribute(name, value);
        return view;
      },
    });
  }
  // Resolve the released View before installing listeners/managers. A failed
  // module import must leave no partially mounted UI to leak across reopen.
  const view = await registry.get('view-files').create({ attrs: { 'data-root': '.' } });
  if (!hasSession()) throw new Error('Filesystem session was cancelled before mounting the View.');
  const context = createUiContext();
  runtime.register(context);
  const popup = document.createElement('popup-manager') as any;
  popup.setViewRegistry(registry);
  const toast = document.createElement('toast-manager') as any;
  document.body.append(popup, toast);
  runtime.register({ id: 'ui.popup', methods: popup.api });
  runtime.register({ id: 'ui.toast', methods: toast.api });

  // Use the real layout Unit's Area, without starting its unrelated BSP engine.
  const area = document.createElement('view-area') as any;
  area.owner = {
    viewRegistry: registry,
    async createView(tag: string) {
      const entry = registry.get(tag);
      if (!entry) throw new Error(`Unknown shell View: ${tag}`);
      return await entry.create({ attrs: { 'data-root': '.' } });
    },
  };
  area.appendChild(view);
  const resize = () => {
    area.x = 0; area.y = 0;
    area.w = surface.clientWidth; area.h = surface.clientHeight;
  };
  resize();
  surface.appendChild(area);
  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  mounted = { area, popup, toast, context, observer };
  status.textContent = 'Real view-files → Host Runtime → browser worker → real plugin.fs → WASI → OPFS';
}

openButton.onclick = () => action(async () => {
  status.textContent = 'Initializing Jco and opening the explicitly granted OPFS Project root…';
  const opening = openSession(report);
  update(); // Session exists synchronously: force-stop remains available during setup.
  await opening;
  await mountFiles();
});
closeButton.onclick = () => action(async () => {
  if (mounted) {
    mounted.area.inert = true;
    await mounted.popup.api.closeAll();
  }
  await closeSession();
  if (mounted) {
    mounted.observer.disconnect();
    mounted.area.remove(); mounted.popup.remove(); mounted.toast.remove();
    mounted.context.dispose();
    for (const id of ['ui.popup', 'ui.toast', 'ui.context']) await runtime.unregister(id);
    mounted = null;
  }
  status.textContent = 'Closed after checkpoint. OPFS data remains stored; reopening requires an explicit grant.';
});
forceButton.onclick = () => {
  forceStopped = true;
  if (mounted) mounted.area.inert = true;
  forceStopSession();
  diagnostics.textContent = 'Forced stop: in-flight changes may be lost or partially persisted. Reload this page before reopening.';
  status.textContent = 'Worker force-stopped; no rollback or checkpoint success is claimed.';
  update();
};
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
update();
