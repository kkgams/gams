---
title: Web
status: reference
---

# Web

Use GAMS directly in your browser. No desktop application or GAMS backend server
is required.

## Open a Project

1. Open [GAMS Web](https://gams.z0.lv/app.html). The default Files Project opens automatically.
2. To open another Project, use the [Web Host URL settings](https://github.com/kkgams/gams/blob/release/cmd/web/README.md#url-settings).
3. Edit content through the Project's Views and tools.
4. Save your changes and use **Browser Host → Checkpoint and close** before leaving.

## Open a showcase

| Web demo | Try it | Native ZIP |
| --- | --- | --- |
| [Launch fresh Tilemap demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.1.0%2Ftilemap.zip) | Paint terrain and move trees. | [Download](https://github.com/kkgams/showcases/releases/download/v0.1.0/tilemap.zip) |
| [Launch fresh Aseprite demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.2.0%2Faseprite.zip) | Play a layered firefly animation. | [Download](https://github.com/kkgams/showcases/releases/download/v0.2.0/aseprite.zip) |
| [Launch fresh SQL demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.2.0%2Fsql.zip) | Run `SELECT name, price FROM items WHERE rarity = 'rare' ORDER BY price;`. | [Download](https://github.com/kkgams/showcases/releases/download/v0.2.0/sql.zip) |
| [Launch fresh Nodegraph demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.2.0%2Fnodegraph.zip) | Click Run, then select Settings, click Edit, and change the node count. Run again and inspect `tree-output.json` in Files. | [Download](https://github.com/kkgams/showcases/releases/download/v0.2.0/nodegraph.zip) |
| [Launch fresh MarkovJunior demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.3.0%2Fmarkov.zip) | Click Step to grow the island, then change the seed and compare. | [Download](https://github.com/kkgams/showcases/releases/download/v0.3.0/markov.zip) |
| [Launch fresh BulletML demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.3.0%2Fbulletml.zip) | Play the spiral, pause, and step one frame at a time. | [Download](https://github.com/kkgams/showcases/releases/download/v0.3.0/bulletml.zip) |
| [Launch fresh Track demo](https://gams.z0.lv/app.html?showcase=https%3A%2F%2Fgithub.com%2Fkkgams%2Fshowcases%2Freleases%2Fdownload%2Fv0.3.0%2Ftrack.zip) | Select and drag a control point on Sunset Circuit, then save the SVG. | [Download](https://github.com/kkgams/showcases/releases/download/v0.3.0/track.zip) |

For Native GAMS, unpack the ZIP and open its `gams.json`.

A **Launch fresh** showcase link imports the demo ZIP into a separate browser
Project. Once the demo opens, reloading keeps your edits. Opening the fresh link
again resets that demo, without changing your other Projects. Export anything
you want to keep before resetting.

## Differences from Native

Web runs the shared interface and supported WASM plugins, but not every Native workflow is available. It does not expose shell or process execution, native IPC, or unrestricted OS filesystem access. Open the Project in [[runtime-native|Native]] when a workflow needs those facilities.

| Task | What to do |
| --- | --- |
| Use local files | Upload them through the Files View into the browser Project. This does not send them to a GAMS backend server. |
| Keep your work | Save to browser storage or download an export. Storage is tied to the site's origin; clearing site data removes it. |
| Import over HTTP | An individual download is limited to 64 MiB. This is not a size limit for files already in browser storage. |
| Start a specific Project | Use URL settings. Web has no process arguments or shell environment variables. |

Use a browser that supports OPFS and Web Locks. Self-hosted builds require cross-origin isolation; the production site already provides it. Open one GAMS session per origin. A second tab cannot use the same storage until the first session closes.

See [[runtime|runtime modes]].

## Plugin execution

Plugins execute in the browser worker. The existing
`gams:runtime/runtime@1.0.0` import exchanges a target and JSON argument-array
string for a JSON result string or declared error. Interface targets call loaded
components; dotted targets call registered UI operations. Unsupported imports,
missing targets and active-component cycles fail explicitly; native shell/process
facilities are not granted.

Runtime callbacks require browser JSPI support. Font/Lua exception instructions
use the existing pinned compiler's exception option, not a replacement compiler
or old Lua API. Traps and other unclassified guest exceptions abort linked calls; UI failures
retain the Native bridge's declared string-error boundary. A trapped component requires explicit
reload.

UI callbacks temporarily permit nested data operations in the same worker, not
isolated concurrent callers. Plugin replacement and cache clearing are denied
inside that window. Graceful close waits for a pending callback to finish;
force-stop can lose unconfirmed changes.
