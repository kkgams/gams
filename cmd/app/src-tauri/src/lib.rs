mod commands;
mod download;
mod options;
mod project;
mod repl;
mod rpc;
mod runtime;

use std::path::{Path, PathBuf};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn runtime_console(level: String, message: String) -> Result<(), String> {
    match level.as_str() {
        "log" | "info" | "debug" => println!("[webview:{level}] {message}"),
        "warn" | "error" => eprintln!("[webview:{level}] {message}"),
        _ => return Err(format!("Unknown console level: {level}")),
    }
    Ok(())
}

#[tauri::command]
fn runtime_project(project: tauri::State<'_, project::Project>) -> project::Project {
    project.inner().clone()
}

#[tauri::command]
async fn runtime_download(
    url: String,
    on_progress: tauri::ipc::Channel<download::DownloadProgress>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = download::fetch_bytes(&url, |event| {
        on_progress.send(event).map_err(anyhow::Error::from)
    })
    .await
    .map_err(|error| format!("{error:#}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn runtime_load_from_bytes(
    bytes: Vec<u8>,
    path: String,
    runtime: tauri::State<'_, runtime::Runtime>,
) -> Result<runtime::ComponentHandle, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.load_from_bytes(bytes, path))
        .await
        .map_err(|error| format!("runtime byte loading task failed: {error}"))?
}

#[tauri::command]
async fn runtime_add_plugins(
    paths: Vec<String>,
    reload: bool,
    runtime: tauri::State<'_, runtime::Runtime>,
) -> Result<Vec<runtime::ComponentHandle>, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.add_plugins(paths, reload))
        .await
        .map_err(|error| format!("runtime add plugins task failed: {error}"))?
}

#[tauri::command]
async fn runtime_invoke(
    target: String,
    args: serde_json::Value,
    commands: tauri::State<'_, commands::Commands>,
) -> Result<serde_json::Value, String> {
    let commands = commands.inner().clone();
    let args = args
        .as_array()
        .ok_or("runtime arguments must be an array")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || commands.invoke(&target, args))
        .await
        .map_err(|error| format!("runtime invoke task failed: {error}"))?
}

#[tauri::command]
fn runtime_diagnostics(
    runtime: tauri::State<'_, runtime::Runtime>,
) -> Result<serde_json::Value, String> {
    runtime.diagnostics()
}

#[tauri::command]
async fn runtime_release_resource(
    resource: serde_json::Value,
    runtime: tauri::State<'_, runtime::Runtime>,
) -> Result<(), String> {
    // Wasmtime calls and resource destruction share a mutex. Never wait for
    // an in-flight component call on the native event loop.
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.release_resource(resource))
        .await
        .map_err(|error| format!("runtime resource release task failed: {error}"))?
}

#[tauri::command]
fn runtime_call_view_ready(runtime: tauri::State<'_, runtime::Runtime>) -> Result<(), String> {
    runtime.mark_call_view_ready()
}

#[tauri::command]
fn runtime_call_view_response(
    id: String,
    ok: Option<String>,
    err: Option<String>,
    runtime: tauri::State<'_, runtime::Runtime>,
) -> Result<(), String> {
    runtime.respond_to_call_view(id, ok, err)
}

#[tauri::command]
fn runtime_clear_compiled_component_cache(
    runtime: tauri::State<'_, runtime::Runtime>,
) -> Result<(), String> {
    runtime.clear_compiled_component_cache()
}

fn needs_project_picker(gui: bool, cwd: &Path, config_file: &str) -> bool {
    gui && !cwd.join(config_file).is_file()
}

#[cfg(target_os = "macos")]
fn choose_project_folder(config_file: &str) -> anyhow::Result<Option<PathBuf>> {
    use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::{MainThreadMarker, NSString};
    use std::ffi::{CStr, OsStr};
    use std::os::unix::ffi::OsStrExt;

    let mtm = MainThreadMarker::new().expect("Project selection must run on the macOS main thread");
    let mut message = format!("Select a GAMS Project folder containing {config_file}");
    loop {
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setCanChooseDirectories(true);
        panel.setCanChooseFiles(false);
        panel.setAllowsMultipleSelection(false);
        panel.setMessage(Some(&NSString::from_str(&message)));
        match panel.runModal() {
            response if response == NSModalResponseCancel => return Ok(None),
            response if response == NSModalResponseOK => {
                let url = panel.URL().expect("Selected Project has no file URL");
                anyhow::ensure!(url.isFileURL(), "Selected Project must be a local folder");
                // NSURL retains this filesystem representation for its lifetime.
                let bytes =
                    unsafe { CStr::from_ptr(url.fileSystemRepresentation().as_ptr()) }.to_bytes();
                let path = PathBuf::from(OsStr::from_bytes(bytes));
                if path.join(config_file).is_file() {
                    return Ok(Some(path.canonicalize()?));
                }
                message =
                    format!("That folder has no {config_file}. Select a GAMS Project folder.");
            }
            response => anyhow::bail!("Project folder dialog failed: {response}"),
        }
    }
}

