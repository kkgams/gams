---
title: Native application
status: reference
---

# Native application

Use the native application to edit a Project locally and connect external tools
to the same workspace.

| Part | Runs in |
| --- | --- |
| WASM plugins and session state | Local Host |
| Views and UI Services | Desktop window |
| Attached terminal or agent | External process, connected through RPC |

## Open a Project

1. Open GAMS with the Project directory containing `gams.json`.
2. Work through the Project's configured Views and UI Services.
3. To automate the workspace, authorize an RPC connection to its Runtime Session.

## Control the workspace

| Task | Action |
| --- | --- |
| Find callable operations | Discover the session's tools and argument descriptions. |
| Inspect the interface | Read UI context for visible Views, selections and supported actions. |
| Act on a selection | Resolve the target from context or select specific Views. |
| Act across Views | Target a group or all Views within an explicit scope. |
| Show a notification or popup | Call the registered UI Service in the intended UI client. |
| Follow execution | Read the call's results and progress events. |

Attached callers share the application's plugin state. Reuse returned resource
handles in that session and release them when finished. Disconnecting an external
caller leaves the desktop session running.

See [[host-runtime|Project configuration]], [[runtime-terminal|terminal access]]
and [[runtime-web-server|web server]].
