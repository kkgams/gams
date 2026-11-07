use crate::{commands::Commands, output::Format, repl};
use std::io;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::task::{JoinHandle, JoinSet};

/// One opt-in endpoint for the existing Native session. Dropping it closes
/// listeners/connections; an already executing Wasmtime call is not cancelled.
pub struct Server {
    pub endpoint: String,
    task: JoinHandle<()>,
    #[cfg(unix)]
    _socket: local::Socket,
}

impl Server {
    pub async fn start(commands: Commands, format: Format) -> io::Result<Self> {
        let (mut listener, endpoint) = local::Listener::bind()?;
        #[cfg(unix)]
        let socket = listener
            .socket
            .take()
            .expect("bound Unix listener owns its socket");
        let task = tokio::spawn(async move {
            let mut clients = JoinSet::new();
            loop {
                let stream = match listener.accept().await {
                    Ok(stream) => stream,
                    Err(error) => {
                        eprintln!("GAMS RPC listener failed: {error}");
                        break;
                    }
                };
                while let Some(result) = clients.try_join_next() {
                    if let Err(error) = result {
                        eprintln!("GAMS RPC connection task failed: {error}");
                    }
                }
                let commands = commands.clone();
                clients.spawn(async move {
                    if let Err(error) = serve(stream, commands, format).await {
                        eprintln!("GAMS RPC connection failed: {error}");
                    }
                });
            }
        });
        Ok(Self {
            endpoint,
            task,
            #[cfg(unix)]
            _socket: socket,
        })
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve(
    stream: impl AsyncRead + AsyncWrite + Unpin,
    commands: Commands,
    format: Format,
) -> io::Result<()> {
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let result = match repl::parse(&line) {
            Ok(call) => {
                let commands = commands.clone();
                tokio::task::spawn_blocking(move || commands.invoke(&call.target, call.args))
                    .await
                    .map_err(|error| {
                        io::Error::other(format!("RPC invocation task failed: {error}"))
                    })?
            }
            Err(message) => Err(message),
        };
        write.write_all(&format.encode(result)?).await?;
    }
    Ok(())
}

#[cfg(unix)]
mod local {
    use super::*;
    use std::os::unix::fs::{DirBuilderExt, FileTypeExt, PermissionsExt};
    use std::path::PathBuf;
    use tokio::net::{UnixListener, UnixStream};

    pub struct Socket {
        directory: PathBuf,
        path: PathBuf,
    }

    impl Drop for Socket {
        fn drop(&mut self) {
            match std::fs::symlink_metadata(&self.path) {
                Ok(metadata) if metadata.file_type().is_socket() => {
                    if let Err(error) = std::fs::remove_file(&self.path) {
                        eprintln!("GAMS RPC socket cleanup failed: {error}");
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                _ => eprintln!(
                    "GAMS RPC cleanup refused a replaced socket: {}",
                    self.path.display()
                ),
            }
            // Only remove the private directory if empty; never recurse.
            if let Err(error) = std::fs::remove_dir(&self.directory) {
                eprintln!("GAMS RPC directory cleanup failed: {error}");
            }
        }
    }

    pub struct Listener {
        inner: UnixListener,
        pub socket: Option<Socket>,
    }

    impl Listener {
        pub fn bind() -> io::Result<(Self, String)> {
            // A short fixed base avoids Unix socket path limits and ignores
            // inherited TMPDIR values. Existing paths are never reclaimed.
            let directory = PathBuf::from(format!("/tmp/gams-rpc-{}", std::process::id()));
            std::fs::DirBuilder::new().mode(0o700).create(&directory)?;
            let socket = Socket {
                path: directory.join("rpc.sock"),
                directory,
            };
            let inner = UnixListener::bind(&socket.path)?;
            std::fs::set_permissions(&socket.path, std::fs::Permissions::from_mode(0o600))?;
            let endpoint = socket
                .path
                .to_str()
                .expect("RPC socket path is ASCII")
                .to_owned();
            Ok((
                Self {
                    inner,
                    socket: Some(socket),
                },
                endpoint,
            ))
        }

        pub async fn accept(&mut self) -> io::Result<UnixStream> {
            self.inner.accept().await.map(|(stream, _)| stream)
        }
    }
}

#[cfg(windows)]
mod local {
    use super::*;
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

    pub struct Listener {
        name: String,
        pending: NamedPipeServer,
    }

    impl Listener {
        pub fn bind() -> io::Result<(Self, String)> {
            let name = format!(r"\\.\pipe\gams-rpc-{}", std::process::id());
            let pending = ServerOptions::new()
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .create(&name)?;
            Ok((
                Self {
                    name: name.clone(),
                    pending,
                },
                name,
            ))
        }

