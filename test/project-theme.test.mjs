import test from "node:test"
import assert from "node:assert/strict"
import { loadProjectTheme } from "../cmd/app/src/core/project-theme.js"

const config = { ui: { theme: { url: "https://example.com/theme.zip#themes/theme.css" } } }
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
        projectUnits: { async resolve(source) { calls.push(["resolve", source]); return "/modules/theme.css" } },
        runtime: { async invoke(method, path) { calls.push([method, path]); return read } },
        url: { createObjectURL(blob) { assert.equal(blob.type, "text/css"); return "blob:new-theme" }, revokeObjectURL(href) { revoked.push(href) } },
    }
    return { deps, link, listeners, calls, revoked, assignment }
}

test("Project theme resolution waits for CSS load, with listeners installed before href assignment", async () => {
    const f = fixture()
    let finished = false
    const task = loadProjectTheme(config, f.deps).then(result => { finished = true; return result })
    await f.assignment
    assert.equal(finished, false)
    assert.equal(f.link.getAttribute("href"), "blob:new-theme")
    assert.deepEqual([...f.listeners.keys()], ["load", "error"])
    f.listeners.get("load")()
    assert.deepEqual(await task, { path: "/modules/theme.css", href: "blob:new-theme" })
    assert.equal(f.listeners.size, 0)
    assert.deepEqual(f.revoked, [])
    assert.deepEqual(f.calls, [["resolve", config.ui.theme.url], ["fs/fs::read-file", "/modules/theme.css"]])
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

test("missing config/Host link and filesystem failures fail without applying a theme", async () => {
    for (const invalid of [{}, { ui: {} }, { ui: { theme: {} } }, { ui: { theme: { url: 1 } } }]) {
        const f = fixture()
        await assert.rejects(loadProjectTheme(invalid, f.deps), /ui.theme.url is required/)
        assert.deepEqual(f.calls, [])
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

test("legacy local theme path still uses the same explicit Project source", async () => {
    const f = fixture({ immediateLoad: true })
    await loadProjectTheme({ ui: { theme: { path: "themes/local.css" } } }, f.deps)
    assert.deepEqual(f.calls[0], ["resolve", "themes/local.css"])
})
