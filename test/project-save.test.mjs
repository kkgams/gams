import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const runtimeSource = await readFile(new URL("../cmd/app/src/core/runtime.js", import.meta.url), "utf8")
const menuSource = await readFile(new URL("../cmd/app/src/core/menu.js", import.meta.url), "utf8")
const viewSource = await readFile(new URL("../cmd/app/src/util/view-plugin.js", import.meta.url), "utf8")
let moduleId = 0
const importSource = source => import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${moduleId++}`).toString("base64")}`)

async function setup(fail = () => null) {
  const config = { plugins: [], ui: { layout: "initial" } }
  const files = new Map([["gams.json", "original"]])
  const writes = []
  globalThis.__TAURI__ = {
    core: { async invoke(command, args) {
      if (command === "runtime_project") return { config, modulesDir: "/project/gams_modules" }
      if (command === "runtime_call_view_ready") return
      assert.equal(command, "runtime_invoke")
      writes.push(args)
      const error = fail(args)
      if (error) return { err: error }
      if (args.target === "fs/fs::write-text") files.set(args.args[0], args.args[1])
      else if (args.target === "fs/fs::rename") {
        assert.ok(files.has(args.args[0]))
        files.set(args.args[1], files.get(args.args[0]))
        files.delete(args.args[0])
      } else throw new Error(`Unexpected target ${args.target}`)
      return { ok: true }
    } },
    event: { async listen() { return () => {} } },
  }
  const { runtime, unwrap } = await importSource(runtimeSource)
  await runtime.ready
  return { runtime, unwrap, config, files, writes }
}

test("Project Save awaits hooks in registration order, then publishes current config", async () => {
  const { runtime, files, writes } = await setup()
  const order = []
  runtime.register({ id: "first", methods: { async projectSave() {
    order.push("start")
    await Promise.resolve()
    runtime.config.ui.layout = "updated"
    order.push("end")
  } } })
  runtime.register({ id: "legacy", methods: { save() { throw new Error("must not call .save") } } })
  runtime.register({ id: "second", methods: { projectSave() {
    assert.deepEqual(order, ["start", "end"])
    runtime.config.second = true
    return { ok: true }
  } } })
  assert.deepEqual(await runtime.projectSave(), { ok: true })
  assert.deepEqual(JSON.parse(files.get("gams.json")), runtime.config)
  assert.equal(files.get("gams.json").endsWith("\n"), true)
  assert.equal(files.size, 1)
  assert.deepEqual(writes.map(write => write.target), ["fs/fs::write-text", "fs/fs::rename"])
  assert.match(writes[0].args[0], /^\.gams\.json\..+\.tmp$/)
})

test("unregistered hooks are excluded and malformed hooks fail loudly", async () => {
  const { runtime } = await setup()
  assert.throws(() => runtime.register({ id: "bad", methods: { projectSave: true } }), /must be a function/)
  runtime.register({ id: "removed", methods: { projectSave() { throw new Error("removed") } } })
  await runtime.unregister("removed")
  await runtime.projectSave()
})

test("hook errors stop subsequent hooks and config publication; retry works", async () => {
  for (const mode of ["throw", "result"]) {
    const { runtime, files, writes } = await setup()
    runtime.register({ id: "broken", methods: { projectSave() {
      if (mode === "throw") throw new Error("failed hook")
      return { err: "failed hook" }
    } } })
    runtime.register({ id: "later", methods: { projectSave() { throw new Error("must not run") } } })
    await assert.rejects(runtime.projectSave(), /failed hook/)
    assert.equal(files.get("gams.json"), "original")
    assert.equal(writes.length, 0)
    await runtime.unregister("broken")
    await runtime.unregister("later")
    await runtime.projectSave()
  }
})

