import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../cmd/app/src/core/runtime.js", import.meta.url), "utf8")
const nativeSource = await readFile(new URL("../cmd/app/src/core/runtime/native.js", import.meta.url), "utf8")
let moduleId = 0

async function loadRuntime(project, handleCommand, projectProgress = []) {
  const calls = []
  globalThis.__TAURI__ = {
    core: {
      Channel: class { onmessage = () => {} },
      async invoke(command, args) {
        calls.push({ command, args })
        if (command === "runtime_project") {
          for (const event of projectProgress) args.onProgress.onmessage(event)
          return project
        }
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
  const nativeUrl = `data:text/javascript;base64,${Buffer.from(nativeSource + `\n// native ${moduleId++}`).toString("base64")}`
  const runtimeSource = source.replace('"./runtime/native.js"', JSON.stringify(nativeUrl))
  const module = await import(`data:text/javascript;base64,${Buffer.from(runtimeSource + `\n// test ${moduleId++}`).toString("base64")}`)
  return { runtime: module.runtime, calls }
}

test("shared runtime delegates Tauri access to the native module", () => {
  assert.doesNotMatch(source, /__TAURI__/)
  assert.match(source, /from "\.\/runtime\/native\.js"/)
})

test("ready exposes native config and modules path without a filesystem plugin", async () => {
  const config = { plugins: ["plugins/fs.comp.wasm"], ui: {} }
  const { runtime, calls } = await loadRuntime({ config, configFile: "gams.json", modulesDir: "/project/gams_modules" })
  await runtime.ready
  assert.equal(runtime.config, config)
  assert.equal(runtime.projectConfig, config)
  assert.equal(runtime.modulesDir, "/project/gams_modules")
  assert.deepEqual(calls.map(call => call.command || call.event), [
    "runtime_project", "gams-runtime-call-view", "runtime_call_view_ready",
  ])
})

test("ready exposes the shared directory selected by native bootstrap", async () => {
  const { runtime } = await loadRuntime({ config: {}, configFile: "gams.json", modulesDir: "/shared/units" })
  await runtime.ready
  assert.equal(runtime.modulesDir, "/shared/units")
})

test("invalid native configuration rejects readiness", async () => {
  const { runtime } = await loadRuntime({ config: [], configFile: "gams.json", modulesDir: "/shared/units" })
  await assert.rejects(runtime.ready, /config must be an object/)
})

test("runtime downloads bytes with progress and loads a typed-array slice", async () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 13, 0, 1, 0])
  const handle = { handle: "component:1", path: "/project/gams_modules/fs.wasm", imports: [], exports: [] }
  const { runtime } = await loadRuntime({ config: {}, configFile: "gams.json", modulesDir: "/project/gams_modules" }, (command, args) => {
    if (command === "runtime_download") {
      assert.equal(args.url, "http://127.0.0.1:8765/fs.wasm")
      assert.ok(args.onProgress instanceof globalThis.__TAURI__.core.Channel)
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
  assert.doesNotMatch(app, /gams_modules/)
  assert.doesNotMatch(app, /fs\/fs::read-text|JSON\.parse|setProjectConfig/)
})

test("resolution progress from Project initialization replays before readiness and supports unsubscribe", async () => {
  const first = { operationId: 1, status: "resolving", discovered: 0, completed: 0, resources: [], error: null }
  const last = { ...first, status: "ready" }
  let finishProject
  const project = new Promise(resolve => { finishProject = resolve })
  const { runtime, calls } = await loadRuntime(project, null, [first])
  const events = []
  const unsubscribe = runtime.subscribeResolutionProgress(event => events.push(event))
  assert.throws(() => runtime.config, /not loaded/)
  assert.equal(runtime.resolutionProgress, first)
  assert.deepEqual(events, [first])
  calls[0].args.onProgress.onmessage(last)
  assert.equal(runtime.resolutionProgress, last)
  assert.deepEqual(events, [first, last])
  unsubscribe()
  calls[0].args.onProgress.onmessage(last)
  finishProject({ config: {}, configFile: "gams.json", modulesDir: "/modules" })
  await runtime.ready
  assert.deepEqual(events, [first, last])
  assert.ok(calls[0].args.onProgress instanceof globalThis.__TAURI__.core.Channel)
  assert.throws(() => runtime.subscribeResolutionProgress(null), /must be a function/)
})

test("resolveFile passes native source/Channel and updates global and per-call progress", async () => {
  let progressChannel
  const events = [
    { operationId: 2, status: "resolving", discovered: 1, completed: 0, resources: [{ resource: "view.js", phase: "checking-cache", completed: 0, total: null, unit: null, cached: false }], error: null },
    { operationId: 2, status: "ready", discovered: 1, completed: 1, resources: [{ resource: "view.js", phase: "ready", completed: 1, total: 1, unit: null, cached: true }], error: null },
  ]
  const { runtime } = await loadRuntime({ config: {}, configFile: "gams.json", modulesDir: "/modules" }, (command, args) => {
    assert.equal(command, "runtime_resolve_file")
    assert.deepEqual(args.source, { url: "https://example.com/unit.zip", entry: "views/view.js" })
    progressChannel = args.onProgress
    for (const event of events) progressChannel.onmessage(event)
    return "/modules/unit/views/view.js"
  })
  const subscribed = []
  const unsubscribe = runtime.subscribeResolutionProgress(event => subscribed.push(event))
  const local = []
  assert.equal(await runtime.resolveFile({ url: "https://example.com/unit.zip", entry: "views/view.js" }, event => local.push(event)), "/modules/unit/views/view.js")
  assert.deepEqual(subscribed, events)
  assert.deepEqual(local, events)
  assert.equal(runtime.resolutionProgress, events.at(-1))
  unsubscribe()
  progressChannel.onmessage({ phase: "checking" })
  assert.equal(subscribed.length, 2)
  for (const source of [null, [], {}, "", { url: "" }, { url: "x", entry: 3 }])
    await assert.rejects(runtime.resolveFile(source), /source/)
  await assert.rejects(runtime.resolveFile("x", null), /callback/)
  await runtime.ready
})

test("native file resolution errors propagate without client-side retry", async () => {
  let calls = 0
  const { runtime } = await loadRuntime({ config: {}, configFile: "gams.json", modulesDir: "/modules" }, () => {
    calls++
    throw new Error("native resolution failed")
  })
  await assert.rejects(runtime.resolveFile("local.js"), /native resolution failed/)
  assert.equal(calls, 1)
  await runtime.ready
})

test("latest native resolution snapshot can be queried and replayed", async () => {
  const snapshot = { operationId: "native-1", status: "ready", discovered: 0, completed: 0, resources: [], error: null }
  const { runtime } = await loadRuntime({ config: {}, configFile: "gams.json", modulesDir: "/modules" }, (command, args) => {
    assert.equal(command, "runtime_resolution_progress")
    assert.deepEqual(args, {})
    return snapshot
  })
  await runtime.ready
  assert.equal(await runtime.getResolutionProgress(), snapshot)
  const received = []
  runtime.subscribeResolutionProgress(event => received.push(event))()
  assert.deepEqual(received, [snapshot])
})

test("empty ZIP entry selects the root directory through the native boundary", async () => {
  const { runtime } = await loadRuntime({ config: {}, configFile: "gams.json", modulesDir: "/modules" }, (command, args) => {
    assert.equal(command, "runtime_resolve_file")
    assert.deepEqual(args.source, { url: "https://example.com/assets.zip", entry: "" })
    return "/modules/assets/content"
  })
  await runtime.ready
  assert.equal(await runtime.resolveFile({ url: "https://example.com/assets.zip", entry: "" }), "/modules/assets/content")
})
