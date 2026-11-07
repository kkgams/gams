---
title: WebServer
status: reference
---

# WebServer

Use a server-hosted Project through your browser. For browser-only use without
a GAMS server, choose [[runtime-web|Web]].

## Start and open a workspace

On the server, run this command from the Project directory:

```sh
gams --runtime server
```

1. Open the address shown by GAMS in your browser.
2. Authenticate and choose the workspace to open.
3. Edit content through the Project's Views and tools.

## Files and automation

| Task | What to do |
| --- | --- |
| Work with Project files | Use paths available on the server. |
| Use a file from your computer | Upload it before processing it with Project tools. |
| Automate the workspace | Authorize a terminal or agent to connect to that workspace through RPC. |
| Control a browser View | Choose the browser workspace and the View or group of Views to control. |
| Run an action | Supply its arguments, check the selected Views and inspect the result. |

Browser tabs can have different selections. Check your target before running an
action; a missing View or unavailable action produces an error.

You can access only the workspaces, files and actions you are authorized to use.

See [[runtime|runtime modes]] and [[runtime-terminal|terminal access]].
