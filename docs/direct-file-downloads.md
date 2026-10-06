# Direct-file Project Unit downloads

This implementation slice supports direct HTTPS files and loopback HTTP files
for testing. ZIP selectors are now supported by the separate
[first ZIP slice](zip-project-units.md), with a
[Host startup progress screen](project-loading.md). Git sources remain deferred. No lockfile, build scripts, or automatic transitive dependency loading.

## APIs and storage

After `await runtime.ready`:

- `runtime.download(url, onProgress)` returns a `Uint8Array`. Rust performs a
  binary GET with TLS verification, HTTP status checks, a 64 MiB bound, a
  120-second request timeout, and at most five redirects. Progress is
  `{ downloaded, total }`, with `total: null` when unknown. No CORS bypass or
  disabled WebView security is needed. HTTP is allowed only on loopback.
- `runtime.loadFromBytes(bytes, path)` compiles and loads ordinary WASM component
  bytes. The path is the component's identity/intended save location, not an
  instruction to write a file. Its parent must exist under a filesystem preopen.
  Persist the original bytes before requesting a path-based reload. Loading from
  bytes does not deserialize a compiled native cache; the existing path loader
  populates its compiled cache after persistence.
- `createProjectUnits(runtime)` in `/core/project-units.js` provides
  `resolve(source, onProgress)` and `bootstrapFilesystem(source, onProgress)`.
  Direct-file URLs map to `<runtime.modulesDir>/<sha256-of-url>.<extension>`.
  Writes go through the filesystem plugin to a temporary file, then rename to
  publish the complete download. Concurrent requests in one loader share work.
  Failed downloads can be retried. Interrupted writes may leave ignored `.tmp`
  files; cleanup and cross-process install locking are deferred.
- `require(source)` resolves/downloads a remote JS file, reads installed bytes
  through the filesystem plugin, then uses the existing JS import mechanism.
  JS relative-import/companion-asset resolution is not added by this slice.

`GAMS_MODULES_DIR` selects shared storage; otherwise storage is Project-local.
Cached files are reused without contacting the server. Changed content at an
unchanged URL is not detected automatically. This is a URL-keyed installation
cache, not a reproducible/content-authenticated package lock.

`app.js` keeps a temporary hardcoded `FS_BOOTSTRAP_SOURCE` (now the pinned release
`https://github.com/kkgams/plugin.fs/releases/download/v0.1.1/plugin.fs.wasm`).
The helper also accepts local paths: for a remote source it first tries
its cached path, then downloads and byte-loads FS on a miss, and persists FS
through its own filesystem API. No filesystem-less Project mode is implemented.
Only missing-path errors cause bootstrap download; other component load failures
remain errors.

Configured WASM plugin strings are resolved before loading. View/service JS
loads through `require` support direct-file URLs. Theme loading resolves `url`
(the old `path` still works during this incremental migration). The six shell UI Services now require explicit `url` entries under
`ui.services`: `ui-context`, `ui-keys`, `ui-layout`, `ui-toast`, `ui-popup`,
`ui-tooltip`. They load through `require`, including ZIP sources. There is no
silent fallback to the former local `ui-plugins` paths.

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
nix develop --command make app-test
```

## Release gate

Adding `reqwest` changes `Cargo.lock` and the native dependency graph. The
v2.0.4 appendix and NOTICE evidence have been regenerated; the owner approved
the exact bytes on 2026-10-04. See `http-license-review.md`. This development slice is
not release clearance; do not bypass candidate/notice/publication gates.
