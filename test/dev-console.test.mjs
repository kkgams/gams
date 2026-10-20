import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const script = readFileSync(new URL("../cmd/app/src-tauri/src/dev-console.js", import.meta.url), "utf8")

function setup(invoke) {
  const calls = []
  const originals = []
  const listeners = {}
  const context = vm.createContext({
    Error,
    console: Object.fromEntries(["log", "info", "debug", "warn", "error"].map(level =>
      [level, (...args) => originals.push({ level, args })])),
    __TAURI__: { core: { invoke: invoke ?? ((command, payload) => {
      calls.push({ command, ...payload })
      return Promise.resolve()
    }) } },
    addEventListener: (name, listener) => { listeners[name] = listener },
  })
  vm.runInContext(script, context)
  return { calls, originals, listeners, console: context.console }
}

test("forwards all five levels while preserving browser console arguments", () => {
  const bridge = setup()
  const object = { count: 2 }
  for (const level of ["log", "info", "debug", "warn", "error"]) {
    bridge.console[level]("hello", object)
    assert.deepEqual(bridge.calls.at(-1), {
      command: "runtime_console", level, message: 'hello {"count":2}',
    })
    assert.equal(bridge.originals.at(-1).args[1], object)
  }
})

test("formats errors, circular objects, BigInt and undefined", () => {
  const bridge = setup()
  const error = new Error("broken")
  const circular = {}
  circular.self = circular
  bridge.console.error(error, circular, 1n, undefined)
  assert.equal(bridge.calls[0].message, `${error.stack} [object Object] 1 undefined`)
})

test("captures uncaught errors and rejected promises without suppressing browser handling", () => {
  const bridge = setup()
  const error = new Error("startup failed")
  bridge.listeners.error({ error })
  bridge.listeners.error({ message: "Syntax error", filename: "app.js", lineno: 2, colno: 3 })
  bridge.listeners.unhandledrejection({ reason: error })
  assert.deepEqual(bridge.calls.map(call => call.message), [
    error.stack, "Syntax error (app.js:2:3)", `Unhandled promise rejection: ${error.stack}`,
  ])
  assert.ok(bridge.calls.every(call => call.level === "error"))
})

test("reports IPC failure to the original console without forwarding recursively", async () => {
  let attempts = 0
  const error = new Error("IPC failed")
  const bridge = setup(() => {
    attempts++
    return Promise.reject(error)
  })
  bridge.console.log("hello")
  await Promise.resolve()
  assert.equal(attempts, 1)
  assert.deepEqual(bridge.originals.at(-1), {
    level: "error", args: ["Console forwarding failed", error],
  })
})
