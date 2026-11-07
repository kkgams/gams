---
title: Runtime
status: reference
---

# Runtime

Choose an execution mode with `--runtime`.

| Mode | Start | Use for |
| --- | --- | --- |
| [[runtime-native|Native application]] | `gams --runtime native` | Local editing through desktop Views and UI Services. |
| [[runtime-web-server|Web server]] | `gams --runtime server` | Browser-based editing with server-side plugin execution. |
| [[runtime-terminal|Terminal (CLI / REPL)]] | `gams --runtime terminal` | Single calls, piped automation and interactive sessions. |

Without `--runtime`, GAMS starts the native application. Select one mode per
process; an unknown value or repeated selector is an error.

## Sessions and clients

| Term | Meaning |
| --- | --- |
| Runtime Session | Loaded WASM plugins, their state and resource handles. |
| UI client | Desktop or browser interface containing Views and UI Services. A session can have multiple UI clients. |
| UI context | Relevant clients, Views, selections and supported actions. Actions target one View, a group, or all Views within an explicit scope. |
| RPC | Connects terminals and external tools to an existing session for discovery, calls, results and execution events. |

Discover an operation to inspect its arguments and results before calling it.
Plugin operations execute in the session; UI operations execute in the selected
UI client. RPC attaches to a running session in any mode; it does not start a
separate copy of its plugin state.
