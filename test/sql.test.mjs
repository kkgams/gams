import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../cmd/app/src/util/sql.js", import.meta.url), "utf8")
let moduleId = 0

async function loadSql(config, failAttachment = 0) {
    const calls = []
    let statements = 0
    let executions = 0
    const resource = id => ({ $resource: "wasi:sql/types", id })
    const runtime = {
        projectConfig: { sql: config },
        async invoke(target, ...args) {
            calls.push({ target, args })
            if (target.endsWith("connection.open")) return { ok: resource("connection") }
            if (target.endsWith("statement.prepare")) return { ok: resource(`statement-${++statements}`) }
            if (target === "sql/readwrite::exec") {
                return ++executions === failAttachment ? { err: resource("error") } : { ok: 0 }
            }
            if (target.endsWith("error.trace")) return "attachment failed"
            throw new Error(`Unexpected invocation: ${target}`)
        },
        async releaseResource(value) {
            calls.push({ release: value.id })
        },
    }
    const key = `__sqlTestRuntime${moduleId++}`
    globalThis[key] = runtime
    const code = source.replace('import { runtime } from "/core/runtime.js"',
        `const runtime = globalThis[${JSON.stringify(key)}]`)
    try {
        const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)
        return { module, calls }
    } catch (error) {
        error.calls = calls
        throw error
    } finally {
        delete globalThis[key]
    }
}

test("string and main-only map open the same database without attachments", async () => {
    for (const config of ["catalog/catalog.sqlite", { main: "catalog/catalog.sqlite" }]) {
        const { calls } = await loadSql(config)
        assert.deepEqual(calls, [{
            target: "sql/types::[static]connection.open", args: ["catalog/catalog.sqlite"],
        }])
    }
})

test("main opens first regardless of map order; attachments use bound paths and quoted schemas", async () => {
    const { calls } = await loadSql({ other: "catalog/it's.sqlite", main: "main.sqlite", 'odd"schema': "third.sqlite" })
    assert.deepEqual(calls, [
        { target: "sql/types::[static]connection.open", args: ["main.sqlite"] },
        { target: "sql/types::[static]statement.prepare", args: ['ATTACH DATABASE ? AS "other"', ["catalog/it's.sqlite"]] },
        { target: "sql/readwrite::exec", args: [
            { $resource: "wasi:sql/types", id: "connection" },
            { $resource: "wasi:sql/types", id: "statement-1" },
        ] },
        { release: "statement-1" },
        { target: "sql/types::[static]statement.prepare", args: ['ATTACH DATABASE ? AS "odd""schema"', ["third.sqlite"]] },
        { target: "sql/readwrite::exec", args: [
            { $resource: "wasi:sql/types", id: "connection" },
            { $resource: "wasi:sql/types", id: "statement-2" },
        ] },
        { release: "statement-2" },
    ])
})

test("invalid database maps fail before opening any connection", async () => {
    for (const config of [
        undefined, null, [], 1, "", {}, { other: "other.sqlite" },
        { main: "" }, { main: 1 }, { main: "main.sqlite", other: null },
        { main: "main.sqlite", "": "other.sqlite" },
        { main: "main.sqlite", "bad\0name": "other.sqlite" },
        { main: "main.sqlite", MAIN: "other.sqlite" },
        { main: "main.sqlite", TeMp: "other.sqlite" },
        { main: "main.sqlite", other: "other.sqlite", OTHER: "third.sqlite" },
    ]) {
        await assert.rejects(loadSql(config), error => {
            assert.deepEqual(error.calls, [])
            return true
        })
    }
})

test("attachment errors release error, statement and connection resources and stop initialization", async () => {
    await assert.rejects(loadSql({ main: "main.sqlite", other: "other.sqlite", third: "third.sqlite" }, 1), error => {
        assert.match(error.message, /exec SQL statement: attachment failed/)
        assert.deepEqual(error.calls.filter(call => call.release), [
            { release: "error" }, { release: "statement-1" }, { release: "connection" },
        ])
        assert.equal(error.calls.filter(call => call.target?.endsWith("statement.prepare")).length, 1)
        return true
    })
})
