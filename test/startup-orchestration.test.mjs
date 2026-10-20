import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}
function node() {
    return {
        children: [], selectors: new Map(), style: {},
        classList: { add() {}, toggle() {} },
        appendChild(child) { this.children.push(child) },
        querySelector(selector) { if (!this.selectors.has(selector)) this.selectors.set(selector, node()); return this.selectors.get(selector) },
        setAttribute() {}, removeAttribute() {}, addEventListener() {},
        remove() { this.removed = true },
    }
}
async function runApp(t, filesystemSource) {
    const bootstrap = deferred(), bootstrapStarted = deferred()
    const theme = deferred(), themeStarted = deferred()
    const plugin = deferred(), pluginStarted = deferred(), pluginsLoaded = deferred()
    const ui = deferred(), uiStarted = deferred(), enable = deferred(), enabling = deferred()
    const document = { body: node(), documentElement: node(), createElement: node, getElementById() { return null } }
    let unsubscribed = 0, initCalls = 0, themeCalls = 0, fsReady = false
    const runtime = {
        ready: Promise.resolve(), config: { plugins: filesystemSource ? [filesystemSource] : ["plugin.wasm"] },
        async addPlugins(paths, replace) { assert.deepEqual(paths, ["installed.wasm"]); assert.equal(replace, true); pluginsLoaded.resolve() },
    }
    const deps = {
        runtime,
        require() { throw new Error("startup must not load a View module directly") },
        projectUnits: {
            subscribeProgress() { return () => { unsubscribed++ } },
            async bootstrapFilesystem(source) { assert.equal(source, filesystemSource || "https://github.com/kkgams/plugin.fs/releases/download/v0.1.1/plugin.fs.wasm"); bootstrapStarted.resolve(); await bootstrap.promise; fsReady = true },
            async resolve(source) { assert.equal(source, filesystemSource || "plugin.wasm"); assert.equal(fsReady, true); pluginStarted.resolve(); await plugin.promise; return "installed.wasm" },
        },
        prepareTheme() { assert.equal(fsReady, true); themeCalls++; themeStarted.resolve(); return theme.promise },
        async init(config, themeReady) { assert.equal(config, runtime.config); assert.equal(themeReady, theme.promise); initCalls++; uiStarted.resolve(); await ui.promise },
        async initSaveMenu() { return { async enable() { enabling.resolve(); await enable.promise } } },
    }
    const globals = { window: {}, document, location: { reload() {} }, app: {}, requestAnimationFrame() {}, __startupAppTest: deps }
    const previous = new Map(Object.keys(globals).concat("runtime").map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    Object.assign(globalThis, globals)
    delete globalThis.runtime
    t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
    t.mock.method(console, "time", () => {})
    t.mock.method(console, "timeEnd", () => {})
    t.mock.method(console, "error", () => {})
    let source = await readFile(new URL("../cmd/app/src/app.js", import.meta.url), "utf8")
    for (const [line, replacement] of [
        ['import { runtime } from "/core/runtime.js"', 'const { runtime } = globalThis.__startupAppTest'],
        ['import { initSaveMenu } from "/core/menu.js"', 'const { initSaveMenu } = globalThis.__startupAppTest'],
        ['import { init, prepareTheme } from "/___/services.js"', 'const { init, prepareTheme } = globalThis.__startupAppTest'],
        ['import { projectUnits, require } from "/util/require.js"', 'const { projectUnits, require } = globalThis.__startupAppTest'],
        ['from "/core/startup-progress.js"', `from ${JSON.stringify(new URL("../cmd/app/src/core/startup-progress.js", import.meta.url).href)}`],
        ['from "/core/project-units.js"', `from ${JSON.stringify(new URL("../cmd/app/src/core/project-units.js", import.meta.url).href)}`],
    ]) {
        assert.ok(source.includes(line), `startup harness import not found: ${line}`)
        source = source.replace(line, replacement)
    }
    const task = import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${Math.random()}`).toString("base64")}`)
    await Promise.race([bootstrapStarted.promise, task.then(() => { throw new Error("startup ended before filesystem bootstrap") })])
    assert.equal(window.require, deps.require)
    const host = document.body.children[0]
    assert.equal(themeCalls, 0)
    bootstrap.resolve()
    await Promise.all([themeStarted.promise, pluginStarted.promise])
    return { task, host, theme, plugin, pluginsLoaded, ui, uiStarted, enable, enabling, runtime, stats: () => ({ unsubscribed, initCalls, themeCalls }) }
}

test("theme and plugins start together after FS, UI waits for both, and screen waits for layout/menu", async t => {
    const f = await runApp(t, "https://example.com/v2/plugin.fs.wasm")
    assert.equal(f.host.querySelector("#phase").textContent, "Preparing theme and plugins")
    f.plugin.resolve()
    await f.pluginsLoaded.promise
    assert.equal(f.stats().initCalls, 0)
    assert.equal(f.host.removed, undefined)
    f.theme.resolve()
    await f.uiStarted.promise
    assert.equal(f.host.querySelector("#phase").textContent, "Loading Project interface")
    assert.equal(f.stats().themeCalls, 1)
    assert.equal(globalThis.runtime, undefined)
    f.ui.resolve()
    await f.enabling.promise
    assert.equal(f.host.removed, undefined)
    f.enable.resolve()
    await f.task
    assert.equal(f.host.removed, true)
    assert.equal(f.stats().unsubscribed, 1)
    assert.equal(globalThis.runtime, f.runtime)
})

for (const failing of ["theme", "plugin"]) test(`${failing} failure keeps the screen and handles later parallel rejection`, async t => {
    const f = await runApp(t)
    f[failing].reject(new Error(`${failing} failed`))
    await f.task
    assert.equal(f.host.removed, undefined)
    assert.equal(f.host.querySelector("#error").textContent, `${failing} failed`)
    assert.equal(f.host.querySelector("button").hidden, false)
    assert.equal(f.stats().initCalls, 0)
    assert.equal(f.stats().unsubscribed, 1)
    assert.equal(globalThis.runtime, undefined)
    f[failing === "theme" ? "plugin" : "theme"].reject(new Error("later failure"))
    await new Promise(resolve => setImmediate(resolve))
})
