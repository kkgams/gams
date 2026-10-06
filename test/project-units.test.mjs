import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, rename, readdir, rm, mkdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "node:http"

const moduleUrl = new URL("../cmd/app/src/core/project-units.js", import.meta.url)
// Independent ZIP fixtures produced with Python's stdlib zipfile (DEFLATE).
const zipFixtures = JSON.parse(await readFile(new URL("./fixtures/zip.json", import.meta.url), "utf8"))
const zipBytes = () => new Uint8Array(Buffer.from(zipFixtures.unit, "base64"))

// Filesystem/IPC is an external boundary here; native smoke tests cover real WASI.
function filesystemRuntime(directory) {
  return {
    modulesDir: directory,
    async invoke(target, ...args) {
      let value
      switch (target) {
        case "fs/fs::list": value = (await readdir(args[0], { withFileTypes: true })).map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "regular-file" })); break
        case "fs/fs::stat": {
          const info = await stat(args[0])
          value = { type: info.isDirectory() ? "directory" : "regular-file" }
          break
        }
        case "fs/fs::create-dir": await mkdir(args[0]); break
        case "fs/fs::write-file": await writeFile(args[0], new Uint8Array(args[1])); break
        case "fs/fs::rename": await rename(...args); break
        default: throw new Error(`Unexpected call: ${target}`)
      }
      return { ok: value ?? null }
    },
  }
}

