---
title: REPL
status: reference
---

# REPL

Run Project tools without opening a graphical interface.

```sh
gams --runtime repl
```

In Windows Command Prompt, keep the terminal attached with:

```bat
start "" /wait gams.exe --runtime repl
```

## Arguments and environment

Use the [[runtime#arguments-and-environment|shared runtime options]] to select
the Project and startup settings. You can also start the REPL with
`GAMS_RUNTIME=repl gams`.

| Argument | Environment variable | Values / default | Description |
| --- | --- | --- | --- |
| `--format` | `GAMS_FORMAT` | `json`, `human`; default: `json` | Choose compact JSON or readable responses. REPL only. |

JSON remains the default for both interactive and piped input. To choose readable
output, run `gams --runtime repl --format=human` or set
`GAMS_RUNTIME=repl GAMS_FORMAT=human`. `--format=json` overrides a human environment
setting. Native RPC selects its format through `--rpc=json` or `--rpc=human`.

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
printf '%s\n' 'fs/fs::read-text README.md' | gams --runtime repl
```

To work with an open Native or WebServer workspace instead, use its
[[runtime-rpc|RPC connection]].

## Make a call

Start with `gams/host::help` to list [[runtime-commands|GAMS commands]]. Load any
plugins you need with `gams/host::load-plugins`.

Enter the operation name followed by its arguments:

```text
fs/fs::read-text README.md
```

| Argument form | Example | Use for |
| --- | --- | --- |
| Bare text | `README.md` | Simple text without spaces. |
| Quoted string | `"project notes/README.md"` | Text containing spaces; use JSON string escaping for quotes and backslashes. |
| JSON array or object | `[1, "two"]`, `{"message": "Project saved"}` | Structured values; each complete array or object is one argument. |
| JSON number, boolean or null | `42`, `true`, `null` | Typed values; quote them when you mean text, for example `"42"`. |

```text
fs/fs::read-text "project notes/README.md"
```

Do not add another layer of quotes around a JSON array or object.

Send one complete call per line. Keep JSON arrays and objects on that line;
use JSON escapes for newlines inside strings. Blank lines are ignored.

In the default JSON format, each call returns one JSON line: `{"ok": <result>}` on success or
`{"error": {"message": "..."}}` on an input or execution error. The operation's
result is returned unchanged, including any plugin-specific `ok`/`err` values.
Errors do not end the REPL; correct the call and continue.

With `--format=human`, a response starts with `OK` or `ERROR`, followed by the
result or error message formatted as indented JSON. Every response ends with
`--- end ---` on its own line:

```text
OK
[]
--- end ---
```

For errors, the message is JSON-quoted. Newlines inside strings stay escaped, so
result data cannot be mistaken for an end marker. Human responses can span
multiple lines; use JSON when a script expects one response per line.

Stdout contains only responses; plugin output and diagnostics use stderr.

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
