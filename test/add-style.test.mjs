import test from "node:test"
import assert from "node:assert/strict"
import { ensureThemeStylesheetLink } from "../cmd/app/src/util/add-style.js"

function link(href = null) {
    const attrs = new Map()
    if (href !== null) attrs.set("href", href)
    return {
        getAttribute(key) { return attrs.get(key) ?? null },
        setAttribute(key, value) { attrs.set(key, value) },
        removeAttribute(key) { attrs.delete(key) },
        cloneNode() { return link(this.getAttribute("href")) },
    }
}

test("shadow theme links support no theme, adoption and removal", t => {
    const source = link()
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document")
    globalThis.document = { getElementById() { return source } }
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, "document", previous)
        else delete globalThis.document
    })
    let target
    const root = {
        querySelector(selector) { return selector === 'link[data-theme-stylesheet]' ? target : null },
        prepend(value) { target = value },
    }
    assert.equal(ensureThemeStylesheetLink(root).getAttribute("href"), null)
    source.setAttribute("href", "blob:theme")
    assert.equal(ensureThemeStylesheetLink(root).getAttribute("href"), "blob:theme")
    source.removeAttribute("href")
    assert.equal(ensureThemeStylesheetLink(root).getAttribute("href"), null)
})
