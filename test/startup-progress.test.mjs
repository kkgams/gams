import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createStartupProgress, unitProgress } from "../cmd/app/src/core/startup-progress.js"

// Minimal DOM boundary; visual rendering is checked separately in a browser.
function element() {
  return {
    children: [], attributes: {}, selectors: new Map(), hidden: false,
    classList: { toggle() {} },
    appendChild(child) { this.children.push(child) },
    querySelector(selector) {
      if (!this.selectors.has(selector)) this.selectors.set(selector, element())
      return this.selectors.get(selector)
    },
    attachShadow() { this.shadowRoot = element(); return this.shadowRoot },
    setAttribute(name, value) { this.attributes[name] = value },
    removeAttribute(name) { delete this.attributes[name] },
    addEventListener(name, listener) { this[name] = listener },
    remove() { this.removed = true },
  }
}

test("known download lengths are determinate; unknown lengths remain indeterminate", () => {
  assert.deepEqual(unitProgress({ phase: "downloading", downloaded: 1024, total: 2048 }), {
    text: "Downloading 1.0 KiB / 2.0 KiB", value: 1024, max: 2048,
  })
  for (const total of [null, 0]) assert.equal(unitProgress({ phase: "downloading", downloaded: 1024, total }).value, null)
  assert.match(unitProgress({ phase: "downloading", downloaded: 2097152, total: null }).text, /2.0 MiB/)
  assert.deepEqual(unitProgress({ phase: "extracting", entry: "views/view.js", completed: 2, total: 5 }), {
    text: "Extracting 2/5 · views/view.js", value: 2, max: 5,
  })
  assert.throws(() => unitProgress({ phase: "unknown" }), /Unknown startup/)
})

test("parallel sources keep separate rows and repeated events do not double-count prepared Units", () => {
  const document = { body: element(), createElement: () => element() }
  const screen = createStartupProgress(document, () => {})
  const root = document.body.children[0].shadowRoot
  const a = "https://example.com/view.zip#views/view.js"
  const b = "https://example.com/plugin.wasm"
  screen.update({ source: a, phase: "downloading", downloaded: 1024, total: 2048 })
  screen.update({ source: b, phase: "checking" })
  assert.equal(root.querySelector("ul").children.length, 2)
  const row = root.querySelector("ul").children[0]
  assert.equal(row.querySelector(".source").textContent, "view.zip → views/view.js")
  screen.update({ source: a, phase: "ready", cached: false })
  screen.update({ source: a, phase: "ready", cached: true })
  assert.equal(root.querySelector("#count").textContent, "1 Unit prepared")
  assert.equal(row.querySelector(".detail").textContent, "Ready · cached")
  screen.update({ source: b, phase: "downloading", downloaded: 0, total: null })
  assert.equal(root.querySelector("ul").children[1].querySelector("progress").attributes.value, undefined)
})

test("startup failures stay visible with reload, while successful startup removes the screen", () => {
  const document = { body: element(), createElement: () => element() }
  let reloaded = 0
  const screen = createStartupProgress(document, () => { reloaded++ })
  const host = document.body.children[0]
  const root = host.shadowRoot
  screen.phase("Loading Project interface", 3)
  assert.equal(root.querySelector("#overall").value, 3)
  screen.fail(new Error("download interrupted"))
  assert.equal(root.querySelector("#phase").textContent, "Project could not be opened")
  assert.equal(root.querySelector("#error").textContent, "download interrupted")
  assert.equal(root.querySelector("#error").hidden, false)
  assert.equal(root.querySelector("button").hidden, false)
  root.querySelector("button").click()
  assert.equal(reloaded, 1)
  assert.equal(host.removed, undefined)
  screen.finish()
  assert.equal(host.removed, true)
})

test("app subscribes before startup, cleans up both outcomes, and only exposes the ready runtime on success", async () => {
  const app = await readFile(new URL("../cmd/app/src/app.js", import.meta.url), "utf8")
  assert.ok(app.indexOf("subscribeProgress") < app.indexOf("await runtime.ready"))
  assert.match(app, /unsubscribeProgress\(\)[\s\S]*loading.finish\(\)/)
  assert.match(app, /unsubscribeProgress\(\)[\s\S]*loading.fail\(error\)/)
  assert.match(app, /if \(saveMenu\) \{/)
})
