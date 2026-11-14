import test from "node:test"
import assert from "node:assert/strict"
import { createProjectUnits, selectFilesystemSource } from "../cmd/app/src/core/project-units.js"

const moduleUrl = new URL("../cmd/app/src/core/project-units.js", import.meta.url)

test("filesystem selection uses the exact plugin.fs.wasm basename or the pinned fallback", async () => {
  const { selectFilesystemSource } = await import(moduleUrl)
  const fallback = "https://example.com/pinned/plugin.fs.wasm"
  for (const source of ["plugins/plugin.fs.wasm", "/custom/plugin.fs.wasm", String.raw`C:\project\plugin.fs.wasm`, "C:/project/plugin.fs.wasm", String.raw`\\server\project\plugin.fs.wasm`, "https://example.com/v2/plugin.fs.wasm?download=1"])
    assert.equal(selectFilesystemSource(["other.wasm", source], fallback), source)
  for (const source of ["my-plugin.fs.wasm", "plugin.fs.wasm.bak", "https://example.com/plugin.fs.wasm/other.wasm"])
    assert.equal(selectFilesystemSource([source], fallback), fallback)
  assert.equal(selectFilesystemSource([], fallback), fallback)
  assert.throws(() => selectFilesystemSource(["a/plugin.fs.wasm", "b/plugin.fs.wasm"], fallback), /Multiple filesystem/)
  assert.throws(() => selectFilesystemSource(["https://example.com/fs.zip#plugins/plugin.fs.wasm"], fallback), /not ZIP/)
  for (const plugins of [undefined, null, {}, [null], [12], [" "]])
    assert.throws(() => selectFilesystemSource(plugins, fallback), /plugins|source/)
})


test("Unit sources resolve at the native boundary, including decoded legacy ZIP selectors", async () => {
  const sources = []
  const runtime = { async resolveFile(source) { sources.push(source); return "/native/resolved" } }
  const units = createProjectUnits(runtime)
  for (const source of ["views/local.js", String.raw`C:\project\view.js`, "https://example.com/view.js?download=1", "https://example.com/unit.zip?download=1#views%2Fwith%20space.js"])
    assert.equal(await units.resolve(source), "/native/resolved")
  assert.deepEqual(sources, ["views/local.js", String.raw`C:\project\view.js`, "https://example.com/view.js?download=1", {
    url: "https://example.com/unit.zip?download=1", entry: "views/with space.js",
  }])
})

test("filesystem bootstrap resolves natively before loading by path, with no filesystem or byte bootstrap calls", async () => {
  const order = []
  const runtime = {
    async resolveFile(source) { order.push(["resolve", source]); return "/native/plugin.fs.wasm" },
    async addPlugins(paths) { order.push(["load", paths]) },
  }
  const units = createProjectUnits(runtime)
  const source = "https://example.com/plugin.fs.wasm"
  assert.equal(await units.bootstrapFilesystem(source), "/native/plugin.fs.wasm")
  assert.deepEqual(order, [["resolve", source], ["load", ["/native/plugin.fs.wasm"]]])
  await assert.rejects(units.bootstrapFilesystem("https://example.com/fs.zip#plugin.fs.wasm"), /not ZIP/)
  assert.equal(order.length, 2)
})

test("resolution and selected filesystem load failures propagate without fallback; a later call can retry", async () => {
  let attempts = 0
  let loads = 0
  const source = "https://example.com/plugin.fs.wasm"
  const runtime = {
    async resolveFile(selected) {
      assert.equal(selected, source)
      if (++attempts === 1) throw new Error("offline")
      return "/native/plugin.fs.wasm"
    },
    async addPlugins() { loads++; throw new Error("invalid component") },
  }
  const units = createProjectUnits(runtime)
  await assert.rejects(units.bootstrapFilesystem(source), /offline/)
  assert.equal(loads, 0)
  await assert.rejects(units.bootstrapFilesystem(source), /invalid component/)
  assert.equal(attempts, 2)
  assert.equal(loads, 1)
})

test("all Unit adapters delegate requests to the shared native resolver without a JS cache", async () => {
  const calls = []
  const runtime = { async resolveFile(source) { calls.push(source); return "/native/unit.js" } }
  const first = createProjectUnits(runtime)
  const second = createProjectUnits(runtime)
  const source = "https://example.com/unit.zip#view.js"
  assert.deepEqual(await Promise.all([first.resolve(source), first.resolve(source), second.resolve(source)]), Array(3).fill("/native/unit.js"))
  assert.equal(calls.length, 3, "native owns deduplication, not individual JS adapters")
  await first.resolve(source)
  assert.equal(calls.length, 4, "native checks completed installations")
})