test("concurrent saves share one operation", async () => {
  const { runtime, writes } = await setup()
  let release
  const gate = new Promise(resolve => { release = resolve })
  let count = 0
  runtime.register({ id: "slow", methods: { async projectSave() { count++; await gate } } })
  const first = runtime.projectSave()
  const second = runtime.projectSave()
  assert.equal(first, second)
  release()
  await Promise.all([first, second])
  assert.equal(count, 1)
  assert.equal(writes.length, 2)
})

test("write, rename and serialization failures preserve existing config", async () => {
  for (const target of ["fs/fs::write-text", "fs/fs::rename"]) {
    const { runtime, files } = await setup(args => args.target === target ? "disk failure" : null)
    await assert.rejects(runtime.projectSave(), /disk failure/)
    assert.equal(files.get("gams.json"), "original")
  }
  const { runtime, writes } = await setup()
  runtime.config.circular = runtime.config
  await assert.rejects(runtime.projectSave(), /circular/i)
  assert.equal(writes.length, 0)
})

test("View helper exposes projectSave, honors overrides and retains legacy save", async () => {
  const plugins = []
  const runtime = { register(plugin) { plugins.push(plugin) }, async call() {} }
  globalThis.__viewTestRuntime = runtime
  globalThis.HTMLElement = class { tagName = "VIEW-TEST" }
  const source = viewSource
    .replace('import { runtime } from "/core/runtime.js"', 'const runtime = globalThis.__viewTestRuntime')
    .replace(/import \{ observeViewSourceState, persistViewSourceState, restoreViewSourceState \} from "\.\/view-source-state.js"/, "const restoreViewSourceState = () => {}; const persistViewSourceState = () => {}; const observeViewSourceState = () => ({ disconnect() {} })")
  const { registerViewPlugin } = await importSource(source)
  let saves = 0
  const view = new HTMLElement()
  view.projectSave = async () => { saves++; return true }
  view.save = () => "legacy"
  registerViewPlugin(view)
  assert.deepEqual(await plugins[0].methods.projectSave(), { ok: true })
  assert.deepEqual(await plugins[0].methods.save(), { ok: "legacy" })
  assert.equal(saves, 1)
  registerViewPlugin(new HTMLElement(), { projectSave: () => ({ ok: "override" }) })
  assert.deepEqual(await plugins[1].methods.projectSave(), { ok: "override" })
  registerViewPlugin(new HTMLElement())
  assert.deepEqual(await plugins[2].methods.projectSave(), { ok: true })
})

