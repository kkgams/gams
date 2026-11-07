---
title: Runtime
status: reference
---

# Runtime

Choose how you want to use GAMS.

| Mode | Start | Use for |
| --- | --- | --- |
| [[runtime-native|Native]] | `gams --runtime native` | Edit a Project on your computer. |
| [[runtime-web-server|WebServer]] | `gams --runtime server` | Make a Project available through a browser. |
| [[runtime-terminal|REPL/CLI]] | `gams --runtime terminal` | Run tools interactively, from scripts or in CI. |
| [[runtime-web|Web]] | Open GAMS in your browser. | Edit a Project without a desktop app or GAMS backend server. |

Run native commands from your Project directory. Without `--runtime`, GAMS opens
Native. Use one selector; repeated selectors and unknown modes are rejected.
Web requires no native command.
