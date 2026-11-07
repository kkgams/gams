---
title: RPC
status: reference
---

# RPC

Use an external tool or agent to make calls to a GAMS workspace. RPC is a
connection option, not another runtime.

## Choose access

| Workspace | How to connect |
| --- | --- |
| [[runtime-native|Native]] | Start with `--rpc` or `GAMS_RPC=true`, then authorize your local tool. Access is disabled by default and limited to this computer. |
| [[runtime-web-server|WebServer]] | Connect through the server's existing address and authorize access. No RPC enable flag is needed. |
| [[runtime-terminal|REPL/CLI]] | Send requests through stdin and read responses from stdout. No RPC enable flag is needed. |

For remote access, use WebServer.

## Make calls

1. Connect using the access method above.
2. Choose an available operation and send its arguments.
3. Read the result or error before continuing.

Use the [[runtime-terminal#make-a-call|call protocol]] to request operations:

```text
fs/fs::read-text README.md
```

| Task | What to do |
| --- | --- |
| Work with files | Use paths available to the connected workspace. |
| Control a View | Choose the intended window or browser tab, then the View or group of Views. |
| Run several dependent calls | Keep using the same workspace and reuse returned values. |

Use your own script or agent for loops, transformations and other advanced tasks.

Disconnecting from Native or WebServer leaves the workspace open. For REPL/CLI,
keep stdin open while sending calls; closing the input ends terminal execution.

See [[runtime|Runtime options]].
