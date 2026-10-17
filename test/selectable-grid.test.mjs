import test from "node:test"
import assert from "node:assert/strict"
import { gridNavigationTarget as move } from "../cmd/app/src/util/selectable-grid.js"

const rows = [[null, "one"], ["two", "three"], ["four"]]

test("horizontal navigation skips disabled positions and does not wrap", () => {
    assert.equal(move(rows, "one", "ArrowLeft"), "one")
    assert.equal(move(rows, "two", "ArrowRight"), "three")
    assert.equal(move(rows, "three", "ArrowLeft"), "two")
    assert.equal(move(rows, "three", "ArrowRight"), "three")
})

test("vertical navigation preserves the nearest enabled column in irregular rows", () => {
    assert.equal(move(rows, "one", "ArrowDown"), "three")
    assert.equal(move(rows, "three", "ArrowDown"), "four")
    assert.equal(move(rows, "two", "ArrowUp"), "one")
    assert.equal(move(rows, "one", "ArrowUp"), "one")
    assert.equal(move(rows, "four", "ArrowDown"), "four")
    assert.equal(move([["a"], [null, null], [], ["b"]], "a", "ArrowDown"), "b")
    assert.equal(move([["a"], [null], ["b"]], "b", "ArrowUp"), "a")
})

test("Home/End use the row; modified Home/End use the whole grid", () => {
    assert.equal(move(rows, "three", "Home"), "two")
    assert.equal(move(rows, "two", "End"), "three")
    assert.equal(move(rows, "three", "Home", true), "one")
    assert.equal(move(rows, "two", "End", true), "four")
})

test("invalid current records fail explicitly and unhandled keys do not navigate", () => {
    assert.throws(() => move(rows, null, "Home"), /current cell/)
    assert.throws(() => move(rows, "missing", "Home"), /current cell/)
    assert.equal(move(rows, "one", "Tab"), "one")
})
