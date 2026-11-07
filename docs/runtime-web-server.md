---
title: Web server
status: reference
---

# Web server

The web server runs GAMS Runtime Sessions on a server. WASM plugins execute on
that server; Views and UI Services execute in connected browsers. Plugin calls
cross the network through RPC instead of invoking a browser-local WASM Runtime.

This page defines the runtime-mode contract. See [[index|Runtime overview]] for
current implementation availability.

## Server execution

Each session owns its loaded WASM plugins, execution state and resource handles.
A browser or terminal attaches to a specific session. Attaching does not create
a second copy of its plugin state.

Filesystem and native operations run in the server's environment with the
session's permitted access. A path passed to a filesystem plugin refers to that
environment, not the browser user's local filesystem. Browser-local files require
an explicit transfer; passing a local filename does not upload its contents.

## Browser interface

Browsers load the Project's Views, UI Services and theme. Their registered UI
operations and context are discoverable alongside the session's plugin
operations, with their execution location identified.

A session can have multiple UI clients. Each client has its own visible Views,
focus and selections. UI calls resolve their intended client and View scope
from context or an explicit target; they do not silently select whichever browser
was last active. A context can
include multiple Views and expose actions targeting one View, a group, or all
Views within that scope.

Plugin operations that need a UI route their requests to the intended client.
An unavailable client or unsupported action produces an explicit failure rather
than silently executing in another browser.

## Terminal and external access

Terminal clients and external tools attach to the same server-side session as
the browsers. They can discover operations, invoke plugins, inspect UI context
and call registered UI actions. Results and execution events return over RPC;
UI operations execute in the selected browser.

Network access requires authentication and authorization for the requested
session and operations. A network connection must not automatically inherit
unrestricted access to the server's files or native shell.

## Related documentation

- [[runtime-native|Native application]] — local execution with a desktop interface
- [[runtime-terminal|Terminal (CLI / REPL)]] — terminal-owned and attached sessions
