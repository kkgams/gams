---
title: Runtime
status: reference
---

# Runtime

Choose how you want to use GAMS.

| Mode | Start | Use for |
| --- | --- | --- |
| [[runtime-native|Native application]] | `gams --runtime native` | Edit a Project on your computer. |
| [[runtime-web-server|Web server]] | `gams --runtime server` | Make a Project available through a browser. |
| [[runtime-terminal|Terminal (CLI / REPL)]] | `gams --runtime terminal` | Run tools interactively, from scripts or in CI. |

For desktop or browser editing, run the command from your Project directory.
Without `--runtime`, GAMS opens the native application. Use one selector;
repeated selectors and unknown modes are rejected.
