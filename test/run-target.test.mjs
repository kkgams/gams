import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))

test("make run uses the picker or resolves an explicit Project before changing directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gams-run-"))
  const project = join(directory, "Project with spaces")
  const bin = join(directory, "bin")
  await mkdir(project)
  await mkdir(bin)
  await writeFile(join(project, "gams.json"), "{}")
  await writeFile(join(bin, "cargo"), `#!${process.execPath}\nconsole.log('LAUNCH:' + JSON.stringify({args: process.argv.slice(2), project: process.env.GAMS_APP_CWD ?? null, cwd: process.cwd()}))\n`, { mode: 0o755 })
  function run(projectPath) {
    return spawnSync("make", ["-o", "app-icons", "run", "HOST_CC=cc", "HOST_CXX=c++", `GAMS_APP_CWD=${projectPath}`], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    })
  }
  function launch(result) {
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout.split("\n").find(line => line.startsWith("LAUNCH:")).slice(7))
  }
  try {
    assert.equal(launch(run("")).project, null)
    const explicit = launch(run(relative(root, project)))
    assert.deepEqual(explicit.args, ["tauri", "dev"])
    assert.equal(explicit.project, await realpath(project))
    assert.equal(explicit.cwd, join(root, "cmd/app/src-tauri"))
    const missing = run(join(directory, "missing"))
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /Project root with gams.json/)
    assert.doesNotMatch(missing.stdout, /^LAUNCH:/m)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
