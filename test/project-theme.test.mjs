import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { loadProjectTheme } from "../cmd/app/src/core/project-theme.js"

const config = { ui: { theme: { url: "gams_modules/theme-archive/themes/theme.css" } } }
function fixture({ previousHref = null, read = { ok: [47, 42, 42, 47] }, immediateLoad = false } = {}) {
    const listeners = new Map()
    const attributes = new Map([["rel", "stylesheet"]])
    if (previousHref !== null) attributes.set("href", previousHref)
    const revoked = [], calls = []
    let assigned
    const assignment = new Promise(resolve => { assigned = resolve })
    const link = {
        tagName: "LINK",
        getAttribute(name) { return attributes.get(name) ?? null },
        setAttribute(name, value) {
            attributes.set(name, value)
            if (name === "href") {
                assigned()
                if (immediateLoad && listeners.has("load")) listeners.get("load")()
            }
        },
        removeAttribute(name) { attributes.delete(name) },
        addEventListener(name, listener) { listeners.set(name, listener) },
        removeEventListener(name) { listeners.delete(name) },
    }
    const deps = {
        document: { getElementById(id) { assert.equal(id, "theme-stylesheet"); return link } },
        runtime: {
            async invoke(method, path) { calls.push([method, path]); return read },
            resolveFile() { assert.fail("theme must not resolve Units") },
            download() { assert.fail("theme must not download Units") },
            addPlugins() { assert.fail("theme must not acquire filesystem plugins") },
        },
        url: { createObjectURL(blob) { assert.equal(blob.type, "text/css"); return "blob:new-theme" }, revokeObjectURL(href) { revoked.push(href) } },
    }
    return { deps, link, listeners, calls, revoked, assignment }
}

test("local Project theme waits for CSS load, with listeners installed before href assignment", async () => {
    const f = fixture()
    let finished = false
    const task = loadProjectTheme(config, f.deps).then(result => { finished = true; return result })
    await f.assignment
    assert.equal(finished, false)
    assert.equal(f.link.getAttribute("href"), "blob:new-theme")
    assert.deepEqual([...f.listeners.keys()], ["load", "error"])
    f.listeners.get("load")()
    assert.deepEqual(await task, { path: config.ui.theme.url, href: "blob:new-theme" })
    assert.equal(f.listeners.size, 0)
    assert.deepEqual(f.revoked, [])
    assert.deepEqual(f.calls, [["fs/fs::read-file", config.ui.theme.url]])
    const immediate = fixture({ immediateLoad: true })
    assert.equal((await loadProjectTheme(config, immediate.deps)).href, "blob:new-theme")
})

test("CSS failure is propagated, restores the previous stylesheet, and releases the failed blob", async () => {
    for (const previousHref of [null, "blob:previous-theme"]) {
        const f = fixture({ previousHref })
        const task = loadProjectTheme(config, f.deps)
        const rejected = assert.rejects(task, /Project theme stylesheet could not be loaded/)
        await f.assignment
        f.listeners.get("error")()
        await rejected
        assert.equal(f.link.getAttribute("href"), previousHref)
        assert.deepEqual(f.revoked, ["blob:new-theme"])
        assert.equal(f.listeners.size, 0)
    }
})

test("no selected theme keeps base styling without resolving or reading a Unit", async () => {
    for (const theme of [undefined, null]) {
        const f = fixture({ previousHref: "blob:previous-theme" })
        assert.deepEqual(await loadProjectTheme({ ui: { theme } }, f.deps), { path: null, href: null })
        assert.equal(f.link.getAttribute("href"), null)
        assert.deepEqual(f.calls, [])
        assert.equal(f.listeners.size, 0)
    }
})

test("missing config/Host link and filesystem failures fail without applying a theme", async () => {
    for (const invalid of [{ ui: { theme: {} } }, ...[1, " ", "https://example.com/theme.css", "https://example.com/theme.zip#theme.css", "file:///theme.css"].map(url => ({ ui: { theme: { url } } }))]) {
        const f = fixture()
        await assert.rejects(loadProjectTheme(invalid, f.deps), /ui.theme.url.*local path.*\$file/)
        assert.deepEqual(f.calls, [])
    }
    for (const invalid of [null, {}, { ui: [] }]) {
        await assert.rejects(loadProjectTheme(invalid, fixture().deps), /ui must be an object/)
    }
    const missing = fixture()
    missing.deps.document.getElementById = () => null
    await assert.rejects(loadProjectTheme(config, missing.deps), /Host theme stylesheet link is required/)
    assert.deepEqual(missing.calls, [])
    for (const read of [{ err: "disk unavailable" }, {}, { ok: undefined }]) {
        const f = fixture({ read })
        await assert.rejects(loadProjectTheme(config, f.deps), /theme read:/)
        assert.equal(f.link.getAttribute("href"), null)
        assert.equal(f.listeners.size, 0)
        assert.deepEqual(f.revoked, [])
    }
})

test("missing FS lookup propagates unchanged without acquisition or fallback", async () => {
    const f = fixture()
    const error = new Error("Unknown operation: fs/fs::read-file")
    f.deps.runtime.invoke = async (method, path) => {
        f.calls.push([method, path])
        throw error
    }
    await assert.rejects(loadProjectTheme(config, f.deps), failure => failure === error)
    assert.deepEqual(f.calls, [["fs/fs::read-file", config.ui.theme.url]])
    assert.equal(f.link.getAttribute("href"), null)
    assert.deepEqual(f.revoked, [])
})

test("services bootstrap accepts no theme and clears shadow links without assigning a null URL", async () => {
    const f = fixture({ previousHref: "blob:previous-theme" })
    const shadow = fixture({ previousHref: "blob:previous-theme" }).link
    f.deps.document.querySelectorAll = () => [{ shadowRoot: { querySelector: () => shadow } }]
    const window = {}, revoked = []
    const source = await readFile(new URL("../cmd/app/src/___/services.js", import.meta.url), "utf8")
    const body = source.replace(/^import .*$/gm, "").replace(/^export /gm, "")
    const run = new Function("loadProjectTheme", "runtime", "document", "window", "URL",
        `${body}\nreturn prepareTheme`)
    const prepare = run(loadProjectTheme, f.deps.runtime, f.deps.document, window,
        { revokeObjectURL(href) { revoked.push(href) } })
    await prepare({ ui: {} })
    assert.equal(window.__currentThemePath, null)
    assert.equal(window.__currentThemeStylesheetHref, null)
    assert.equal(shadow.getAttribute("href"), null)
    assert.equal(f.link.getAttribute("href"), null)
    assert.deepEqual(f.calls, [])
    assert.deepEqual(revoked, [])
})

test("legacy local theme path still uses the same explicit Project source", async () => {
    const f = fixture({ immediateLoad: true })
    await loadProjectTheme({ ui: { theme: { path: "themes/local.css" } } }, f.deps)
    assert.deepEqual(f.calls, [["fs/fs::read-file", "themes/local.css"]])
})
