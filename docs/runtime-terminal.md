---
title: REPL/CLI
status: reference
---

# REPL/CLI

Run Project tools without opening a graphical interface.

```sh
gams --runtime terminal
```

## Arguments and environment

Use the [[runtime#arguments-and-environment|shared runtime options]] plus:

| Argument | Environment variable | Values / default | Description |
| --- | --- | --- | --- |
| `--plug` | `GAMS_PLUGINS` | Repeatable file path; environment: JSON array of paths; default: none | Load plugin files. Include the plugins they depend on. |
| `--target` | `GAMS_TARGET` | Tool name, such as `fs/fs::read-text`; default: none | Run one tool and exit. |
| `--args` | `GAMS_ARGS` | JSON array; default: `[]` | Supply the tool's arguments in order. |
| `--args-file` | `GAMS_ARGS_FILE` | File path; default: none | Read the JSON argument array from a file. Takes priority over inline arguments. |

Repeated `--plug` arguments replace the environment's plugin list rather than
adding to it. Without a target, interactive input opens the REPL; piped input
accepts a sequence of requests.

These commands perform the same call:

```sh
gams --runtime terminal --plug plugins/plugin.fs.wasm \
  --target fs/fs::read-text --args '["README.md"]'

GAMS_RUNTIME=terminal GAMS_PLUGINS='["plugins/plugin.fs.wasm"]' \
  GAMS_TARGET=fs/fs::read-text GAMS_ARGS='["README.md"]' gams
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

## Make a call

Enter the operation name followed by its arguments:

```text
fs/fs::read-text README.md
```

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
| A call fails in CI | Read the structured error and check the process exit status. |
| You finish with an attached workspace | Disconnect; the workspace stays open. |

Keep dependent calls in the same workspace. A completed single-shot command
cannot accept further calls; use piped input or the REPL to continue working.

See [[runtime|runtime modes]], [[runtime-native|native application]] and
[[runtime-web-server|web server]].
