# Project startup progress

The Host displays an **Opening Project** screen before awaiting `runtime.ready`.
It needs no Project theme, View or UI Service to render. It uses light DOM and
the guide's `blockquote` card/window, `fieldset`/`legend`, `output`, intent classes
and native `progress` vocabulary. The selected **A — Dialog queue** design keeps
Unit details in a scrollable queue and the prepared count, errors and reload
action in a footer **inside** the dialog. The throwaway design preview was removed.

`/css/base.css` supplies themeless card/progress fallbacks under `@layer base`.
The existing Project stylesheet automatically replaces their appearance via
`@layer theme`; no particular theme is bundled or used as a hidden fallback.
Host-scoped rules only provide positioning/layout, visibility and readable
error/action layout. The separate hard-coded `startup.css` is no longer used.

The overall bar represents startup stages, not a byte-weighted percentage or
remaining-time estimate: configuration, FS bootstrap, theme/plugins, and Project
UI. Every progress bar uses `max="1"` and a ratio, or omits `value` for unknown
progress. Completed Unit bars are hidden, but cached/prepared details stay visible.
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

## Early Project theme preparation

After FS bootstrap, the app starts `prepareTheme(config)` alongside plugin
preparation/loading and observes both promises immediately. The theme becomes
visible as soon as its stylesheet loads; it does not wait for other plugins or
UI Services. UI initialization waits for both tasks and reuses the same theme
promise, without a second theme download/read/application. Direct `init(config)`
callers retain default theme preparation.

`core/project-theme.js` resolves the Project's required `ui.theme.url` (or legacy
local `path`), reads CSS through the filesystem plugin, and installs a blob URL
on the required Host theme link. Listeners are installed before href assignment;
CSS `load`, not href assignment, completes preparation. A failed stylesheet load
restores the prior link, releases the failed blob, and fails startup visibly.
Successfully replaced theme blobs are released by the services bootstrap. Existing
View/Popup shadow links continue to receive the applied theme href. No new
relative CSS-asset resolver or theme-source fallback is introduced.

If another parallel task fails, later theme/plugin work is still observed (no
unhandled parallel rejection), but startup does not proceed to UI initialization.
The visible failure snapshot stops updating and hides progress bars. This is not
cancellation of the remaining work.

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
progress plus a small DOM boundary double, stylesheet load/error and resource
cleanup, and the actual app bootstrap with deferred boundary dependencies. Checks
cover FS-first concurrency, both parallel failure orders, theme-promise reuse and
waiting for layout/menu completion. The production renderer and loader were also
checked in a standalone Chrome fixture: themeless → external The98 adoption,
preserved ratios, indeterminate bars, hidden completed bars, in-dialog footer,
readable full errors, reload and removal. That is not a full Tauri WebView startup
smoke test.

## Browser style regression check

The themeless card needs an inset frame: the enclosing scrollable article clips
an outer shadow. Base `output` is block-level so status spacing does not depend
on a theme. Both were missing from the initial fallback implementation.

From the workspace root, run:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Open `/gams/test/fixtures/startup-style.html` on that localhost server. The fixture
uses the production renderer and actual base CSS, checks visible frame structure,
block-level status layout and footer placement, and exposes
`window.startupStyleResult`. Add
`?theme=/theme.the98/src/themes/the98.css` to check theme adoption and preserved
ratios against the external theme, without copying it into the Host. Disable
browser cache while iterating on CSS. Stop the test server with Ctrl+C.
This is a browser-rendered regression check, not part of the Node/Rust test run.
