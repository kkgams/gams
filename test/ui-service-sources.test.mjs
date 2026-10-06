import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { BOOTSTRAP_UI_SERVICE_IDS, getUiServiceSources } from "../cmd/app/src/core/ui-service-sources.js"

function config() {
  return { ui: { services: Object.fromEntries(BOOTSTRAP_UI_SERVICE_IDS.map(id => [id, {
    url: `https://example.com/${id}.zip#ui-plugins/${id}.js`,
  }])) } }
}

test("bootstrap service sources come from Project config in the required module order", () => {
  const project = config()
  assert.deepEqual(getUiServiceSources(project), BOOTSTRAP_UI_SERVICE_IDS.map(id => project.ui.services[id].url))
  project.ui.services["ui-context"].url = "custom/context.js"
  assert.equal(getUiServiceSources(project)[0], "custom/context.js")
})

test("missing or malformed required service sources fail explicitly without local fallback", () => {
  for (const ui of [undefined, null, []]) assert.throws(() => getUiServiceSources({ ui }), /ui must be an object/)
  for (const services of [undefined, null, []]) assert.throws(() => getUiServiceSources({ ui: { services } }), /ui.services must be an object/)
  for (const id of BOOTSTRAP_UI_SERVICE_IDS) {
    for (const entry of [undefined, [], {}, { url: "" }, { url: " " }, { url: 12 }]) {
      const project = config()
      project.ui.services[id] = entry
      assert.throws(() => getUiServiceSources(project), error => error.message.includes(`ui.services.${id}.url is required`))
    }
  }
})

test("Host UI bootstrap consumes configured sources instead of hardcoded Unit paths", async () => {
  const source = await readFile(new URL("../cmd/app/src/___/services.js", import.meta.url), "utf8")
  assert.match(source, /getUiServiceSources\(config\)\.map\(source => require\(source\)\)/)
  assert.doesNotMatch(source, /require\("ui-plugins\//)
})

test("filesystem bootstrap uses an explicit pinned release rather than Project-local assembly", async () => {
  const source = await readFile(new URL("../cmd/app/src/app.js", import.meta.url), "utf8")
  assert.match(source, /const FS_BOOTSTRAP_SOURCE = "https:\/\/github.com\/kkgams\/plugin.fs\/releases\/download\/v0.1.1\/plugin.fs.wasm"/)
  assert.doesNotMatch(source, /const FS_BOOTSTRAP_SOURCE = "plugins\//)
})
