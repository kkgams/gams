---
title: Terminal (CLI / REPL)
status: reference
---

# Terminal (CLI / REPL)

Terminal mode runs GAMS without creating a graphical interface. It supports a
single call, a piped sequence of calls, or an interactive read–eval–print loop
(REPL). These are input/output forms of the same terminal client, not different
plugin runtimes. A full-screen terminal user interface (TUI) is not required.

This page defines the runtime-mode contract. See [[index|Runtime overview]] for
current implementation availability.

## Session ownership

The terminal client either starts a Runtime Session or attaches to an existing
one through RPC.

A terminal-owned session loads WASM plugins and their dependencies without
requiring Views or UI Services. It retains plugin state and resource handles
while calls continue. Other authorized clients can attach while the session is
running. A call that requires an unavailable UI reports that requirement; terminal
mode does not emulate a browser.

An attached terminal uses the target session's existing plugins, state and
resources. The session can belong to a [[runtime-native|native application]], a
[[runtime-web-server|web server]], or another running terminal process. Ending
that terminal connection does not terminate the session it attached to.

## Input and output

- **Single-call input** executes one operation and returns its result. It suits
  shell commands and CI steps that need no subsequent calls in the same session.
- **Piped input** accepts a sequence of structured requests and emits structured
  responses. Calls in the same session can use resource handles returned by
  earlier calls. Protocol input/output must remain separate from plugin standard
  streams, logs and interactive prompts.
- **Interactive input** supports discovering operations, inspecting arguments and
  results, retaining returned values and using them in subsequent calls. Resource
  handles can be explicitly released when no longer needed.

The callable operations and their validation do not depend on the input form.
Machine-readable failures and process exit status must let CI distinguish a
failed operation from successful execution.

## Lifetime and resources

Resource handles refer to objects in the session that created them; they are
not portable values that can be passed to an unrelated Runtime Session.

A terminal-owned session normally ends when its execution finishes. Attaching
requires a live session: a completed single-shot command cannot be attached to
later. Keeping a session alive must be explicit rather than an accidental result
of an external client connection.

Closing a connection and ending a session are separate operations. Resource
cleanup must respect ownership and must not release resources still owned by
another client. Calls must report handles invalidated by session termination or
plugin reload rather than treating them as new objects.

## Related documentation

- [[runtime-native|Native application]] — attach to a running desktop workspace
- [[runtime-web-server|Web server]] — attach to server-side plugin execution