test("invalid legacy sources fail before reaching native resolution", async () => {
  const units = createProjectUnits({ resolveFile() { throw new Error("must not resolve invalid source") } })
  for (const source of [null, 12, "", "https://example.com/unit.zip", "https://example.com/unit.zip#../view.js", "https://example.com/unit.zip#%2Fview.js", "https://example.com/unit.zip#views%5Cview.js", "https://example.com/view.js#view.js", "https://user:pass@example.com/view.js", "https://example.com/unit.tar#view.js", "github:owner/repo#ref=v1"])
    await assert.rejects(units.resolve(source), /source|selector|Unsafe|credentials|Unsupported/)
})

test("native snapshot replay maps resource phases and units, deduplicates unchanged rows, and unsubscribes", async () => {
  const resource = "https://example.com/unit.zip"
  const config = { resource: "gams.json", phase: "ready", completed: 1, total: 1, unit: null, cached: false }
  let send
  let stopped = 0
  const runtime = {
    subscribeResolutionProgress(listener) {
      send = listener
      listener({ operationId: 1, status: "resolving", discovered: 1, completed: 1, resources: [config], error: null })
      return () => { stopped++ }
    },
  }
  const units = createProjectUnits(runtime)
  const events = []
  const unsubscribe = units.subscribeProgress(event => events.push(event))
  assert.deepEqual(events, [{ source: "gams.json", phase: "ready", cached: false }])
  const update = event => send({ operationId: 2, status: "resolving", discovered: 2, completed: 1, resources: [config, { resource, cached: false, ...event }], error: null })
  update({ phase: "resolving", completed: 0, total: null, unit: null })
  update({ phase: "checking-cache", completed: 0, total: null, unit: null })
  update({ phase: "downloading", completed: 12, total: null, unit: "bytes" })
  update({ phase: "extracting", completed: 2, total: 5, unit: "entries", entry: "views/view.js" })
  update({ phase: "ready", completed: 1, total: 1, unit: null, cached: true })
  update({ phase: "ready", completed: 1, total: 1, unit: null, cached: true })
  assert.deepEqual(events.map(event => event.phase), ["ready", "checking", "checking", "downloading", "extracting", "ready"])
  assert.deepEqual(events[3], { source: resource, phase: "downloading", downloaded: 12, total: null, cached: false })
  assert.deepEqual(events[4], { source: resource, phase: "extracting", completed: 2, total: 5, entry: "views/view.js", cached: false })
  assert.deepEqual(events[5], { source: resource, phase: "ready", cached: true })
  assert.equal(events.filter(event => event.source === "gams.json").length, 1)
  unsubscribe()
  send({ resources: [{ ...config, phase: "checking-cache" }] })
  assert.equal(events.length, 6)
  assert.equal(stopped, 1)
  assert.throws(() => units.subscribeProgress(null), /must be a function/)
})

test("legacy per-call callbacks receive only matching download-byte progress, not snapshots or other resources", async () => {
  const source = "https://example.com/unit.zip#views%2Fview.js"
  const resource = "https://example.com/unit.zip"
  const runtime = {
    async resolveFile(selected, progress) {
      assert.deepEqual(selected, { url: resource, entry: "views/view.js" })
      const downloading = { resource: `${resource}#views/view.js`, phase: "downloading", completed: 12, total: 20, unit: "bytes", cached: false }
      progress({ resources: [{ ...downloading, resource: "other.js" }] })
      progress({ resources: [downloading] })
      progress({ resources: [downloading] })
      progress({ resources: [{ ...downloading, phase: "extracting", completed: 1, total: 2, unit: "entries" }] })
      progress({ resources: [{ ...downloading, phase: "ready" }] })
      return "/native/view.js"
    },
  }
  const events = []
  await createProjectUnits(runtime).resolve(source, event => events.push(event))
  assert.deepEqual(events, [{ downloaded: 12, total: 20 }])
})

test("filesystem bootstrap preserves native cached status and reports loaded only after addPlugins", async () => {
  const source = "https://example.com/plugin.fs.wasm"
  let snapshotListener
  let loaded = false
  const events = []
  const runtime = {
    subscribeResolutionProgress(listener) { snapshotListener = listener; return () => {} },
    async resolveFile(selected, progress) {
      const snapshot = { resources: [{ resource: selected, phase: "ready", completed: 1, total: 1, unit: null, cached: true }] }
      snapshotListener(snapshot)
      progress(snapshot)
      return "/native/plugin.fs.wasm"
    },
    async addPlugins() { assert.equal(events.at(-1).phase, "loading"); loaded = true },
  }
  const units = createProjectUnits(runtime)
  units.subscribeProgress(event => events.push({ ...event, loaded }))
  await units.bootstrapFilesystem(source)
  assert.deepEqual(events.at(-1), { source, phase: "ready", cached: true, loaded: true })
})
