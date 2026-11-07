---
title: REPL
status: reference
---

# REPL

Run Project tools without opening a graphical interface.

```sh
gams --runtime terminal
```

## Arguments and environment

Use the [[runtime#arguments-and-environment|shared runtime options]] to select
the Project and startup settings. You can also start the REPL with
`GAMS_RUNTIME=terminal gams`.

Send operations and their arguments through stdin, not startup flags.

## Choose how to work

| Input | Use for |
| --- | --- |
| Piped requests | Send one or more calls through stdin and read results from stdout. |
| Interactive REPL | Explore tools, inspect results and build the next call from an earlier result. |

To automate a terminal workspace, send requests through stdin and read responses
from stdout. Keep its input open for dependent calls; no RPC enable flag is needed.

For example, send one call from a script:

```sh
printf '%s\n' 'fs/fs::read-text README.md' | gams --runtime terminal
```

To work with an open Native or WebServer workspace instead, use its
[[runtime-rpc|RPC connection]].

## Make a call

Enter the operation name followed by its arguments:

```text
fs/fs::read-text README.md
```

| Argument form | Example | Use for |
| --- | --- | --- |
| Bare text | `README.md` | Simple text without spaces. |
| Quoted string | `"project notes/README.md"` | Text containing spaces; use JSON string escaping for quotes and backslashes. |
| JSON array or object | `[1, "two"]`, `{"message": "Project saved"}` | Structured values; each complete array or object is one argument. |

```text
fs/fs::read-text "project notes/README.md"
```

Do not add another layer of quotes around a JSON array or object.

Read the result or error, then send the next call. Use the same call format
interactively or through stdin.

The call protocol has no variables, expressions or control flow. Use your own
script or agent to combine results, transform data or repeat calls.

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
| A call fails in CI | Read the error response for that call. |
| You finish with an attached Native or WebServer workspace | Disconnect; the workspace stays open. |

Keep stdin open for dependent calls in the same workspace. Closing the input
ends the REPL.

See [[runtime|runtime modes]], [[runtime-native|native application]] and
[[runtime-web-server|web server]].