test("Project Save menu retains defaults and leaves all keyboard bindings to gams.json", async () => {
  const { runtime, unwrap, writes } = await setup()
  const toastEvents = []
  runtime.register({ id: "ui.toast", methods: {
    progressStart(input) { toastEvents.push(["start", input]); return { ok: { id: "save-toast" } } },
    progressUpdate(input) { toastEvents.push(["update", input]); return { ok: true } },
    progressSuccess(input) { toastEvents.push(["success", input]); return { ok: true } },
  } })
  const listeners = []
  globalThis.window = { addEventListener(...args) { listeners.push(args) } }
  const defaults = ["GAMS", "Edit", "Window", "Help"].map(text => ({ kind: "Submenu", async text() { return text } }))
  const menu = {
    async items() { return defaults },
    async insert(item, index) { defaults.splice(index, 0, item) },
    async setAsAppMenu() { this.installed = true },
  }
  globalThis.__TAURI__.menu = {
    Menu: { async default() { return menu } },
    MenuItem: { async new(options) { return { ...options, async setEnabled(enabled) { this.enabled = enabled } } } },
    Submenu: { async new(options) { return { ...options, kind: "Submenu", async text() { return options.text } } } },
  }
  globalThis.__menuTestRuntime = runtime
  globalThis.__menuTestUnwrap = unwrap
  const { initSaveMenu } = await importSource(menuSource.replace('import { runtime, unwrap } from "/core/runtime.js"', 'const runtime = globalThis.__menuTestRuntime; const unwrap = globalThis.__menuTestUnwrap'))
  const controller = await initSaveMenu()
  assert.equal(menu.installed, true)
  assert.deepEqual(await Promise.all(defaults.map(item => item.text())), ["GAMS", "File", "Edit", "Window", "Help"])
  assert.equal(controller.save.enabled, false)
  controller.save.action()
  await new Promise(setImmediate)
  assert.equal(writes.length, 0, "menu must not save before initialization finishes")
  await controller.enable()
  assert.equal(controller.save.enabled, true)
  assert.equal(controller.save.text, "Save Project")
  assert.equal(controller.save.accelerator, undefined)
  assert.equal(listeners.length, 0, "Host must not intercept Project-configured shortcuts")
  controller.save.action()
  await runtime.call("project.save")
  assert.equal(writes.length, 2)
  assert.equal(toastEvents[0][0], "start")
  assert.equal(toastEvents.at(-1)[0], "success")
  assert.equal(toastEvents.filter(([stage]) => stage === "start").length, 1)
  assert.equal(toastEvents.at(-1)[1].message, "Project saved")
  // Reuse a native File submenu rather than adding a duplicate.
  const existingItems = ["Close"]
  const existingFile = { kind: "Submenu", async text() { return "File" }, async prepend(item) { existingItems.unshift(item) } }
  defaults.splice(1, 1, existingFile)
  const reused = await initSaveMenu()
  assert.equal(reused.file, existingFile)
  assert.equal(defaults.length, 5)
  assert.equal(existingItems[0], reused.save)
  assert.equal(existingItems[1], "Close")
})

test("save reports ordered progress and console stages through successful publication", async t => {
  const logs = []
  t.mock.method(console, "log", (...args) => logs.push(args))
  const { runtime, writes } = await setup()
  runtime.register({ id: "example", methods: { projectSave() { return { ok: true } } } })
  const progress = []
  await runtime.projectSave(event => { progress.push({ ...event, writes: writes.length }) })
  assert.deepEqual(progress.map(event => event.message), [
    "Saving Project (1 hooks)", "Saving example", "Writing gams.json", "Publishing gams.json", "Project saved",
  ])
  assert.deepEqual(progress.map(event => event.progress), [0, 0, 1 / 3, 2 / 3, 1])
  assert.deepEqual(progress.map(event => event.writes), [0, 0, 0, 1, 2])
  assert.ok(logs.some(([message]) => message === "[project.save] Project saved"))
})

test("failed Save finishes one error toast, logs failure and can be retried", async t => {
  const errors = []
  t.mock.method(console, "log", () => {})
  t.mock.method(console, "error", (...args) => errors.push(args))
  const { runtime, unwrap, writes } = await setup()
  const events = []
  runtime.register({ id: "ui.toast", methods: {
    progressStart(input) { events.push(["start", input]); return { ok: { id: "save-toast" } } },
    progressUpdate(input) { events.push(["update", input]); return { ok: true } },
    progressError(input) { events.push(["error", input]); return { ok: true } },
    progressSuccess(input) { events.push(["success", input]); return { ok: true } },
  } })
  runtime.register({ id: "broken", methods: { projectSave() { return { err: "disk full" } } } })
  globalThis.__menuTestRuntime = runtime
  globalThis.__menuTestUnwrap = unwrap
  const { createProjectSaveAction } = await importSource(menuSource.replace('import { runtime, unwrap } from "/core/runtime.js"', 'const runtime = globalThis.__menuTestRuntime; const unwrap = globalThis.__menuTestUnwrap'))
  const save = createProjectSaveAction()
  const first = save()
  assert.equal(first, save())
  assert.deepEqual(await first, { err: "broken.projectSave: disk full" })
  assert.equal(writes.length, 0)
  assert.equal(events.filter(([stage]) => stage === "start").length, 1)
  assert.equal(events.at(-1)[0], "error")
  assert.match(events.at(-1)[1].message, /disk full/)
  assert.equal(events.some(([stage]) => stage === "success"), false)
  assert.equal(errors[0][0], "[project.save] Save failed")
  await runtime.unregister("broken")
  assert.deepEqual(await save(), { ok: true })
  assert.equal(events.at(-1)[0], "success")
  assert.equal(writes.length, 2)
})

