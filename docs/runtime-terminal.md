---
title: Terminal (CLI / REPL)
status: reference
---

# Terminal (CLI / REPL)

Use the terminal for automation, CI and interactive plugin calls.

## Choose input and session

| Input | Use for | Behavior |
| --- | --- | --- |
| Single call | Shell commands and CI steps | Execute one operation and return its result. |
| Piped requests | Multi-step scripts and CI jobs | Read structured requests from stdin; write responses to stdout. |
| Interactive REPL | Exploration and dependent calls | Discover tools, inspect results and reuse values. |

| Session | Behavior | Lifetime |
| --- | --- | --- |
| Start your own | Load WASM plugins and dependencies; no GUI required. | Ends with terminal execution unless explicitly kept running. |
| Attach | Share a native, server or terminal session's plugins, state and UI operations. | Disconnecting leaves the session running. |

Protocol input/output is separate from plugin streams, logs and prompts.
Failures are machine-readable; process exit status identifies failed execution.

## Chain calls

1. Discover the operation and its arguments.
2. Invoke it and inspect the result.
3. Reuse returned values or resource handles in subsequent calls.
4. Release resources when finished.

Example: open a SQL connection → prepare a statement → query using both handles
→ inspect rows → release the statement and connection.

## Session rules

| Situation | Behavior |
| --- | --- |
| An authorized client attaches | It shares the running session. |
| A call needs an unavailable UI | The call reports the missing requirement. |
| A handle belongs to another session | It cannot be used here. |
| Session termination or plugin reload invalidates a handle | Further use reports an invalid handle. |
| A single-shot process exits | Its ended session cannot be attached to. |

Release only resources you own. Disconnecting must not release resources owned
by other clients.

See [[runtime-native|native application]] and [[runtime-web-server|web server]].
