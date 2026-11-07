import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))

// This fixture intercepts the POSIX shell launcher with an executable shebang.
// Native Project/config behavior remains covered by Cargo tests on Windows.
test("make run leaves Project selection to the Host or resolves an explicit Project before changing directory", {
  skip: process.platform === "win32" ? "POSIX launcher fixture uses an executable shebang and PATH" : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "gams-run-"))
  const project = join(directory, "Project with spaces")
  const bin = join(directory, "bin")
  await mkdir(project)
  await mkdir(bin)
  await writeFile(join(project, "gams.json"), "{}")
  await writeFile(join(bin, "cargo"), `#!${process.execPath}\nconsole.log('LAUNCH:' + JSON.stringify({args: process.argv.slice(2), project: process.env.GAMS_APP_CWD ?? null, cwd: process.cwd()}))\n`, { mode: 0o755 })
  function run(projectPath, configFile = "gams.json") {
    return spawnSync("make", ["-o", "app-icons", "run", "HOST_CC=cc", "HOST_CXX=c++", `GAMS_APP_CWD=${projectPath}`, `GAMS_CONFIG=${configFile}`], {
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
    assert.notEqual(run(project, "dev config.json").status, 0)
    await writeFile(join(project, "dev config.json"), "{}")
    assert.equal(launch(run(project, "dev config.json")).project, await realpath(project))
    for (const invalid of ["", ".", "..", "../gams.json", "dir/config.json", "dir\\config.json"])
      assert.notEqual(run(project, invalid).status, 0)
    const missing = run(join(directory, "missing"))
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /Project root with gams.json/)
    assert.doesNotMatch(missing.stdout, /^LAUNCH:/m)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("Rust process tests invalidate the native executable without breaking incremental builds", {
  skip: process.platform === "win32" ? "POSIX cargo interception fixture" : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "gams-repl-build-"))
  const output = join(directory, "output")
  const bin = join(directory, "bin")
  const log = join(directory, "cargo.log")
  const executable = join(output, "app/target/aarch64-apple-darwin/release/gams")
  await mkdir(bin)
  await mkdir(join(output, "app/icons"), { recursive: true })
  await writeFile(join(output, "app/icons/icon.icns"), "fixture")
  await writeFile(join(bin, "cargo"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args[0] + '\\n');
fs.mkdirSync(path.dirname(${JSON.stringify(executable)}), {recursive:true});
fs.writeFileSync(${JSON.stringify(executable)}, args[0] === 'test' ? 'test executable' : 'native executable');
if (args.includes('--fixture-failure')) process.exit(7);
`, { mode: 0o755 })
  function make(target, failure = false) {
    const result = spawnSync("make", ["-o", "app-icons", target,
      `BUILD_DIR=${output}`, `TAURI_TARGET_DIR=${join(output, "app/target")}`,
      `RUST_TEST_ARGS=${failure ? "--fixture-failure" : ""}`,
      "TARGET=aarch64-apple-darwin", "HOST_CC=cc", "HOST_CXX=c++"], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    })
    if (failure) assert.notEqual(result.status, 0)
    else assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  }
  try {
    make("build")
    assert.equal(await readFile(executable, "utf8"), "native executable")
    make("test-rust")
    assert.equal(await readFile(executable, "utf8"), "test executable")
    make("build")
    assert.equal(await readFile(executable, "utf8"), "native executable")
    make("build")
    make("test-rust", true)
    assert.equal(await readFile(executable, "utf8"), "test executable")
    make("build")
    assert.equal(await readFile(executable, "utf8"), "native executable")
    make("build")
    assert.equal(await readFile(log, "utf8"), "tauri\ntest\ntauri\ntest\ntauri\n")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
