import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { extractZip, validateZipPath } from "../cmd/app/src/util/zip.js"

// Produced independently with Python's zipfile, not the library under test.
const fixtures = JSON.parse(await readFile(new URL("./fixtures/zip.json", import.meta.url), "utf8"))
const bytes = name => new Uint8Array(Buffer.from(fixtures[name], "base64"))

test("ZIP extraction preserves nested binary files, notices and empty directories", async () => {
  const entries = new Map()
  await extractZip(bytes("unit"), "views/view.js", async (path, data) => entries.set(path, data))
  assert.equal(new TextDecoder().decode(entries.get("views/view.js")), 'export const value = "zip fixture"')
  assert.deepEqual(entries.get("views/assets/data.bin"), new Uint8Array([0, 128, 255]))
  assert.equal(new TextDecoder().decode(entries.get("LICENSE")), "Host test fixture notice\n")
  assert.equal(entries.get("empty"), null)
})

test("ZIP extraction validates members and selected file before writing anything", async () => {
  let writes = 0
  const sink = async () => { writes++ }
  await assert.rejects(extractZip(bytes("unit"), "missing.js", sink), /ZIP entry not found/)
  await assert.rejects(extractZip(bytes("unit"), "empty/", sink), /Unsafe ZIP path/)
  await assert.rejects(extractZip(bytes("unsafe"), "views/view.js", sink), /[Uu]nsafe/)
  await assert.rejects(extractZip(new Uint8Array([1, 2, 3]), "view.js", sink))
  assert.equal(writes, 0)
})

test("ZIP member paths cannot escape or be silently normalized", () => {
  for (const path of ["", "/view.js", "../view.js", "a/../../view.js", "a/./view.js", "a//view.js", "C:/view.js", "a\\view.js", "nul\0.js"])
    assert.throws(() => validateZipPath(path), /Unsafe ZIP path/)
  assert.equal(validateZipPath("views/nested/view.js"), "views/nested/view.js")
})

test("ZIP extraction propagates sink failures", async () => {
  await assert.rejects(extractZip(bytes("unit"), "views/view.js", async () => {
    throw new Error("disk full")
  }), /disk full/)
})
