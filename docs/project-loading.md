# Project startup progress

The Host displays an **Opening Project** screen before awaiting `runtime.ready`.
It needs no Project theme, View or UI Service. Its Shadow DOM and Host stylesheet
keep it readable while the Project theme loads.

The overall bar represents startup stages, not a byte-weighted percentage or
remaining-time estimate: configuration, FS bootstrap, plugins, and Project UI.
Each requested source gets its own row, so parallel downloads are not collapsed
into a misleading single current filename. Active rows appear above completed
rows. Source labels show the asset filename and ZIP selector, without URL query
parameters. No new preload of unused Views is introduced.

Rows report cache checks, download bytes (indeterminate when the size is unknown),
ZIP member path/count, installation publication and bootstrap component loading.
`Ready` means the source has been prepared, not that the corresponding View has
finished initialization. Cached sources are marked explicitly. The prepared-Unit
count covers unique requested sources, not all configured but unused Views.

The screen is removed only after awaited UI initialization and Save-menu enabling
succeed. Startup failures are logged under `[project.open]`, retained on screen,
and offer **Reload Project**. Failed startup does not expose the ready debug
runtime or start the FPS overlay. Reload restarts initialization; this is not an
in-place transaction rollback, partial-cache cleanup, or download cancellation.

## Progress boundary

`createProjectUnits(runtime).subscribeProgress(listener)` returns an unsubscribe
function. Events are `{ source, phase, ...details }`; phases are `checking`,
`downloading`, `extracting`, `saving`, `loading`, and `ready`.

- Download details retain `{ downloaded, total }`, with unknown `total: null`.
- Extraction details are `{ entry, completed, total }`, counted before processing
  and after persisting each member (including explicit directories).
- Ready events contain `cached`.

The existing per-call `resolve(source, onProgress)`/bootstrap callback still
receives download-byte events only. Subscribers observe new preparation work;
there is no historical-event replay for already settled in-process requests.
The app subscribes before startup and unsubscribes on both success and failure.
Lazy source loading after startup does not reopen this screen.

Checks: `nix develop --command make app-test`. Node tests exercise real installer
progress plus a small DOM boundary double. The screen's normal, indeterminate,
error/reload and removal states were checked in a standalone Chrome preview;
that is not a full Tauri WebView startup smoke test.
