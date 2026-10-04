import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../cmd/app/src/core/runtime.js", import.meta.url), "utf8")
let moduleId = 0

async function loadRuntime(project, handleCommand) {
  const calls = []
  globalThis.__TAURI__ = {
    core: {
      Channel: class { onmessage = () => {} },
      async invoke(command, args) {
        calls.push({ command, args })
        if (command === "runtime_project") return project
        if (command === "runtime_call_view_ready") return
        if (handleCommand) return handleCommand(command, args)
        throw new Error(`Unexpected command: ${command}`)
      },
    },
    event: {
      async listen(name) {
        calls.push({ event: name })
        return () => {}
      },
    },
  }
  const module = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// test ${moduleId++}`).toString("base64")}`)
  return { runtime: module.runtime, calls }
}

test("ready exposes native config and modules path without a filesystem plugin", async () => {
  const config = { plugins: ["plugins/fs.comp.wasm"], ui: {} }
  const { runtime, calls } = await loadRuntime({ config, modulesDir: "/project/gams_modules" })
  await runtime.ready
  assert.equal(runtime.config, config)
  assert.equal(runtime.projectConfig, config)
  assert.equal(runtime.modulesDir, "/project/gams_modules")
  assert.deepEqual(calls.map(call => call.command || call.event), [
    "runtime_project", "gams-runtime-call-view", "runtime_call_view_ready",
  ])
})

test("ready exposes the shared directory selected by native bootstrap", async () => {
  const { runtime } = await loadRuntime({ config: {}, modulesDir: "/shared/units" })
  await runtime.ready
  assert.equal(runtime.modulesDir, "/shared/units")
})

test("invalid native configuration rejects readiness", async () => {
  const { runtime } = await loadRuntime({ config: [], modulesDir: "/shared/units" })
  await assert.rejects(runtime.ready, /config must be an object/)
})

test("runtime downloads bytes with progress and loads a typed-array slice", async () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 13, 0, 1, 0])
  const handle = { handle: "component:1", path: "/project/gams_modules/fs.wasm", imports: [], exports: [] }
  const { runtime } = await loadRuntime({ config: {}, modulesDir: "/project/gams_modules" }, (command, args) => {
    if (command === "runtime_download") {
      assert.equal(args.url, "http://127.0.0.1:8765/fs.wasm")
      args.onProgress.onmessage({ downloaded: bytes.length, total: bytes.length })
      return bytes.buffer
    }
    assert.equal(command, "runtime_load_from_bytes")
    assert.deepEqual(args.bytes, Array.from(bytes))
    assert.equal(args.path, handle.path)
    return handle
  })
  await runtime.ready
  const progress = []
  assert.deepEqual(await runtime.download("http://127.0.0.1:8765/fs.wasm", event => progress.push(event)), bytes)
  assert.equal(progress[0].downloaded, bytes.length)
  const padded = new Uint8Array([99, ...bytes, 99])
  assert.deepEqual(await runtime.loadFromBytes(padded.subarray(1, -1), handle.path), handle)
})

test("app bootstrap uses runtime config instead of reading gams.json via fs", async () => {
  const app = await readFile(new URL("../cmd/app/src/app.js", import.meta.url), "utf8")
  assert.match(app, /const config = runtime\.config/)
  assert.match(app, /const GAMS_MODULES = "gams_modules"/)
  assert.doesNotMatch(app, /fs\/fs::read-text|JSON\.parse|setProjectConfig/)
})