test("filesystem bootstrap loads bytes on first launch and uses its saved path next time", async () => {
  const { createProjectUnits } = await import(moduleUrl)
  const directory = await mkdtemp(join(tmpdir(), "gams-bootstrap-"))
  const bytes = new Uint8Array([0, 97, 115, 109, 13, 0, 1, 0])
  let downloads = 0
  let byteLoads = 0
  let filesystemReady = false
  const fsRuntime = filesystemRuntime(directory)
  const runtime = {
    ...fsRuntime,
    async addPlugins([path]) {
      try { await readFile(path) } catch (error) {
        if (error.code === "ENOENT") throw `absolute component path not found: ${path}`
        throw error
      }
      filesystemReady = true
    },
    async download() { downloads++; return bytes },
    async loadFromBytes(actual, path) {
      assert.deepEqual(actual, bytes)
      assert.equal(await readdir(directory).then(entries => entries.length), 0)
      assert.ok(path.startsWith(directory))
      filesystemReady = true
      byteLoads++
    },
    async invoke(...args) {
      assert.ok(filesystemReady, "no filesystem calls before FS bootstrap")
      return fsRuntime.invoke(...args)
    },
  }
  try {
    const source = "http://127.0.0.1:8765/fs.wasm"
    const path = await createProjectUnits(runtime).bootstrapFilesystem(source)
    assert.deepEqual(new Uint8Array(await readFile(path)), bytes)
    filesystemReady = false
    assert.equal(await createProjectUnits(runtime).bootstrapFilesystem(source), path)
    assert.equal(downloads, 1)
    assert.equal(byteLoads, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("failed downloads can be retried without publishing a partial Unit", async () => {
  const { createProjectUnits } = await import(moduleUrl)
  const directory = await mkdtemp(join(tmpdir(), "gams-retry-"))
  let attempts = 0
  const runtime = {
    ...filesystemRuntime(directory),
    async download() {
      if (++attempts === 1) throw new Error("connection interrupted")
      return new Uint8Array([1, 2, 3])
    },
  }
  try {
    const units = createProjectUnits(runtime)
    const source = "http://127.0.0.1:8765/unit.wasm"
    await assert.rejects(units.resolve(source), /connection interrupted/)
    assert.deepEqual(await readdir(directory), [])
    assert.ok(await units.resolve(source))
    assert.equal(attempts, 2)
    for (const unsupported of ["https://example.com/units.tar#view.js", "github:owner/repo#ref=v1"]) {
      await assert.rejects(units.resolve(unsupported), /not supported|Unsupported/)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("direct-file Units are downloaded, persisted once, and reused offline", async () => {
  const { createProjectUnits } = await import(moduleUrl)
  const directory = await mkdtemp(join(tmpdir(), "gams-units-"))
  let downloads = 0
  const server = createServer((_request, response) => {
    downloads++
    response.end('export const value = "downloaded"')
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${server.address().port}/view.js`
  const runtime = {
    ...filesystemRuntime(directory),
    async download(source) {
      const response = await fetch(source)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
  try {
    const units = createProjectUnits(runtime)
    const [path, duplicate] = await Promise.all([units.resolve(url), units.resolve(url)])
    assert.equal(path, duplicate)
    assert.equal(downloads, 1)
    assert.equal((await readdir(directory)).length, 1)
    await new Promise(resolve => server.close(resolve))
    // A new loader represents another launch, not just an in-memory cache hit.
    assert.equal(await createProjectUnits(runtime).resolve(url), path)
    assert.match(await readFile(path, "utf8"), /downloaded/)
    const view = await import(pathToFileURL(path))
    assert.equal(view.value, "downloaded")
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("ZIP Units download without a fragment, publish their package, and reopen offline", async () => {
  const { createProjectUnits } = await import(moduleUrl)
  const directory = await mkdtemp(join(tmpdir(), "gams-zip-units-"))
  const source = "http://127.0.0.1:8765/unit.zip#views%2Fview.js"
  let downloads = 0
  const runtime = {
    ...filesystemRuntime(directory),
    async download(url, progress) {
      assert.equal(url, "http://127.0.0.1:8765/unit.zip")
      progress({ downloaded: zipBytes().length, total: zipBytes().length })
      downloads++
      return zipBytes()
    },
  }
  try {
    const progress = []
    const path = await createProjectUnits(runtime).resolve(source, event => progress.push(event))
    assert.match(path, /\/views\/view\.js$/)
    const [name] = await readdir(directory)
    assert.match(name, /^[a-f0-9]{64}$/)
    assert.deepEqual(new Uint8Array(await readFile(join(directory, name, "views/assets/data.bin"))), new Uint8Array([0, 128, 255]))
    assert.match(await readFile(join(directory, name, "LICENSE"), "utf8"), /fixture notice/)
    assert.ok((await stat(join(directory, name, "empty"))).isDirectory())
    assert.equal(progress.length, 1)
    runtime.download = async () => { throw new Error("offline") }
    assert.equal(await createProjectUnits(runtime).resolve(source), path)
    assert.equal(downloads, 1)
    const view = await import(pathToFileURL(path))
    assert.equal(view.value, "zip fixture")
    await rm(path)
    await assert.rejects(createProjectUnits(runtime).resolve(source), /ZIP entry unavailable|ENOENT/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("failed ZIP writes leave only staging and can be retried", async () => {
  const { createProjectUnits } = await import(moduleUrl)
  const directory = await mkdtemp(join(tmpdir(), "gams-zip-retry-"))
  const filesystem = filesystemRuntime(directory)
  let fail = true
  let writes = 0
  const runtime = {
    ...filesystem,
    async download() { return zipBytes() },
    async invoke(target, ...args) {
      if (target === "fs/fs::write-file" && ++writes === 2 && fail) return { err: "disk full" }
      return filesystem.invoke(target, ...args)
    },
  }
  try {
    const source = "http://127.0.0.1:8765/unit.zip#views/view.js"
    const units = createProjectUnits(runtime)
    await assert.rejects(units.resolve(source), /disk full/)
    assert.ok((await readdir(directory)).every(name => name.endsWith(".tmp")))
    fail = false
    const path = await units.resolve(source)
    assert.match(await readFile(path, "utf8"), /zip fixture/)
    assert.equal((await readdir(directory)).filter(name => !name.endsWith(".tmp")).length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("invalid ZIP sources and archives fail without publishing an installation", async () => {
  const { createProjectUnits } = await import(moduleUrl)
  const directory = await mkdtemp(join(tmpdir(), "gams-zip-invalid-"))
  let downloaded = zipBytes()
  const runtime = { ...filesystemRuntime(directory), async download() { return downloaded } }
  try {
    const units = createProjectUnits(runtime)
    for (const source of ["https://example.com/unit.zip", "https://example.com/unit.zip#../view.js", "https://example.com/unit.zip#%2Fview.js", "https://example.com/view.js#view.js"])
      await assert.rejects(units.resolve(source), /selector|Unsafe|selectors/)
    await assert.rejects(units.resolve("https://example.com/unit.zip#missing.js"), /ZIP entry not found/)
    downloaded = new Uint8Array([1, 2, 3])
    await assert.rejects(units.resolve("https://example.com/unit.zip#views/view.js"))
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
