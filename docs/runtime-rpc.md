---
title: RPC
status: reference
---

# RPC

Connect an external tool or agent to a workspace already running in
[[runtime-native|Native]], [[runtime-web-server|WebServer]] or
[[runtime-terminal|REPL/CLI]]. You do not need to open another copy of the Project.

## Connect and make calls

1. Get the connection details for the workspace you want to use.
2. Connect your tool and authorize access.
3. Choose an available operation and send its arguments.
4. Read the result or error before continuing.
5. Disconnect when finished; the workspace stays open.

Use the [[runtime-terminal#make-a-call|call protocol]] to request operations:

```text
fs/fs::read-text README.md
```

| Task | What to do |
| --- | --- |
| Work with files | Use paths available to the connected workspace. |
| Control a View | Choose the intended window or browser tab, then the View or group of Views. |
| Run several dependent calls | Keep the connection to the same workspace and reuse returned values. |

Use your own script or agent for loops, transformations and other advanced tasks.

See [[runtime|Runtime options]].