fn runtime_root(
    gui: bool,
    config_file: &str,
    override_dir: Option<&Path>,
) -> anyhow::Result<Option<PathBuf>> {
    if let Some(path) = override_dir {
        return Ok(Some(path.canonicalize()?));
    }
    let cwd = std::env::current_dir()?;
    if needs_project_picker(gui, &cwd, config_file) {
        #[cfg(target_os = "macos")]
        {
            return choose_project_folder(config_file);
        }
        #[cfg(not(target_os = "macos"))]
        anyhow::bail!(
            "Set --project-dir or GAMS_APP_CWD to a Project folder containing {config_file}"
        );
    }
    Ok(Some(cwd.canonicalize()?))
}

fn preopens_for_root(root: &Path) -> anyhow::Result<Vec<runtime::FsPreopen>> {
    let mut preopens = vec![
        runtime::FsPreopen {
            host_path: root.to_path_buf(),
            guest_path: ".".to_string(),
        },
        runtime::FsPreopen {
            host_path: root.to_path_buf(),
            guest_path: root.to_string_lossy().into_owned(),
        },
    ];

    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_symlink() {
            continue;
        }
        let target = entry.path().canonicalize()?;
        if target.is_dir() {
            preopens.push(runtime::FsPreopen {
                host_path: target,
                guest_path: entry.file_name().to_string_lossy().into_owned(),
            });
        }
    }

    Ok(preopens)
}

const STARTUP_HELP: &str = "GAMS startup options (argument / environment variable)
  --runtime native|server|repl   GAMS_RUNTIME (default: native)
  --project-dir PATH                GAMS_APP_CWD
  --config FILENAME                 GAMS_CONFIG (default: gams.json)
  --modules-dir ABSOLUTE_PATH       GAMS_MODULES_DIR
  --plugin-cache-dir PATH           GAMS_WASMTIME_CACHE_DIR
  --devtools[=true|false]           GAMS_DEVTOOLS (Native only; default: false)
  --rpc[=true|false]                GAMS_RPC (Native only; default: false)
  --listen HOST:PORT                GAMS_LISTEN_ADDR (WebServer only)
  --help

REPL: gams --runtime repl
Send gams/host::help on stdin to list GAMS commands.
";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = try_run() {
        if let Err(console_error) = attach_parent_console() {
            eprintln!("error attaching console: {console_error}");
        }
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}

fn try_run() -> anyhow::Result<()> {
    let args = std::env::args_os()
        .skip(1)
        .map(|value| {
            value
                .into_string()
                .map_err(|_| anyhow::anyhow!("startup arguments must be valid UTF-8"))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let options =
        options::Options::parse(args, |key| std::env::var_os(key)).map_err(anyhow::Error::msg)?;
    let Some(options) = options else {
        attach_parent_console()?;
        println!("{STARTUP_HELP}");
        return Ok(());
    };
    if options.runtime == options::Runtime::Server {
        anyhow::bail!("WebServer execution is not implemented");
    }
    if options.runtime == options::Runtime::Native {
        return run_native(options);
    }
    attach_parent_console()?;
    let root = runtime_root(false, &options.config, options.project_dir.as_deref())?
        .ok_or_else(|| anyhow::anyhow!("REPL Project directory is missing"))?;
    run_repl(&options, root)
}

fn attach_parent_console() -> std::io::Result<()> {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn AttachConsole(process_id: u32) -> i32;
        }
        // SAFETY: ATTACH_PARENT_PROCESS has no pointer arguments. This attaches
        // to an existing console only; Native never allocates a console window.
        if unsafe { AttachConsole(u32::MAX) } == 0 {
            let error = std::io::Error::last_os_error();
            match error.raw_os_error() {
                // Already attached, or parent has no console (e.g. a pipe-owning agent).
                Some(5 | 6 | 87) => {}
                _ => return Err(error),
            }
        }
    }
    Ok(())
}

