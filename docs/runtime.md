---
title: Runtime
status: reference
---

# Runtime

Choose how you want to use GAMS.

| Option | Start or connect | Use for |
| --- | --- | --- |
| [[runtime-native|Native]] | `gams --runtime native` | Edit a Project on your computer. |
| [[runtime-web-server|WebServer]] | `gams --runtime server` | Make a Project available through a browser. |
| [[runtime-terminal|REPL/CLI]] | `gams --runtime terminal` | Run tools interactively, from scripts or in CI. |
| [[runtime-web|Web]] | Open GAMS in your browser. | Edit a Project without a desktop app or GAMS backend server. |
| [[runtime-rpc|RPC]] | Connect to a running Native, WebServer or REPL/CLI workspace. | Use external tools or agents with an already-open workspace. |

## Arguments and environment

These options apply to Native, WebServer and REPL/CLI. Each setting accepts
an argument or its matching environment variable.

| Argument | Environment variable | Values / default | Description |
| --- | --- | --- | --- |
| `--runtime` | `GAMS_RUNTIME` | `native`, `server`, `terminal`; default: `native` | Choose how to run GAMS. |
| `--project-dir` | `GAMS_APP_CWD` | Directory path; default: current directory | Choose the Project directory. |
| `--config` | `GAMS_CONFIG` | Filename; default: `gams.json` | Choose the config file within the Project directory. Paths are not accepted. |
| `--modules-dir` | `GAMS_MODULES_DIR` | Absolute directory path; default: `<project>/gams_modules` | Choose where downloaded Project Units are stored. |
| `--plugin-cache-dir` | `GAMS_WASMTIME_CACHE_DIR` | Directory path; default: GAMS application cache | Choose where compiled plugins are cached. |

- An argument overrides its matching environment variable; otherwise the default applies.
- Empty or invalid selected values produce an error, not a fallback.
- Relative paths use the directory where you launched GAMS. The config filename is relative to the Project directory.
- Use one `--runtime` selector; repeated selectors and unknown modes are rejected.

For example, these commands select the same Project and config:

```sh
gams --runtime native --project-dir /path/to/project --config gams.dev.json
GAMS_RUNTIME=native GAMS_APP_CWD=/path/to/project GAMS_CONFIG=gams.dev.json gams
```

See [[runtime-native|Native]] for developer tools,
[[runtime-web-server|WebServer]] for listening options and
[[runtime-terminal|REPL/CLI]] for plugin and tool-call options.
[[runtime-web|Web]] opens directly in the browser and uses no process arguments
or shell environment variables.