test("UI initialization awaits layout loading before Save can be enabled", async () => {
  let started
  let finish
  const loading = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { finish = resolve })
  const nodes = {
    "ui-layout": { setViewRegistry() {}, async load() { started(); await gate } },
    "toast-manager": { api: {} },
    "popup-manager": { api: {}, setViewRegistry() {} },
    "tooltip-manager": { api: {} },
  }
  const registered = []
  globalThis.__servicesTestRuntime = {
    register(plugin) { registered.push(plugin.id) },
    async invoke() { return { ok: [] } },
  }
  const requiredSources = []
  globalThis.__servicesTestRequire = async source => {
    requiredSources.push(source)
    return { createUiContext: () => ({ id: "ui.context" }), createUiKeys: () => ({ id: "ui.keys" }) }
  }
  globalThis.__servicesTestUnits = { async resolve() { return "theme.css" } }
  globalThis.window = { addEventListener() {} }
  const themeListeners = new Map()
  const themeAttributes = new Map([["rel", "stylesheet"]])
  const themeLink = {
    tagName: "LINK",
    getAttribute(name) { return themeAttributes.get(name) ?? null },
    setAttribute(name, value) { themeAttributes.set(name, value); if (name === "href") queueMicrotask(() => themeListeners.get("load")()) },
    removeAttribute(name) { themeAttributes.delete(name) },
    addEventListener(name, listener) { themeListeners.set(name, listener) },
    removeEventListener(name) { themeListeners.delete(name) },
  }
  globalThis.document = {
    createElement(tag) { return nodes[tag] },
    body: { appendChild() {} },
    querySelector(tag) { return nodes[tag] },
    querySelectorAll() { return [] },
    getElementById() { return themeLink },
  }
  globalThis.DocumentFragment = class { appendChild() {} }
  const source = (await readFile(new URL("../cmd/app/src/___/services.js", import.meta.url), "utf8"))
    .replace('import { require, projectUnits } from "/util/require.js"', 'const require = globalThis.__servicesTestRequire; const projectUnits = globalThis.__servicesTestUnits')
    .replace('import { runtime } from "/core/runtime.js"', 'const runtime = globalThis.__servicesTestRuntime')
    .replace('from "/core/ui-service-sources.js"', `from ${JSON.stringify(new URL("../cmd/app/src/core/ui-service-sources.js", import.meta.url).href)}`)
    .replace('import { restoreViewSourceState } from "/util/view-source-state.js"', 'const restoreViewSourceState = () => {}')
    .replace('from "/core/project-theme.js"', `from ${JSON.stringify(new URL("../cmd/app/src/core/project-theme.js", import.meta.url).href)}`)
  const { init } = await importSource(source)
  let complete = false
  const ids = ["ui-context", "ui-keys", "ui-layout", "ui-toast", "ui-popup", "ui-tooltip"]
  const services = Object.fromEntries(ids.map(id => [id, { url: `https://example.com/${id}.zip#service.js` }]))
  services["ui-layout"].config = { layout: "<view-empty/>" }
  const initialized = init({ ui: { views: {}, theme: { url: "theme.css" }, services } }).then(() => { complete = true })
  await loading
  assert.equal(complete, false)
  assert.deepEqual(requiredSources, ids.map(id => services[id].url))
  assert.ok(registered.includes("ui.context"))
  assert.ok(registered.includes("ui.popup"))
  finish()
  await initialized
  assert.equal(complete, true)
  URL.revokeObjectURL(window.__currentThemeStylesheetHref)
})
