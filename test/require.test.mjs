import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolveObjectURL } from "node:buffer"
import { validateLocalPath } from "../cmd/app/src/core/local-path.js"

const source = await readFile(new URL("../cmd/app/src/util/require.js", import.meta.url), "utf8")
function fixture(invoke = async () => ({ ok: [...new TextEncoder().encode("export const answer = 42")] })) {
    const calls = [], created = [], revoked = [], imports = []
    const runtime = {
        async invoke(...args) { calls.push(args); return await invoke(...args) },
        resolveFile() { assert.fail("require must not resolve a Unit") },
        download() { assert.fail("require must not download a Unit") },
        addPlugins() { assert.fail("require must not acquire a filesystem plugin") },
    }
    class TestURL extends URL {
        static createObjectURL(blob) { const url = URL.createObjectURL(blob); created.push(url); return url }
        static revokeObjectURL(url) { revoked.push(url); URL.revokeObjectURL(url) }
    }
    // Node cannot import blob URLs; only adapt that browser module-loader boundary.
    const importModule = async url => {
        imports.push(url)
        const blob = resolveObjectURL(url)
        assert.equal(blob.type, "text/javascript")
        return await import(`data:text/javascript;base64,${Buffer.from(await blob.text()).toString("base64")}`)
    }
    const body = source.replace(/^import .*$/gm, "").replace(/^export /gm, "").replace("import(url)", "importModule(url)")
    const require = new Function("runtime", "validateLocalPath", "URL", "location", "importModule", `${body}\nreturn require`)(
        runtime, validateLocalPath, TestURL, { origin: "https://host.example" }, importModule)
    return { require, calls, created, revoked, imports }
}

test("require reads the given prepared local path via FS then imports and releases a JS blob", async () => {
    const f = fixture()
    const path = "gams_modules/view-archive/views/view.js"
    assert.equal((await f.require(path)).answer, 42)
    assert.deepEqual(f.calls, [["fs/fs::read-file", path]])
    assert.equal(f.created.length, 1)
    assert.deepEqual(f.imports, f.created)
    assert.deepEqual(f.revoked, f.created)
    assert.equal(resolveObjectURL(f.created[0]), undefined)
})

test("require rejects missing paths and bare legacy URLs before filesystem/native work", async () => {
    const f = fixture()
    for (const path of [undefined, null, {}, "", " ", "https://example.com/view.js", "https://example.com/views.zip#view.js", "file:///view.js"])
        await assert.rejects(f.require(path), /local path.*\$file/)
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.created, [])
})

test("missing FS operation errors propagate unchanged without fallback or import", async () => {
    const error = new Error("Unknown operation: fs/fs::read-file")
    const f = fixture(async () => { throw error })
    await assert.rejects(f.require("views/local.js"), failure => failure === error)
    assert.deepEqual(f.calls, [["fs/fs::read-file", "views/local.js"]])
    assert.deepEqual(f.created, [])
})

test("filesystem WIT errors and malformed results fail before import", async () => {
    for (const result of [{ err: "not found" }, {}]) {
        const f = fixture(async () => result)
        await assert.rejects(f.require("views/local.js"), /require failed/)
        assert.deepEqual(f.created, [])
    }
})

test("failed module imports still release the blob", async () => {
    const f = fixture(async () => ({ ok: [...new TextEncoder().encode("throw new Error('module failed')")] }))
    await assert.rejects(f.require("views/broken.js"), /module failed/)
    assert.deepEqual(f.revoked, f.created)
})
