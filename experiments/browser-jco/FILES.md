# Real Files View over OPFS

The unchanged released `view.files` v1.0.1 now uses the unchanged `plugin.fs` v0.2.3 component through the browser worker and OPFS. This is a fixed experimental Host shell, not the full GAMS browser application.

## Run

From the GAMS repository root:

```sh
nix develop --command make -C experiments/browser-jco serve
# Open http://127.0.0.1:8093/files.html
```

Click **Open Files View — grant persistent /project**. Before this action, the page creates no component worker and grants no filesystem capability. Jco initialization, component transpilation and instantiation all happen in the browser after the click.

Use the actual View's **New** popup to create a file, a trailing-slash folder, or a nested path such as `example/hello.txt`. The toolbar also provides upload/download, reload, metadata inspection and confirmed recursive deletion. **Edit** opens the released fallback metadata View; no text editor is installed.

**Checkpoint and close** stops the guest and awaits OPFS disposal before terminating the worker; reopening requires another explicit grant. A failed close retains the worker. **Force stop** can lose or partially persist in-flight changes and requires a page reload before reopening. Finish operations before navigating away or reloading.

## Actual execution path

```text
Released view-files / files-rename / files-default
  → canonical Host /core/runtime.js and /util helpers
  → experimental browser transport at /core/runtime/native.js
  → worker invoke-filesystem operation
  → real gams:fs/fs@1.2.0 component exports
  → granted WASI filesystem descriptors/preopens
  → isolated OPFS memory-mirror adapter + awaited checkpoint
```

The canonical Runtime and selected helpers/CSS/font are copied byte-for-byte from this GAMS checkout into disposable build output. Only the platform transport module at the Runtime's existing import boundary is supplied by the experiment. No `__TAURI__` global or fake filesystem implementation is injected. The browser transport implements the fixed experimental project declaration, event-listener/readiness handshake and filesystem invocation. Other native commands reject explicitly; it does not implement Project loading/saving, installation, arbitrary plugins, native RPC or component-to-View callbacks. The loaded filesystem component has no such callback imports.

Real released `ui-service.context`, `ui-service.popup` and `ui-service.toast` provide focus context, popup workflows and delete confirmations. The released layout Unit supplies its real `view-area` element and header slots; its unrelated BSP engine is not started. The released The98 theme and original Host CSS/Material Symbols font provide styling. The shell mounts the real elements; it does not reimplement their internal UI. Keys/tooltip services and the complete desktop bootstrap are not included.

The small fixed registry assigns the real View config before connection and supplies the real popup service with its three View entries. Source modules load with native ES imports from static URLs, not the desktop `require()`/Project installation path. `browser-files.json` is the transport's in-memory experimental declaration, not a saved Project file; `/units` identifies the statically served Unit assets.

## Host boundary details

`runtime.invoke('fs/fs::<method>', ...args)` keeps the Host's positional argument and WIT result contract. The worker allowlists the ten filesystem methods only, maps kebab-case operation names to Jco's camelCase methods, and converts write byte lists into `Uint8Array`. Real View paths are Project-relative: `.` or `/` maps to the granted `/project`, and other paths map beneath it. Parent/dot/empty segments, backslashes and NUL are rejected rather than normalized away.

Only Jco-declared WIT result errors become `{ err: string }`; successful calls become `{ ok: value }`, with empty success represented by `null`. Traps, invalid calls, worker failures and failed persistence checkpoints reject. Byte results become ordinary arrays. Safe `u64` values become numbers; larger values use decimal strings rather than losing precision. The canonical Host `unwrap()` and real View error handling consume these responses unchanged.

The data store is the same dedicated `gams-browser-jco-experiment-v1` origin-private directory as the component experiment. Static JS/theme assets remain separate from OPFS user data. Only one instance is supported. There are no Host writer locks; opening another instance can lose data. This remains whole-tree memory-mirror persistence, not direct synchronous disk I/O; see [OPFS limits](README.md#persistent-opfs-mode).

## Reproducible assets and tests

[`cmd/web/view-assets.json`](../../cmd/web/view-assets.json) records the exact release tags, archives and SHA-256 pins, including a pin for each published `SHA256SUMS`. Build verifies both the checksum document and archive, then safely extracts each complete archive beneath `build.nosync/browser-jco/site/units/<repository>/`. The release JS is not patched or transpiled. Original LICENSE/NOTICE files remain alongside each Unit. The Host source/font and original notices are assembled separately. Neither sibling checkouts nor package installation are needed.

Real Chrome 145 on macOS, without Tauri or cross-origin isolation:

| Check | Result |
| --- | --- |
| **T1 — Browse** | Actual released View listed the OPFS root and expanded a directory through real plugin calls. |
| **T2 — Create** | Actual popup created `browser-view-check/hello.txt`, including its parent directory. |
| **T3 — Upload/download** | Actual View uploaded `[0,1,127,128,254,255]`; component reads, independent OPFS reads and downloaded bytes matched exactly. |
| **T4 — Metadata** | Released `files-default` popup displayed the real file name, path, type and size. |
| **T5 — Persistence** | Graceful close/reopen and page reload/regrant preserved the tree and file sizes. |
| **T6 — Delete** | Actual toast Cancel preserved the folder; Confirm recursively removed the test folder through the component. |
| **T7 — Errors** | Missing paths returned WIT `no-entry`; the reserved sidecar returned `not-permitted`; traversal rejected without writing. |
| **T8 — Failed import** | Temporarily withholding the View module reported the load failure, installed no managers/context listeners, and still allowed checkpointed close. |

At this milestone, native tests passed through the then-current `make -C experiments/browser-jco test`, covering argument/result conversion, boot/readiness, retained-worker failure/timeout behavior and graceful close. Today that command runs diagnostic Node tests only; shared `cmd/web/files-call.ts` conversion tests, production Runtime tests and static-server checks run through root `make test-web`. These mock-worker unit tests supplement, not replace, the real-View browser checks. `make clean` removes build/download output, not browser storage. Browser data tests create/delete only their own known fixture paths.

Other browsers, the internal rename flow, a file-content editor, picked folders and arbitrary GAMS Projects are not validated by this milestone. At that milestone, production Runtime and Unit source were unchanged; the isolated browser transport was the only new runtime implementation. The current production browser Host is documented separately in [`cmd/web/README.md`](../../cmd/web/README.md); this page describes the fixed diagnostic shell.
