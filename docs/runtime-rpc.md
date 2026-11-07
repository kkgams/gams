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
| [[runtime-native|Native]] | Start with `--rpc` or `GAMS_RPC=true`, then connect to its local socket or named pipe. No authentication or approval dialog. |
| [[runtime-web-server|WebServer]] | Connect through the server's existing address and authorize access. No RPC enable flag is needed. |
| [[runtime-terminal|REPL]] | Send requests through stdin and read responses from stdout. No RPC enable flag is needed. |

For remote access, use WebServer.

## Native local connection

Start `gams --runtime native --rpc` from your Project. Find that GAMS process's
PID using Activity Monitor, Task Manager or your shell's process tools.
The endpoint is also printed to stderr when stderr is attached.

| Platform | Endpoint for PID `12345` |
| --- | --- |
| macOS / Linux | `/tmp/gams-rpc-12345/rpc.sock` |
| Windows | `\\\\.\\pipe\\gams-rpc-12345` |

Use the PID of the running GAMS executable, not a launcher or parent shell.
Multiple GAMS processes have separate endpoints. Access is disabled unless
`--rpc` or `GAMS_RPC=true` is set. No TCP/HTTP port is opened; Windows pipes reject
remote clients. Unix endpoints have an owner-only directory and socket.

There is no authentication. Any process permitted by the operating system to
access the endpoint can invoke Host and loaded WASM operations, including shell
execution. Do not enable access for a workspace you do not want local tools to
control.

### macOS / Linux example

Replace `12345` with your GAMS PID:

```python
import socket

with socket.socket(socket.AF_UNIX) as connection:
    connection.connect("/tmp/gams-rpc-12345/rpc.sock")
    with connection.makefile("rw", encoding="utf-8", newline="\n") as stream:
        stream.write("gams/host::help\n")
        stream.flush()
        print(stream.readline())
```

### Windows PowerShell example

```powershell
$pipe = [System.IO.Pipes.NamedPipeClientStream]::new(
    ".", "gams-rpc-12345", [System.IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(5000)
$writer = [System.IO.StreamWriter]::new(
    $pipe, [System.Text.UTF8Encoding]::new($false), 1024, $true)
$writer.AutoFlush = $true
$reader = [System.IO.StreamReader]::new($pipe)
try {
    $writer.WriteLine("gams/host::help")
    $reader.ReadLine()
} finally {
    $writer.Dispose()
    $reader.Dispose()
    $pipe.Dispose()
}
```

Each nonblank request occupies one line and returns one compact JSON response:
`{"ok": ...}` or `{"error":{"message":"..."}}`. Invalid calls do not close the
connection. Continue on the same connection or reconnect to use the same loaded
plugins and resource references. Closing a connection does not close GAMS.

Normal GAMS shutdown removes the Unix endpoint. After a crash, a Unix endpoint
may remain; remove its socket and empty directory only after confirming that
its GAMS process is no longer running. GAMS refuses to overwrite existing paths.

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

Disconnecting from Native or WebServer leaves the workspace open. For REPL,
keep stdin open while sending calls; closing the input ends terminal execution.

See [[runtime|Runtime options]].
