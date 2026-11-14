---
title: "Direct-file Project Unit downloads"
status: reference
---

# Direct-file Project Unit downloads

The native Host resolves local and HTTPS resources for configuration and Project
Units. HTTP remains allowed only on loopback for testing. ZIP resources use the
same resolver; see [[zip-project-units|ZIP resources]]. Git sources remain
unsupported. No lockfile, downloaded build scripts or automatic transitive Unit
dependency loading is introduced.

## APIs and storage

After `await runtime.ready`, `runtime.config` already contains recursively
resolved `$ref` and `$file` values. Resolution and cache preparation happen
natively before Project Units load, without filesystem-plugin assistance.
See [[host-runtime|Host runtime and configuration]] for expression syntax.

| API | Behavior |
| --- | --- |
| `runtime.resolveFile(source, onProgress)` | Resolves a local/HTTPS string or `{ url, entry }` descriptor to a local path through the native resolver. A ZIP entry may select a file or directory; omitting it selects the archive root. |
| `runtime.download(url, onProgress)` | Returns a `Uint8Array` through native binary GET. Transport checks TLS and HTTP status, bounds downloads to 64 MiB and requests to 120 seconds, and allows at most five redirects. Progress is `{ downloaded, total }`, with unknown `total: null`. |
| `runtime.loadFromBytes(bytes, path)` | Compiles ordinary WASM component bytes. The path identifies the component but does not write its source; persist source before path-based reload. Downloaded bytes are not deserialized as trusted compiled caches. |
| `createProjectUnits(runtime)` | Adapts existing Unit URL strings to native resolution through `resolve(source, onProgress)` and `bootstrapFilesystem(source, onProgress)`. It no longer owns downloads, extraction or filesystem-backed cache writes. |
| `require(source)` | Resolves the source natively, reads the local JS through the filesystem plugin, then uses the existing JS import mechanism. Relative JS imports and companion asset URL resolution are unchanged. |

One native URL-keyed cache serves configuration and Unit requests. ZIP entry
selectors do not change the cache key. Local files remain in place. Remote
resources are fully prepared and atomically published before use; concurrent
requests share native resolution work. `GAMS_MODULES_DIR` selects shared storage;
otherwise storage is Project-local. Completed cached resources are reused without
contacting the server. Changed content at an unchanged URL is not detected
automatically, and no refresh feature is introduced. This is not a
content-authenticated package lock. Browser CORS bypasses or disabled WebView
security are unnecessary.

`app.js` selects the sole `plugins` source whose exact basename is
`plugin.fs.wasm` (URL pathname or local path). If absent, `FS_BOOTSTRAP_SOURCE`
falls back to
`https://github.com/kkgams/plugin.fs/releases/download/v0.1.1/plugin.fs.wasm`.
Multiple matches are errors, including repeated entries. Query strings do not
change basename matching. The adapter still rejects ZIP filesystem bootstrap;
this is a selection restriction, not a need for FS to perform extraction.
Invalid configuration and selected-source load/download failures never trigger
fallback. Native resolution prepares the selected file before FS loads; later
plugin loading resolves the same source to the same path. Export-based discovery
and a filesystem-less Project mode are not introduced.

Configured WASM plugin strings resolve before loading. View/service JS loads
through `require` support direct-file and legacy ZIP URLs. Theme loading resolves
`url` (legacy `path` still works). The six shell UI Services require explicit
`url` entries under `ui.services`: `ui-context`, `ui-keys`, `ui-layout`, `ui-toast`,
`ui-popup`, `ui-tooltip`. There is no silent fallback to local `ui-plugins` paths.

See [[project-loading|Project startup progress]] for native resolution snapshots
and the existing startup screen.

## Test a prebuilt filesystem Unit through a real static server

The Host tests do not build or vendor sibling Units. Supply a prebuilt filesystem
component explicitly. For example, build it independently:

```sh
cd ../plugin.fs
nix develop --command make build
cd ../gams
nix develop --command bash scripts/test-download-smoke.sh \
  "$PWD/../plugin.fs/dist/plugin.fs.wasm"
```

The script copies that external artifact plus a Host-owned JS transport fixture
into a temporary directory, starts a loopback static server on an ephemeral
port, runs the JS tests and the explicit native smoke test, then stops the server
and removes staging files. It does not change `gams.json` or package Units into
the Host distribution.

The native smoke test downloads real FS WASM using the Rust HTTP client, loads
it from memory, saves its source and downloaded JS through WASI filesystem calls,
reloads FS by path, and checks another runtime can read persisted JS without
network access. The JS tests exercise direct-file download, JS module loading,
first-run bootstrap orchestration, retry, request deduplication, and offline reuse.
JS tests substitute the native IPC/filesystem boundary; the smoke test covers the
real native implementation. This is not yet a full Tauri-window startup test.

For manual serving of a directory of prebuilt Units:

```sh
python3 scripts/serve-project-units.py /absolute/path/to/prebuilt-units --port 8765
```

The server intentionally sends no CORS headers. Use `runtime.download`, not
browser `fetch`, to access it from the Tauri frontend.

Regular Host checks remain independent of sibling repositories:

```sh
nix develop --command make test
```