fn run_repl(options: &options::Options, root: PathBuf) -> anyhow::Result<()> {
    let mut preopens = preopens_for_root(&root)?;
    if let Some(path) = &options.modules_dir {
        std::fs::create_dir_all(path)?;
        let path = path.canonicalize()?;
        preopens.push(runtime::FsPreopen {
            guest_path: path.to_string_lossy().into_owned(),
            host_path: path,
        });
    }
    let runtime = runtime::Runtime::new_for_repl(root.clone(), preopens)?;
    let cache_dir = match &options.plugin_cache_dir {
        Some(path) => path.clone(),
        None => {
            let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json"))?;
            dirs::cache_dir()
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "GAMS application cache directory is unavailable; set --plugin-cache-dir"
                    )
                })?
                .join(config.identifier)
                .join("wasmtime-components")
        }
    };
    runtime
        .set_compiled_component_cache_dir(cache_dir)
        .map_err(anyhow::Error::msg)?;
    let commands = commands::Commands {
        runtime,
        root,
        config_file: options.config.clone(),
    };
    use std::io::IsTerminal;
    if std::io::stdin().is_terminal() {
        eprintln!("GAMS REPL. Enter gams/host::help to list commands; close stdin to exit.");
    }
    repl::run(
        std::io::stdin().lock(),
        std::io::stdout().lock(),
        |target, args| commands.invoke(target, args),
    )?;
    Ok(())
}

fn run_native(options: options::Options) -> anyhow::Result<()> {
    let rpc_server = std::sync::Arc::new(std::sync::Mutex::new(None));
    let startup_rpc_server = rpc_server.clone();
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_fps::init());

    let app = builder
        .setup(move |app| {
            let Some(root) = runtime_root(true, &options.config, options.project_dir.as_deref())?
            else {
                std::process::exit(0); // Normal native Project-picker cancellation.
            };
            let mut preopens = preopens_for_root(&root)?;
            let project = project::Project::load(
                &root,
                options
                    .modules_dir
                    .as_deref()
                    .map(std::path::Path::as_os_str),
                &options.config,
            )?;
            preopens.push(runtime::FsPreopen {
                host_path: project.modules_dir.clone(),
                guest_path: project.modules_dir.to_string_lossy().into_owned(),
            });
            app.manage(project);
            let runtime = runtime::Runtime::new_at(root.clone(), preopens)?;
            runtime.attach_app_handle(app.handle().clone())?;
            let cache_dir = match &options.plugin_cache_dir {
                Some(path) => path.clone(),
                None => app.path().app_cache_dir()?.join("wasmtime-components"),
            };
            runtime.set_compiled_component_cache_dir(cache_dir)?;
            let commands = commands::Commands {
                runtime: runtime.clone(),
                root: root.clone(),
                config_file: options.config.clone(),
            };
            assert!(
                app.manage(commands.clone()),
                "GAMS commands must not already be registered"
            );
            assert!(
                app.manage(runtime),
                "GAMS runtime must not already be registered"
            );

            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
            #[cfg(debug_assertions)]
            let window = window.initialization_script(include_str!("dev-console.js"));
            window
                .title("GAMS")
                .inner_size(1000.0, 700.0)
                .devtools(options.devtools)
                .build()?;
            if options.rpc {
                let server = tauri::async_runtime::block_on(rpc::Server::start(commands))?;
                eprintln!("GAMS RPC: {}", server.endpoint);
                *startup_rpc_server
                    .lock()
                    .expect("RPC startup lock poisoned") = Some(server);
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            runtime_console,
            runtime_project,
            runtime_download,
            runtime_load_from_bytes,
            runtime_add_plugins,
            runtime_invoke,
            runtime_diagnostics,
            runtime_release_resource,
            runtime_call_view_ready,
            runtime_call_view_response,
            runtime_clear_compiled_component_cache,
        ])
        .build(tauri::generate_context!())?;
    app.run(move |_, event| {
        // Tauri can exit the process directly: cleanup must run in its Exit
        // callback, not in code after the native event loop.
        if matches!(event, tauri::RunEvent::Exit) {
            drop(
                rpc_server
                    .lock()
                    .expect("RPC shutdown lock poisoned")
                    .take(),
            );
        }
    });
    Ok(())
}

#[cfg(test)]
mod launch_tests {
    use super::*;

    #[test]
    fn gui_without_a_project_must_prompt_instead_of_using_finder_working_directory() {
        let directory = tempfile::tempdir().unwrap();
        assert!(needs_project_picker(true, directory.path(), "gams.json"));
        assert!(!needs_project_picker(false, directory.path(), "gams.json"));
        std::fs::write(directory.path().join("gams.json"), "{}").unwrap();
        assert!(!needs_project_picker(true, directory.path(), "gams.json"));
        assert!(needs_project_picker(true, directory.path(), "dev.json"));
        std::fs::write(directory.path().join("dev.json"), "{}").unwrap();
        assert!(!needs_project_picker(true, directory.path(), "dev.json"));
    }
}
