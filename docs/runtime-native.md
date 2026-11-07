---
title: Native application
status: reference
---

# Native application

The native application runs a GAMS Runtime Session and displays the Project's
Views and UI Services in a desktop window. WASM plugins execute locally in the
Host; the interface runs in its embedded browser.

This page defines the runtime-mode contract. See [[index|Runtime overview]] for
current implementation availability.

## Runtime Session

The session owns the loaded WASM plugins, their execution state and resource
handles. The desktop interface is a UI client of that session. Closing a terminal
connection does not close the desktop application or its session.

A terminal or external tool attaches to the existing session through RPC. It
uses the same loaded plugins and state as the desktop interface, rather than
starting another Runtime against the Project's files.

## Interface control

The UI client registers its Views, UI Services and callable operations for
discovery. UI context describes the visible Views, their state and supported
actions; it is not limited to the most recently focused View.

An attached caller can inspect that context and target a specific View, a group
of Views, or all Views within an explicit scope. For example, deleting a selection
in one View does not implicitly delete selections in other Views or other UI
clients. Views own the meaning of their selections and actions.

Notifications, popups and other UI operations execute through the registered
UI Services. The Host routes calls and responses; it does not duplicate their
implementation or replace them with arbitrary JavaScript evaluation.

## External access

RPC exposes the session's discoverable operations to terminal clients and
external tools. Calls return structured results, including resource handles that
can be used in later calls to the same session. Execution events identify the
call they belong to so callers can follow progress and results.

Access to a session also grants access to the operations it exposes. Attaching
requires authorization; a running desktop application must not expose its Project
or shell operations to arbitrary network callers.

## Related documentation

- [[host-runtime|Host runtime and configuration]] — current Project selection and startup behavior
- [[runtime-web-server|Web server]] — server-side plugin execution with browser UI clients
- [[runtime-terminal|Terminal (CLI / REPL)]] — single-call, piped and interactive execution
