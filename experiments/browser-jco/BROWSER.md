# Browser Host startup

`browser.html` boots the canonical GAMS `app.js`, Runtime, services bootstrap, utilities, widgets, styles and fonts against an experimental browser Host. The development server serves static files only and disables HTTP asset caching to avoid stale modules after rebuilds. This does not disable the separate OPFS Unit/Jco caches. Config resolution, downloads, ZIP extraction, Jco transpilation, plugin execution and persistence happen in a browser worker.

## Run

From the GAMS repository:

```sh
nix develop --command make -C experiments/browser-jco serve
# http://127.0.0.1:8093/browser.html
```

Open the bare `/browser.html` URL. GAMS starts automatically with the shared Project loading screen; there is no welcome page or Open button. If `/projects/default/gams.json` is missing, the browser imports the minimal Files Project from `/browser-default/`. Its FS/layout components and seven UI/View archives use explicit pinned GitHub release URLs and install directly into `gams_modules/`. First startup requires the configured download relay because direct GitHub browser downloads lack CORS permission. The only imported Project source file is `gams.json`; startup no longer creates `unit-sources/` or `plugins/` input folders. You can then upload files, download/edit/upload `gams.json`, or inspect `runtime` in DevTools. Existing configs—including invalid ones—are never replaced. Existing `unit-sources/` and `plugins/` folders are not removed or migrated.

Automatic first-run import applies only when `source`, `config`, `cwd` and `project-dir` are all omitted. Explicit selections still fail when missing. This default belongs to the browser experiment; Native startup and its root development config are unchanged.

For another Project, select an installed browser Project or explicitly supply an HTTP(S) Project directory using `source`. For a local static import, copy your Project's source files into `build.nosync/browser-jco/site/project/` after building, then open:

```text
http://127.0.0.1:8093/browser.html?source=/project/&project-dir=/projects/example&config=gams.json
```

The selected Project opens automatically. The source is an import location: missing config/resources and explicitly configured local Unit files are fetched into the browser filesystem. Existing files are not overwritten. It does not enumerate/mirror the entire HTTP directory; declare content through `$file`/archives or upload it through the Files View. Ordinary JS imports retain Native's existing Blob-import limitations.

On subsequent visits, omit `source` to reopen the persisted Project. Expand **Browser Host** for **Save Project**, **Checkpoint and close**, **Force stop**, and **Reload**. Close waits for guest shutdown and a storage checkpoint; a failed/timed-out close retains the worker and permits retry. Force stop can lose/partially persist changes. Reload is required to reopen a stopped session. Finish operations before closing/reloading; page unload cannot await persistence.

## Optional download relay

Start the independent `server.cors-proxy` checkout locally:

```sh
# In server.cors-proxy/
nix develop --command make serve
# http://127.0.0.1:8787/download
```

Then build/serve GAMS with its public relay endpoint:

```sh
# In gams/
GAMS_CORS_PROXY=http://127.0.0.1:8787/download \
  nix develop --command make -C experiments/browser-jco serve
```

`GAMS_CORS_PROXY` is a **build-time browser setting**, exported to `browser-environment.json`, not a shell environment read by Chrome. Rebuild when setting/changing/unsetting it. Unset or empty disables the relay. Use an absolute HTTPS endpoint, or loopback HTTP for development, without credentials/query/fragment. This public asset must not contain secrets. The startup options display the selected endpoint.

Configured cross-origin downloads use `endpoint?url=<encoded original URL>`. Same-origin bootstrap/assets remain direct. Original URLs still determine resource identity, relative references, progress labels, OPFS caches and saved `$file` expressions. Relay failure is an error, not a trigger for a second direct download. Existing OPFS caches can still be used when the relay is offline.

The relay has exact origin/host allowlists; its development defaults allow the normal GAMS origin on port 8093 and GitHub release infrastructure. For another GAMS port/domain, configure `CORS_PROXY_ALLOWED_ORIGINS` on the relay. Other resource hosts require `CORS_PROXY_ALLOWED_HOSTS`, including every redirect destination. Server-side caching, a `gams.json` proxy field and an automatic organization endpoint are not implemented. The relay is independently deployed; GAMS has no checkout dependency on that repository. Without a configured relay, direct resources must provide their own CORS permission; the default Project's fresh GitHub downloads will fail.

