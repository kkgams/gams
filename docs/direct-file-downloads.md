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
| `require(path)` | Accepts an already-local JS path, reads it through the configured filesystem provider, then uses the existing JS import mechanism. It does not resolve or download Unit sources. Relative JS imports and companion asset URL resolution are unchanged. |

`resolveFile`, `download` and `loadFromBytes` remain explicit low-level APIs;
they are not configured Unit loaders. Configuration resources use native
`$ref`/`$file` resolution, not a frontend installation adapter.

One native URL-keyed cache serves configuration resources, including Unit sources.
ZIP entry selectors do not change the cache key. Local files remain in place. Remote
resources are fully prepared and atomically published before use; concurrent
requests share native resolution work. `GAMS_MODULES_DIR` selects shared storage;
otherwise storage is Project-local. Completed cached resources are reused without
contacting the server. Changed content at an unchanged URL is not detected
automatically, and no refresh feature is introduced. This is not a
content-authenticated package lock. Browser CORS bypasses or disabled WebView
security are unnecessary.

## Configured Unit sources

Frontend loaders accept only already-local strings for WASM plugins and
View/UI Service/theme `url` fields. Project-relative guest paths still work;
use `$file` to normalize native OS paths, including Windows drive paths. Bare HTTP,
HTTPS and `file:` URLs fail with a use-`$file` error, including legacy ZIP
`URL#entry` sources. For a direct-file Unit, wrap the existing published pin:

```json
{
  "plugins": [
    { "$file": "https://github.com/kkgams/plugin.fs/releases/download/v0.2.0/plugin.fs.wasm" }
  ]
}
```

For archive entries use `$file` with `{ "url", "entry" }`; see
[[zip-project-units|ZIP resources]]. All configured WASM plugins load together
once before any theme or JS UI Service. The Project must explicitly configure
`plugin.fs` or a compatible filesystem provider; there is no pinned fallback,
filename-based selection or byte bootstrap. ZIP-contained filesystem components
are supported after native resolution. The provider reads JS/CSS and writes
Project Save files; native code owns config reads, downloads and extraction.

The six shell UI Services require explicit `url` entries under `ui.services`:
`ui-context`, `ui-keys`, `ui-layout`, `ui-toast`, `ui-popup`, `ui-tooltip`.
Their sources must likewise be local paths or `$file` expressions in the source
config. There is no silent fallback to local `ui-plugins` paths.

See [[project-loading|Project startup progress]] for native resolution snapshots
and the existing startup screen.

## Test a prebuilt filesystem Unit through a real static server

The Host tests do not build or vendor sibling Units. Supply a prebuilt filesystem
component explicitly; the Host does not build it. From this checkout:

```sh
nix develop --command bash scripts/test-download-smoke.sh \
  /absolute/path/to/prebuilt/plugin.fs.wasm
```

The script copies that external artifact plus a Host-owned JS transport fixture
into a temporary directory, starts a loopback static server on an ephemeral
port, runs the JS tests and explicit native smoke tests, then stops the server
and removes staging files. It does not change `gams.json` or package Units into
the Host distribution.

The transport smoke test exercises explicit low-level download/byte-loading APIs:
it downloads FS WASM, loads it from memory, persists its source and downloaded JS,
and reloads FS by path. A second test prepares configured `$file` FS and JS sources
before loading any plugin, loads the explicitly configured FS once, reads the JS
through shared `gams_modules/` paths, and checks another Project reuses the cache
without download events. JS tests substitute the native IPC/filesystem boundary;
these smoke tests cover the real native implementation. They do not establish
full Tauri-window startup, native progress-screen rendering, or Windows/Linux
smoke behavior.

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
