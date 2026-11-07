---
title: Terminal (CLI / REPL)
status: reference
---

# Terminal (CLI / REPL)

Run Project tools without opening a graphical interface.

```sh
gams --runtime terminal
```

## Choose how to work

| Input | Use for |
| --- | --- |
| Single call | Run one tool from a shell command or CI step. |
| Piped requests | Send a sequence of requests through stdin and read results from stdout. |
| Interactive REPL | Explore tools, inspect results and build the next call from an earlier result. |

Start your own workspace for independent processing. Connect to an open desktop,
server or terminal workspace through RPC when you want to work with its existing
data or control its Views.

## Run a sequence

1. Choose a tool and read its argument help.
2. Supply the arguments and run it.
3. Inspect the result; reuse returned values in the next call.
4. Close any connections or documents you opened when finished.

For example: open a database, prepare a query, fetch rows, then close the
statement and database connection.

## Handle errors and exit

| Situation | What to do |
| --- | --- |
| A tool requires an open View | Connect to a workspace containing that View. |
| A returned reference is no longer valid | Open the object again; references cannot be reused after their workspace closes or its plugins reload. |
| A call fails in CI | Read the structured error and check the process exit status. |
| You finish with an attached workspace | Disconnect; the workspace stays open. |

Keep dependent calls in the same workspace. A completed single-shot command
cannot accept further calls; use piped input or the REPL to continue working.

See [[runtime|runtime modes]], [[runtime-native|native application]] and
[[runtime-web-server|web server]].
