---
title: Web server
status: reference
---

# Web server

Use the web server to run plugins remotely while editing through a browser.

| Part | Runs in |
| --- | --- |
| WASM plugins, filesystem operations and session state | Server |
| Views, UI Services and theme | Browser |
| Plugin calls, results and execution events | RPC connection |

## Connect to a workspace

1. Open the GAMS server in a browser and authenticate.
2. Open or attach to the intended Runtime Session.
3. Load the Project's interface and work through its Views.
4. Connect a terminal or agent to that session to share its plugin state.

## Work with files and UI

| Task | Rule |
| --- | --- |
| Read or write a path | Paths refer to the server's filesystem and permitted access. |
| Use a browser-local file | Transfer the file explicitly before server-side processing. |
| Discover operations | Inspect plugin tools and registered UI actions, including where they execute. |
| Control a View | Resolve its UI client and View scope from context or an explicit target. |
| Control multiple Views | Target a group or all Views within an explicit scope. |
| Call an unavailable UI client or action | The call fails; it is not redirected to another browser. |

Each UI client has its own Views and selections. Authorization controls access
to the session and its operations, including server files and native commands.

See [[runtime-native|native application]] and [[runtime-terminal|terminal access]].