## URL settings

Names match applicable Native flags; there are no process environment variables in browser mode.

| Parameter | Meaning / default |
| --- | --- |
| `project-dir` or `cwd` | Virtual browser filesystem CWD; default `/projects/default`. Do not supply both. |
| `config` | Filename within that CWD; default `gams.json`. Paths/empty names fail. |
| `modules-dir` | Absolute virtual Unit-store path; default `<cwd>/gams_modules`. Can be outside CWD for shared storage. |
| `plugin-cache-dir` | Jco artifact-cache path; default `/cache/jco`. Relative values resolve from CWD. Must be separate from the modules store and must not contain the Project root. |
| `source` | HTTP(S) directory URL to import missing Project files. Relative URLs resolve against the page URL. Implicit default startup uses same-origin `/browser-default/`; explicit Project/config choices have no automatic source. |
| `fs` | Only `opfs` is implemented. Other values fail; there are no WebDAV/picked-folder stubs. |

Duplicate, empty and unknown settings fail explicitly. `cwd` is **not** an HTTP-server directory or unrestricted OS directory. Config, Unit storage and compiler cache remain distinct. URLs may need percent-encoding, especially spaces or embedded resource URLs.

## Host and filesystem boundaries

`BrowserStore` owns one mutable tree and an asynchronous persistence boundary. OPFS is selected at one creation point in `browser-worker.ts`; the tree/persistence callback and narrow read/write/mkdir/stat/list/remove/rename API are independent of config resolution and downloads. A future storage backend can replace this layer without changing Views. No alternative backend is implemented now.

The isolated OPFS namespace is `gams-browser-host-v1`, separate from the older fixed Files/component experiment. Config loading and Unit installation do not depend on a filesystem plugin. After preparation, all explicitly configured components load once. The real filesystem provider reads JS/theme bytes and performs Project Save through WASI. Host operations and WASI descriptors reference the **same tree**, so downloads made after plugin startup are immediately visible without re-instantiation. `/project` maps CWD; `gams_modules` aliases the selected modules directory even when outside CWD.

No Host writer locks or lock files are used. **One user / one instance only.** Concurrent instances/external writers are unsupported and can lose data when whole-tree checkpoints reconcile stale snapshots. Memory scales with all data in this namespace; checkpoints are not transactions or physical-media fsync. Quota, browser eviction and clearing site data still apply. Symlink persistence and prototype-sensitive path segments are unsupported. `make clean` deletes build output, not browser data.

## Resources and caches

The loader supports recursive `$ref`/`$file`, document-relative resources, JSON Pointer, cycle detection, direct downloads, complete ZIP extraction and the selected config filename. Bare remote Unit URLs remain invalid; use `$file` as in Native. Completed URL-based resource entries reuse persisted files without network access; unchanged URLs do not refresh automatically. Full archives retain companion assets and original LICENSE/NOTICE files. CRC, unsafe paths, symlinks, encryption, conflicting paths and extraction/download bounds are checked. No downloaded build/install scripts execute.

Project Save runs the shared ordered save hooks, restores unchanged `$ref`/`$file` expressions, flattens edited referenced data and publishes the selected config through the real FS component. Browser menu construction replaces the extracted menu platform module; Native retains its Tauri menu behavior. Shared `app.js`, `core/runtime.js`, `___/services.js` and Unit code are not rewritten.

Jco caches generated JS, core Wasm, export/import metadata and integrity hashes keyed by component bytes plus pinned Jco/backend/shim versions and generation options. Artifacts checkpoint before a completion marker is published. A valid cache hit skips Jco initialization/transpilation; the browser still compiles/instantiates core Wasm using its own engine. This is not Wasmtime executable serialization. A completed but corrupt cache fails explicitly; `runtime.clearCompiledComponentCache()` clears recognized generated entries within the selected compiler cache, not unrelated files, loaded instances or source Units.

## Current compatibility limits

