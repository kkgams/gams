---
title: GAMS commands
status: reference
---

# GAMS commands

These commands are provided by GAMS itself and are available before loading any
Project Units.

List commands or inspect one command's arguments and result:

```text
gams/host::help
gams/host::help gams/host::load-plugins
```

## Command reference

Arguments are supplied in the order shown. Use the [[runtime-terminal#make-a-call|REPL call format]].

| Command | Arguments | What it does / returns |
| --- | --- | --- |
| `gams/host::help` | Optional command name | List built-in commands or describe one command. |
| `gams/host::load-plugins` | JSON array of file paths | Load plugins and their dependencies; return paths, handles, imports and exports. |
| `gams/host::plugins` | None | List loaded plugins and their exports. |
| `gams/host::diagnostics` | None | Show loaded plugins, callable exports, resource count and plugin cache location. |
| `gams/host::cache-plugin` | File path | Compile and cache a plugin without loading it; return the cache file path. |
| `gams/host::clear-cache` | None | Clear compiled plugin cache files used by this GAMS build; loaded plugins and unrelated files remain available. |
| `gams/host::release-resource` | Complete resource reference as a JSON object | Release a resource returned by a plugin. |
| `gams/host::project-init` | None | Create the selected Project config containing `{}`; never overwrite an existing file. |
| `gams:shell/shell@1.0.0::run` | Command string, timeout in milliseconds | Run an OS shell command; return its exit code and captured output, or a shell error. |

Plugin paths are relative to the Project directory unless absolute. Pass all
required plugin files together so GAMS can load their dependencies in order.
Use diagnostics' `exports` list to find callable plugin operations.

## Load and use a plugin

```text
gams/host::load-plugins ["plugins/plugin.fs.wasm"]
fs/fs::read-text "project notes/README.md"
```

To inspect or clear the compiled cache:

```text
gams/host::diagnostics
gams/host::clear-cache
```

Shell commands run with your operating-system permissions in the Project
directory. Run only commands you trust. Shell output is returned as data, not
mixed into the REPL response stream.

See [[runtime-terminal|REPL]] and [[runtime|Runtime options]].