        pub async fn accept(&mut self) -> io::Result<NamedPipeServer> {
            self.pending.connect().await?;
            // Always leave a listening instance before handing off a client.
            let next = ServerOptions::new()
                .reject_remote_clients(true)
                .create(&self.name)?;
            Ok(std::mem::replace(&mut self.pending, next))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::Runtime;
    use serde_json::{json, Value};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    fn commands(root: &std::path::Path) -> Commands {
        Commands {
            runtime: Runtime::new_for_repl(root.to_path_buf(), vec![]).unwrap(),
            root: root.to_path_buf(),
            config_file: "gams.json".into(),
        }
    }

    #[cfg(unix)]
    async fn connect(endpoint: &str) -> tokio::net::UnixStream {
        tokio::net::UnixStream::connect(endpoint).await.unwrap()
    }

    #[cfg(windows)]
    async fn connect(endpoint: &str) -> tokio::net::windows::named_pipe::NamedPipeClient {
        use tokio::net::windows::named_pipe::ClientOptions;
        for _ in 0..500 {
            match ClientOptions::new().open(endpoint) {
                Ok(client) => return client,
                Err(error) if error.raw_os_error() == Some(231) => {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
                Err(error) => panic!("connect local pipe: {error}"),
            }
        }
        panic!("named pipe remained busy");
    }

    #[test]
    fn human_connections_use_the_same_commands_and_response_boundaries() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let root = tempfile::tempdir().unwrap();
            let (server, mut client) = tokio::io::duplex(4096);
            let task = tokio::spawn(serve(server, commands(root.path()), Format::Human));
            client.write_all(b"gams/host::plugins\ngams/host::missing\ngams/host::plugins\n").await.unwrap();
            client.shutdown().await.unwrap();
            let mut text = String::new();
            tokio::io::AsyncReadExt::read_to_string(&mut client, &mut text).await.unwrap();
            task.await.unwrap().unwrap();
            assert_eq!(text, concat!(
                "OK\n[]\n--- end ---\n",
                "ERROR\n\"Unknown GAMS command 'gams/host::missing'; use gams/host::help\"\n--- end ---\n",
                "OK\n[]\n--- end ---\n",
            ));
        });
    }

    #[test]
    fn clients_share_native_commands_and_recover_from_bad_calls() {
        let executor = tokio::runtime::Runtime::new().unwrap();
        executor.block_on(async {
            let root = tempfile::tempdir().unwrap();
            std::fs::write(
                root.path().join("counter.wat"),
                r#"(component
                (core module $m
                    (global $count (mut i32) (i32.const 0))
                    (func (export "next") (result i32)
                        global.get $count i32.const 1 i32.add global.set $count
                        global.get $count))
                (core instance $i (instantiate $m))
                (func (export "next") (result u32)
                    (canon lift (core func $i "next"))))"#,
            )
            .unwrap();
            let commands = commands(root.path());
            commands
                .invoke("gams/host::load-plugins", vec![json!(["counter.wat"])])
                .unwrap();
            assert_eq!(commands.invoke("next", vec![]).unwrap(), json!(1));
            let server = Server::start(commands.clone(), Format::Json).await.unwrap();
            assert!(Server::start(commands.clone(), Format::Json).await.is_err());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let path = std::path::Path::new(&server.endpoint);
                assert_eq!(
                    std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
                assert_eq!(
                    std::fs::metadata(path.parent().unwrap())
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o700
                );
            }
            // A caller with an unfinished line must not block other callers.
            let mut idle = connect(&server.endpoint).await;
            idle.write_all(b"gams/host::he").await.unwrap();
            let stream = connect(&server.endpoint).await;
            let (read, mut write) = tokio::io::split(stream);
            let mut lines = BufReader::new(read).lines();
            write
                .write_all(b"\nnext\nbad [\nunknown\nnext\ngams/host::help\n")
                .await
                .unwrap();
            let mut responses = Vec::new();
            for _ in 0..5 {
                let line =
                    tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
                        .await
                        .unwrap()
                        .unwrap()
                        .unwrap();
                responses.push(serde_json::from_str::<Value>(&line).unwrap());
            }
            assert_eq!(responses[0], json!({"ok":2}));
            assert!(responses[1]["error"]["message"].is_string());
            assert!(responses[2]["error"]["message"].is_string());
            assert_eq!(responses[3], json!({"ok":3}));
            assert_eq!(responses[4]["ok"].as_array().unwrap().len(), 9);
            let second = connect(&server.endpoint).await;
            let (read, mut write) = tokio::io::split(second);
            write.write_all(b"next\n").await.unwrap();
            let line = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                BufReader::new(read).lines().next_line(),
            )
            .await
            .unwrap()
            .unwrap()
            .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&line).unwrap(),
                json!({"ok":4})
            );
            drop(write);
            assert_eq!(commands.invoke("next", vec![]).unwrap(), json!(5));
            let endpoint = server.endpoint.clone();
            drop(server);
            #[cfg(unix)]
            assert!(!std::path::Path::new(&endpoint).exists());
            #[cfg(windows)]
            let _ = endpoint;
            match tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
                .await
                .unwrap()
            {
                Ok(None) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::BrokenPipe | io::ErrorKind::ConnectionReset
                    ) => {}
                other => panic!("server shutdown must close the connection: {other:?}"),
            }
        });
    }
}
