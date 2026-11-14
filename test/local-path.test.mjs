import test from "node:test"
import assert from "node:assert/strict"
import { validateLocalPath } from "../cmd/app/src/core/local-path.js"

test("prepared guest paths and ordinary relative paths are returned unchanged without filename selection", () => {
    for (const path of ["plugins/renamed-fs.wasm", "gams_modules/archive/plugins/plugin.fs.wasm", "./views/view.js", "../shared/view.js", "/local/view.js", "views/with space.js"])
        assert.equal(validateLocalPath(path), path)
})

test("unprepared resource sources fail with actionable $file guidance", () => {
    for (const source of [null, undefined, 1, {}, { $file: "view.js" }, "", " \t", "https://example.com/view.js", "https://example.com/unit.zip#views/view.js", "file:///view.js", "FILE:view.js", "data:text/javascript,test", "blob:uuid", "git:repo", " https://example.com/view.js"])
        assert.throws(() => validateLocalPath(source, "configured source"), /configured source.*local path.*\$file/)
})
