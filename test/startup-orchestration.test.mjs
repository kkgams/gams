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
async function runApp(t, plugins = ["gams_modules/fs-archive/plugins/plugin.fs.wasm", "plugins/other.wasm"]) {
    const ready = deferred(), subscribed = deferred()
    const theme = deferred(), themeStarted = deferred()
    const plugin = deferred(), pluginStarted = deferred()
    const ui = deferred(), uiStarted = deferred(), enable = deferred(), enabling = deferred()
    const document = { body: node(), documentElement: node(), createElement: node, getElementById() { return null } }
    let unsubscribed = 0, themeCalls = 0, initCalls = 0, pluginCalls = 0, menuCalls = 0
    let pluginsLoaded = false, themeLoaded = false
    const runtime = {
        ready: ready.promise, config: { plugins },
        subscribeResolutionProgress(listener) {
            listener({ resources: [{ resource: "https://example.com/config.json", phase: "downloading", unit: "bytes", completed: 12, total: 24, cached: false }] })
            subscribed.resolve()
            return () => { unsubscribed++ }
        },
        async addPlugins(paths, replace) {
            pluginCalls++
            assert.equal(paths, plugins)
            assert.equal(replace, true)
            pluginStarted.resolve()
            await plugin.promise
            pluginsLoaded = true
        },
        resolveFile() { throw new Error("startup must not resolve Units") },
        download() { throw new Error("startup must not download Units") },
    }
    const deps = {
        runtime,
        require() { throw new Error("startup must not load a View module directly") },
        prepareTheme() {
            assert.equal(pluginsLoaded, true)
            themeCalls++
            themeStarted.resolve()
            return theme.promise
        },
        async init(config, themeReady) {
            assert.equal(config, runtime.config)
            assert.equal(themeReady, theme.promise)
            assert.equal(themeLoaded, true)
            initCalls++
            uiStarted.resolve()
            await ui.promise
        },
        async initSaveMenu() {
            assert.equal(pluginsLoaded, true)
            assert.equal(themeLoaded, true)
            menuCalls++
            return { async enable() { enabling.resolve(); await enable.promise } }
        },
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
        ['import { require } from "/util/require.js"', 'const { require } = globalThis.__startupAppTest'],
        ...["startup-progress", "local-path"].map(name => [`from "/core/${name}.js"`, `from ${JSON.stringify(new URL(`../cmd/app/src/core/${name}.js`, import.meta.url).href)}`]),
    ]) {
        assert.ok(source.includes(line), `startup harness import not found: ${line}`)
        source = source.replace(line, replacement)
    }
    const task = import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${Math.random()}`).toString("base64")}`)
    await subscribed.promise
    const host = document.body.children[0]
    assert.equal(window.require, deps.require)
    assert.equal(pluginCalls, 0)
    assert.equal(themeCalls, 0)
    assert.equal(host.querySelector("form").children[0].querySelector("progress").value, 0.5, "config acquisition replay is visible before runtime.ready")
    return {
        task, host, ready, theme, themeStarted, plugin, pluginStarted, ui, uiStarted, enable, enabling, runtime,
        finishTheme() { themeLoaded = true; theme.resolve() },
        stats: () => ({ unsubscribed, initCalls, themeCalls, pluginCalls, menuCalls }),
    }
}

test("prepared plugins load once before theme, then UI/menu; screen waits for layout and menu enabling", async t => {
    const f = await runApp(t)
    f.ready.resolve()
    await f.pluginStarted.promise
    assert.equal(f.host.querySelector("#phase").textContent, "Loading Project plugins")
    assert.equal(f.stats().themeCalls, 0)
    f.plugin.resolve()
    await f.themeStarted.promise
    assert.equal(f.stats().initCalls, 0)
    assert.equal(f.host.removed, undefined)
    assert.equal(f.host.querySelector("#phase").textContent, "Preparing Project theme")
    f.finishTheme()
    await f.uiStarted.promise
    assert.equal(f.host.querySelector("#phase").textContent, "Loading Project interface")
    assert.equal(globalThis.runtime, undefined)
    f.ui.resolve()
    await f.enabling.promise
    assert.equal(f.host.removed, undefined)
    f.enable.resolve()
    await f.task
    assert.equal(f.host.removed, true)
    assert.deepEqual(f.stats(), { unsubscribed: 1, initCalls: 1, themeCalls: 1, pluginCalls: 1, menuCalls: 1 })
    assert.equal(globalThis.runtime, f.runtime)
})

for (const failing of ["ready", "plugin", "theme"]) test(`${failing} failure retains error screen and unsubscribes without initializing UI`, async t => {
    const f = await runApp(t)
    if (failing !== "ready") {
        f.ready.resolve()
        await f.pluginStarted.promise
    }
    if (failing === "theme") {
        f.plugin.resolve()
        await f.themeStarted.promise
    }
    f[failing].reject(new Error(`${failing} failed`))
    await f.task
    assert.equal(f.host.removed, undefined)
    assert.equal(f.host.querySelector("#error").textContent, `${failing} failed`)
    assert.equal(f.host.querySelector("button").hidden, false)
    assert.equal(f.stats().initCalls, 0)
    assert.equal(f.stats().menuCalls, 0)
    assert.equal(f.stats().unsubscribed, 1)
    assert.equal(globalThis.runtime, undefined)
})

for (const plugins of [null, {}, [null], [""], [" "], ["valid.wasm", "https://example.com/plugin.fs.wasm"], ["file:///plugin.wasm"], [{ $file: "plugin.wasm" }]]) {
    test(`invalid plugins fail before native loading: ${JSON.stringify(plugins)}`, async t => {
        const f = await runApp(t, plugins)
        f.ready.resolve()
        await f.task
        assert.equal(f.stats().pluginCalls, 0)
        assert.equal(f.stats().themeCalls, 0)
        assert.equal(f.stats().unsubscribed, 1)
        assert.match(f.host.querySelector("#error").textContent, /plugins/)
        if (Array.isArray(plugins)) assert.match(f.host.querySelector("#error").textContent, /\$file/)
    })
}

for (const plugins of [["plugins/renamed-component.wasm"], ["a/plugin.fs.wasm", "b/plugin.fs.wasm"]]) {
    test(`plugin paths have no filesystem basename selection rule: ${JSON.stringify(plugins)}`, async t => {
        const f = await runApp(t, plugins)
        f.ready.resolve()
        await f.pluginStarted.promise
        f.plugin.resolve()
        await f.themeStarted.promise
        f.finishTheme()
        await f.uiStarted.promise
        f.ui.resolve()
        await f.enabling.promise
        f.enable.resolve()
        await f.task
        assert.equal(f.stats().pluginCalls, 1)
        assert.equal(f.host.removed, true)
    })
}

test("no FS selection/fallback is invented for an empty plugin list; missing FS propagates from theme lookup", async t => {
    const f = await runApp(t, [])
    f.ready.resolve()
    await f.pluginStarted.promise
    f.plugin.resolve()
    await f.themeStarted.promise
    f.theme.reject(new Error("Unknown operation: fs/fs::read-file"))
    await f.task
    assert.equal(f.stats().pluginCalls, 1)
    assert.match(f.host.querySelector("#error").textContent, /Unknown operation: fs\/fs::read-file/)
    assert.equal(f.stats().unsubscribed, 1)
})
