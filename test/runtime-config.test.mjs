import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../cmd/app/src/core/runtime.js", import.meta.url), "utf8")
let moduleId = 0

async function loadRuntime(project) {
  const calls = []
  globalThis.__TAURI__ = {
    core: {
      async invoke(command, args) {
        calls.push({ command, args })
        if (command === "runtime_project") return project
        if (command === "runtime_call_view_ready") return
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

test("app bootstrap uses runtime config instead of reading gams.json via fs", async () => {
  const app = await readFile(new URL("../cmd/app/src/app.js", import.meta.url), "utf8")
  assert.match(app, /const config = runtime\.config/)
  assert.match(app, /const GAMS_MODULES = "gams_modules"/)
  assert.doesNotMatch(app, /fs\/fs::read-text|JSON\.parse|setProjectConfig/)
})
