---
title: Web
status: reference
---

# Web

Use GAMS directly in your browser. No desktop application or GAMS backend server
is required.

## Open a Project

1. Open GAMS in your browser.
2. Choose the Project to work with and grant access to its files when prompted.
3. Edit content through the Project's Views and tools.
4. Save or export your changes before closing the workspace.

## Arguments and environment

Web has no process arguments or shell environment variables. Choose the Project
and grant file access in the browser; native startup settings do not apply.

## Files and tools

| Task | What to do |
| --- | --- |
| Use local files | Select the files or folder and allow the requested browser access. |
| Run a tool | Choose a tool available in Web and supply its inputs. |
| Keep your work | Save to an authorized location or download an export. |
| Use native commands or server files | Open the Project in [[runtime-native|Native]] or [[runtime-web-server|WebServer]]. |

Web uses browser-supported tools and file access. Selecting a local file does
not upload it to a GAMS backend server.

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

Open one GAMS session per origin. A second tab cannot use the same browser storage until the first session closes.
UI callbacks temporarily permit nested data operations in the same worker, not
isolated concurrent callers. Plugin replacement and cache clearing are denied
inside that window. Graceful close waits for a pending callback to finish;
force-stop can lose unconfirmed changes.
