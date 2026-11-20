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
