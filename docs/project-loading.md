---
title: "Project startup progress"
status: reference
---

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
remaining-time estimate: native configuration/resource resolution, configured
WASM plugins, theme, and Project UI. Every progress bar uses `max="1"` and a ratio,
or omits `value` for unknown progress. Completed Unit bars are hidden, but cached/prepared details stay visible.
Each requested source gets its own row, so parallel downloads are not collapsed
into a misleading single current filename. Active rows appear above completed
rows. Source labels show the asset filename and ZIP selector, without URL query
parameters. No new preload of unused Views is introduced.

Resource resolution reports cache checks, download bytes (indeterminate when the
size is unknown), archive extraction and completion. The existing startup screen
reports native resource preparation, configured plugin loading and UI initialization.
`Ready` means the source has been prepared, not that the corresponding View has
finished initialization. Cached sources are marked explicitly. Counts reflect
native resolution resources, not View readiness. All configured `$file` resources
resolve before `runtime.ready`, including sources for Views not yet initialized.

The screen is removed only after awaited UI initialization and Save-menu enabling
succeed. Startup failures are logged under `[project.open]`, retained on screen,
and offer **Reload Project**. Failed startup does not expose the ready debug
runtime or start the FPS overlay. Reload restarts initialization; this is not an
in-place transaction rollback, partial-cache cleanup, or download cancellation.

## Plugin and Project theme preparation

After `runtime.ready`, all configured WASM plugins load together once from local
paths. The Project explicitly supplies `plugin.fs` or a compatible FS provider;
there is no special filesystem bootstrap, filename selection or pinned fallback.
Only after plugin loading succeeds does the app prepare the theme and initialize
JS UI Services. The theme becomes visible when its stylesheet loads, before
Project UI initialization completes. No frontend Unit resolver or second theme
download runs. Direct `init(config)` callers retain default theme preparation.

A Project may omit `ui.theme` or set it to `null` to use Host base styling alone.
No theme Unit is resolved or read in that case. A selected theme must still have
a valid source; malformed configuration and theme loading failures remain errors.

`core/project-theme.js` consumes the selected Project's already-local
`ui.theme.url` (or legacy local `path`), reads CSS through the filesystem provider,
and installs a blob URL on the required Host theme link. Listeners are installed before href assignment;
CSS `load`, not href assignment, completes preparation. A failed stylesheet load
restores the prior link, releases the failed blob, and fails startup visibly.
Successfully replaced theme blobs are released by the services bootstrap. Existing
View/Popup shadow links continue to receive the applied theme href. No new
relative CSS-asset resolver or theme-source fallback is introduced.

A plugin or theme failure prevents further UI initialization. The visible failure
snapshot stops updating and hides progress bars. This is not cancellation of
remaining native work.

## Native resolution progress

Native Project loading starts asynchronously through `runtime_project` with its
`onProgress` channel installed before consumers await `runtime.ready`. It resolves
all configuration resources before `runtime.ready` completes and Units consume
`runtime.config`, including full archive preparation before any WASM plugin loads.

| Runtime API | Behavior |
| --- | --- |
| `runtime.subscribeResolutionProgress(callback)` | Subscribes to native resolution snapshots and immediately replays the latest available snapshot. Returns an unsubscribe function. |
| `runtime.resolutionProgress` | Holds the latest received snapshot. |
| `runtime.getResolutionProgress()` | Queries the latest native snapshot and updates subscribers. |

Each snapshot has this shape:

```ts
{
  operationId: string,
  status: "resolving" | "ready" | "failed",
  discovered: number,
  completed: number,
  resources: ResourceEvent[],
  error: string | null
}
```

`discovered` and `completed` count resources in that resolution operation.
Each `ResourceEvent` contains:

```ts
{
  operationId: number,
  resource: string,
  phase: "resolving" | "checking-cache" | "downloading" | "extracting" | "ready" | "failed",
  completed: number,
  total: number | null,
  unit: "bytes" | "entries" | null,
  cached: boolean,
  entry: string | null,
  error: string | null
}
```

Resource counters are non-negative integers. Unknown totals are `null`;
`unit` distinguishes byte and entry counts from unmeasured phases. Discovering
more resources is not a fixed total or a remaining-time estimate. This boundary
covers native configuration/resource resolution, not View initialization or
layout readiness.

Startup subscribes directly to `runtime.subscribeResolutionProgress`; the
`core/startup-progress.js` model maps native snapshots into screen rows. There is
no frontend Unit resolver or compatibility-loader progress stream. Native code
owns downloads, extraction and cache writes. Preparing configured resources does
not initialize unused Views. Subscribing does not reopen the startup screen for
explicit later resolutions or add refresh/update behavior. Reload restarts
startup rather than refreshing completed URL cache entries.

## Verification boundary

Run `nix develop --command make validate-docs` for documentation validation and
`nix develop --command make test` for Host tests. Automated loader and DOM-boundary
tests do not establish native screen rendering or Windows/Linux desktop smoke
behavior. The browser style fixture below checks the existing renderer, not
native resource resolution.

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
