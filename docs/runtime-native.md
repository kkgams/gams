---
title: Native
status: reference
---

# Native

Edit a Project on your computer using its configured Views and tools.

## Open a Project

From the directory containing your `gams.json`, run:

```sh
gams --runtime native
```

You can also set `GAMS_RUNTIME=native` and run `gams`. Use the
[[runtime#arguments-and-environment|shared arguments and environment variables]] to choose a Project,
config file, Unit storage directory or plugin cache.

| Task | What to do |
| --- | --- |
| Edit content | Open the appropriate View and use its tools. |
| Apply an action to a selection | Choose the View containing that selection. |
| Work across Views | Choose a group, or explicitly select all Views you want to affect. |
| Automate editing | Authorize your terminal or agent to connect to the open workspace through RPC. |

## Use external tools

1. Choose the open workspace to control.
2. Inspect its available tools, Views and selections.
3. Choose the action, supply its arguments and confirm the intended Views.
4. Run it and check the result. Follow progress and notifications in the workspace.

Disconnecting a terminal or agent leaves your desktop workspace open.

See [[runtime|runtime modes]], [[host-runtime|Project configuration]] and
[[runtime-terminal|terminal access]].