- **R7 — CORS:** Direct downloads use ordinary browser Fetch and require upstream CORS permission. Direct GitHub Release fetch was blocked in Chrome; use the explicit optional relay or a same-origin/CORS-enabled mirror. There is no hidden fallback or GitHub-specific URL rewrite. The relay checks every redirect; direct browser Fetch cannot reproduce Native's intermediate-redirect inspection/five-hop policy.
- **R8 — Plugin ABI:** Host adapters currently cover `gams:fs/fs@1.2.0`, `gams:layout/layout@1.0.0` and the tested random interfaces. Layout field names/options and filesystem byte/result shapes preserve the Native JSON boundary. Arbitrary WIT schemas, opaque resources, component-to-component linking and component-to-View imports are not implemented; missing imports/unknown ABIs reject rather than pretending compatibility.
- **R9 — Execution scope:** Components are singleton instances in one worker; its commands are ordered. This milestone does not implement worker-per-plugin concurrency, Native shell/process execution, native IPC, picked folders, WebDAV or full GAMS command parity.

## Verified

Real Chrome 145 on macOS, using unchanged checksum-verified releases served from an explicit static mirror:

| Check | Result |
| --- | --- |
| **B1 — Canonical boot** | Selected `gams.alt.json`, nested `ui.json` `$ref`, FS/layout plugins, six UI Services, real Files View and The98 theme initialized through canonical `app.js`. |
| **B2 — Separate paths** | CWD `/projects/host-check`, modules `/shared/host-check-units`, compiler cache `/cache/host-check-jco`; real FS read installed JS/theme via the modules alias. |
| **B3 — Durable data** | Actual create popup created a nested file; binary bytes `[0,127,128,255]` survived checkpointed close and page reload. Actual confirmed recursive delete removed only that test folder. |
| **B4 — Cached boot** | With static Project/resource sources unavailable, the persisted Project reopened; diagnostics reported two cache hits and zero retranspilations. |
| **B5 — Live install** | `runtime.resolveFile()` installed a new resource after plugins started; the existing FS instance immediately read its bytes. `runtime.download()` reported byte progress. |
| **B6 — Save** | Direct shared Save and the browser Save button succeeded; the selected file retained original `$file` URLs and its unchanged `$ref` expression. |
| **B7 — Startup failure** | Selecting missing config failed visibly without falling back; checkpointed close still succeeded before components existed. |
| **B8 — Local Unit import** | A configured bare local FS component path imported from the explicit HTTP Project folder and loaded alongside cached Units. |
| **B9 — First-run Files Project** | With the earlier bootstrap mirror, a fresh origin with no OPFS namespace booted from bare `/browser.html`, with no console errors or cross-origin startup requests. Actual Files View upload worked. An edited config and uploaded file survived reopening with the bootstrap source unavailable; two Jco cache hits and zero retranspilations. A rejected remote GitHub download did not disable Files operations. |
| **B10 — Optional relay** | Direct Chrome GitHub fetch failed; `runtime.download()` through local relay returned the 55,491-byte FS component with its published SHA-256. Real Files View ZIP installation/extraction worked; cache metadata and Project Save retained its original GitHub URL. Reopening with the relay stopped reused the installed resource and both Jco caches. |
| **B11 — Direct default Unit installation** | A new Project downloaded two plugins and seven ZIPs from their published GitHub URLs into nine `gams_modules/` entries through the relay. Its root contained only `gams.json` and `gams_modules/`. Save retained original remote expressions. Binary data and reopening worked with the relay stopped: two Jco cache hits, zero retranspilations. An existing legacy config/folder layout reopened unchanged. |
| **B12 — Automatic startup** | A fresh Chrome origin loaded the real Files Project without clicking or granting storage. Save and binary persistence worked; reload automatically reopened with the relay stopped and two Jco cache hits. Invalid URL settings displayed the shared error/reload screen and disabled actions without a session. |

All 128 experiment Node tests and three static-server tests passed; the prior 113 existing Host JS tests remain unchanged. Native Node tests supplement these browser checks: storage coherence/failures, resolver/ZIP/cache/Save contracts, startup parsing, supported ABI conversion, transport lifecycle and worker shutdown retry. The existing Native JS tests cover the extracted menu's unchanged behavior; Native GUI was not relaunched for this milestone. Other browsers and unsupported plugin ABIs are not verified.
