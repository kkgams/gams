use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runtime {
    Native,
    Server,
    Terminal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub runtime: Runtime,
    pub listen: String,
    /// None preserves the default current-directory/native-picker behavior.
    pub project_dir: Option<PathBuf>,
    pub config: String,
    pub modules_dir: Option<PathBuf>,
    pub plugin_cache_dir: Option<PathBuf>,
    pub devtools: bool,
    pub rpc: bool,
}

impl Options {
    /// Parse arguments excluding the executable name. None requests help.
    /// Paths are not canonicalized or checked for existence. The caller resolves
    /// relative project/cache paths against the launch directory and applies
    /// runtime-specific defaults. Only selected environment values are validated.
    pub fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<OsString>,
    ) -> Result<Option<Self>, String> {
        let mut values = HashMap::new();
        let mut args = args.into_iter().peekable();
        while let Some(arg) = args.next() {
            if arg == "--help" || arg == "-h" {
                return Ok(None);
            }
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) => (name, Some(value.to_owned())),
                None => (arg.as_str(), None),
            };
            let boolean = match name {
                "--devtools" | "--rpc" => true,
                "--runtime" | "--project-dir" | "--config" | "--modules-dir"
                | "--plugin-cache-dir" | "--listen" => false,
                _ => return Err(format!("unknown startup argument: {arg}")),
            };
            if values.contains_key(name) {
                return Err(format!("{name} may only be specified once"));
            }
            let value = match inline {
                Some(value) => value,
                None if boolean && args.peek().map_or(true, |next| next.starts_with('-')) => {
                    "true".to_owned()
                }
                None => match args.next() {
                    Some(value) if !value.starts_with("--") && value != "-h" => value,
                    _ => return Err(format!("{name} requires a value")),
                },
            };
            values.insert(name.to_owned(), value);
        }
        let selected = |arg: &str, variable: &str| -> Result<Option<String>, String> {
            if let Some(value) = values.get(arg) {
                return Ok(Some(value.clone()));
            }
            env(variable)
                .map(|value| {
                    value
                        .into_string()
                        .map_err(|_| format!("{variable} must be valid UTF-8"))
                })
                .transpose()
        };
        let runtime = match selected("--runtime", "GAMS_RUNTIME")?.as_deref() {
            None | Some("native") => Runtime::Native,
            Some("server") => Runtime::Server,
            Some("terminal") => Runtime::Terminal,
            Some(value) => {
                return Err(format!(
                    "invalid runtime {value:?}; expected native, server or terminal"
                ))
            }
        };
        let listen = selected("--listen", "GAMS_LISTEN_ADDR")?;
        if runtime != Runtime::Server && listen.is_some() {
            return Err(
                "--listen / GAMS_LISTEN_ADDR is only available in the server runtime".to_owned(),
            );
        }
        let listen = listen.unwrap_or_else(|| "127.0.0.1:8080".to_owned());
        validate_listen(&listen)?;
        let config = selected("--config", "GAMS_CONFIG")?;
        let config = crate::project::config_file(config.as_deref().map(OsStr::new))
            .map_err(|error| error.to_string())?;
        let project_dir = parse_path(
            selected("--project-dir", "GAMS_APP_CWD")?,
            "--project-dir / GAMS_APP_CWD",
            false,
        )?;
        let modules_dir = parse_path(
            selected("--modules-dir", "GAMS_MODULES_DIR")?,
            "--modules-dir / GAMS_MODULES_DIR",
            true,
        )?;
        let plugin_cache_dir = parse_path(
            selected("--plugin-cache-dir", "GAMS_WASMTIME_CACHE_DIR")?,
            "--plugin-cache-dir / GAMS_WASMTIME_CACHE_DIR",
            false,
        )?;
        let devtools = parse_bool(
            selected("--devtools", "GAMS_DEVTOOLS")?,
            "--devtools / GAMS_DEVTOOLS",
        )?;
        let rpc = parse_bool(selected("--rpc", "GAMS_RPC")?, "--rpc / GAMS_RPC")?;
        if runtime != Runtime::Native && (devtools || rpc) {
            return Err(
                "--devtools and --rpc may only be enabled in the native runtime".to_owned(),
            );
        }
        Ok(Some(Self {
            runtime,
            listen,
            project_dir,
            config,
            modules_dir,
            plugin_cache_dir,
            devtools,
            rpc,
        }))
    }
}

fn parse_path(
    value: Option<String>,
    name: &str,
    absolute: bool,
) -> Result<Option<PathBuf>, String> {
    value
        .map(|value| {
            if value.is_empty() || value.contains('\0') {
                return Err(format!(
                    "{name} must be a non-empty directory path without NUL bytes"
                ));
            }
            let path = PathBuf::from(value);
            if absolute && !path.is_absolute() {
                return Err(format!("{name} must be an absolute directory path"));
            }
            Ok(path)
        })
        .transpose()
}

fn validate_listen(value: &str) -> Result<(), String> {
    let valid = value.rsplit_once(':').is_some_and(|(host, port)| {
        let host_valid = if host.starts_with('[') && host.ends_with(']') {
            host[1..host.len() - 1]
                .parse::<std::net::Ipv6Addr>()
                .is_ok()
        } else {
            !host.is_empty()
                && host
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        };
        host_valid
            && !port.is_empty()
            && port.bytes().all(|byte| byte.is_ascii_digit())
            && port.parse::<u16>().is_ok()
    });
    if valid {
        Ok(())
    } else {
        Err("--listen / GAMS_LISTEN_ADDR must be host:port (port 0-65535)".to_owned())
    }
}

fn parse_bool(value: Option<String>, name: &str) -> Result<bool, String> {
    match value.as_deref() {
        None | Some("false") => Ok(false),
        Some("true") => Ok(true),
        Some(_) => Err(format!("{name} must be true or false")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(args: &[&str], env: &[(&str, &str)]) -> Result<Option<Options>, String> {
        Options::parse(args.iter().map(|arg| (*arg).to_owned()), |name| {
            env.iter()
                .find_map(|(key, value)| (*key == name).then(|| OsString::from(value)))
        })
    }
    fn options(args: &[&str], env: &[(&str, &str)]) -> Options {
        parse(args, env).unwrap().unwrap()
    }
    fn absolute_path() -> String {
        std::env::temp_dir()
            .join("gams-options-units")
            .to_str()
            .unwrap()
            .to_owned()
    }
    #[test]
    fn defaults_preserve_picker_and_caller_owned_paths() {
        let result = options(&[], &[]);
        assert_eq!(result.runtime, Runtime::Native);
        assert_eq!(result.project_dir, None);
        assert_eq!(result.config, "gams.json");
        assert_eq!(result.modules_dir, None);
        assert_eq!(result.plugin_cache_dir, None);
        assert!(!result.devtools && !result.rpc);
    }
    #[test]
    fn selects_each_runtime_from_both_sources() {
        for (name, runtime) in [
            ("native", Runtime::Native),
            ("server", Runtime::Server),
            ("terminal", Runtime::Terminal),
        ] {
            assert_eq!(options(&["--runtime", name], &[]).runtime, runtime);
            assert_eq!(
                options(&[&format!("--runtime={name}")], &[]).runtime,
                runtime
            );
            assert_eq!(options(&[], &[("GAMS_RUNTIME", name)]).runtime, runtime);
        }
    }
    #[test]
    fn parses_all_environment_settings() {
        let absolute = absolute_path();
        let result = options(
            &[],
            &[
                ("GAMS_APP_CWD", "relative/project"),
                ("GAMS_CONFIG", "dev config.json"),
                ("GAMS_MODULES_DIR", &absolute),
                ("GAMS_WASMTIME_CACHE_DIR", "relative/cache"),
                ("GAMS_DEVTOOLS", "true"),
                ("GAMS_RPC", "true"),
            ],
        );
        assert_eq!(result.project_dir, Some(PathBuf::from("relative/project")));
        assert_eq!(result.config, "dev config.json");
        assert_eq!(result.modules_dir, Some(PathBuf::from(absolute)));
        assert_eq!(
            result.plugin_cache_dir,
            Some(PathBuf::from("relative/cache"))
        );
        assert!(result.devtools && result.rpc);
    }
    #[test]
    fn arguments_override_matching_invalid_environment_values() {
        let absolute = absolute_path();
        let result = options(
            &[
                "--runtime=native",
                "--project-dir=chosen",
                "--config=chosen.json",
                &format!("--modules-dir={absolute}"),
                "--plugin-cache-dir=cache",
                "--devtools=false",
                "--rpc=false",
            ],
            &[
                ("GAMS_RUNTIME", "invalid"),
                ("GAMS_APP_CWD", ""),
                ("GAMS_CONFIG", "../bad"),
                ("GAMS_MODULES_DIR", "relative"),
                ("GAMS_WASMTIME_CACHE_DIR", ""),
                ("GAMS_DEVTOOLS", "invalid"),
                ("GAMS_RPC", "true"),
            ],
        );
        assert_eq!(result.project_dir, Some(PathBuf::from("chosen")));
        assert_eq!(result.config, "chosen.json");
        assert_eq!(result.modules_dir, Some(PathBuf::from(absolute)));
        assert!(!result.devtools && !result.rpc);
        assert_eq!(
            options(&["--runtime=native"], &[("GAMS_CONFIG", "env.json")]).config,
            "env.json"
        );
    }
    #[test]
    fn keeps_relative_nonexistent_paths_without_filesystem_access() {
        let result = options(
            &[
                "--project-dir",
                "missing project/../project",
                "--plugin-cache-dir",
                "missing cache",
            ],
            &[],
        );
        assert_eq!(
            result.project_dir,
            Some(PathBuf::from("missing project/../project"))
        );
        assert_eq!(
            result.plugin_cache_dir,
            Some(PathBuf::from("missing cache"))
        );
    }
    #[test]
    fn accepts_bare_and_explicit_boolean_forms() {
        let result = options(&["--devtools", "--rpc"], &[]);
        assert!(result.devtools && result.rpc);
        for name in ["--devtools", "--rpc"] {
            for value in ["true", "false"] {
                for args in [
                    vec![name.to_owned(), value.to_owned()],
                    vec![format!("{name}={value}")],
                ] {
                    let result = Options::parse(args, |_| None).unwrap().unwrap();
                    assert_eq!(
                        if name == "--rpc" {
                            result.rpc
                        } else {
                            result.devtools
                        },
                        value == "true"
                    );
                }
            }
        }
    }
    #[test]
    fn rejects_non_strict_booleans_in_both_sources() {
        for (arg, env) in [("--devtools", "GAMS_DEVTOOLS"), ("--rpc", "GAMS_RPC")] {
            for value in ["", "1", "0", "TRUE", "False", "yes", " false "] {
                assert!(
                    parse(&[&format!("{arg}={value}")], &[]).is_err(),
                    "{arg}={value:?}"
                );
                assert!(parse(&[], &[(env, value)]).is_err(), "{env}={value:?}");
            }
        }
    }
    #[test]
    fn rejects_native_features_elsewhere_but_allows_explicit_false() {
        for runtime in ["server", "terminal"] {
            let selector = format!("--runtime={runtime}");
            for (arg, env) in [("--devtools", "GAMS_DEVTOOLS"), ("--rpc", "GAMS_RPC")] {
                assert!(parse(&[&selector, arg], &[]).is_err());
                assert!(parse(&[&selector], &[(env, "true")]).is_err());
                assert!(parse(&[&selector, &format!("{arg}=false")], &[(env, "true")]).is_ok());
            }
            assert!(parse(&[&selector], &[]).is_ok());
        }
    }
    #[test]
    fn rejects_repeated_options_even_when_values_agree() {
        let absolute = absolute_path();
        for (arg, value) in [
            ("--runtime", "native"),
            ("--project-dir", "project"),
            ("--config", "gams.json"),
            ("--modules-dir", absolute.as_str()),
            ("--plugin-cache-dir", "cache"),
            ("--devtools", "true"),
            ("--rpc", "false"),
            ("--listen", "localhost:8080"),
        ] {
            let error = parse(&[arg, value, &format!("{arg}={value}")], &[]).unwrap_err();
            assert!(error.contains("only be specified once"), "{error}");
        }
    }
    #[test]
    fn rejects_missing_required_values() {
        for arg in [
            "--runtime",
            "--project-dir",
            "--config",
            "--modules-dir",
            "--plugin-cache-dir",
            "--listen",
        ] {
            assert!(parse(&[arg], &[]).is_err(), "{arg}");
            assert!(parse(&[arg, "--rpc"], &[]).is_err(), "{arg}");
            assert!(parse(&[arg, "-h"], &[]).is_err(), "{arg}");
        }
    }
    #[test]
    fn rejects_unknown_modes_subcommands_and_legacy_arguments() {
        for arg in [
            "native",
            "server",
            "terminal",
            "run",
            "cli",
            "--plug",
            "--target",
            "--args",
            "--args-file",
            "--plugins",
            "--unknown",
            "--",
            "-x",
            "--help=true",
        ] {
            assert!(parse(&[arg], &[]).is_err(), "{arg}");
        }
        for value in ["", "web", "rpc", "repl", "Native", " native "] {
            assert!(parse(&["--runtime", value], &[]).is_err(), "{value:?}");
            assert!(parse(&[], &[("GAMS_RUNTIME", value)]).is_err(), "{value:?}");
        }
    }
    #[test]
    fn rejects_empty_and_nul_paths_from_both_sources() {
        for (arg, variable) in [
            ("--project-dir", "GAMS_APP_CWD"),
            ("--modules-dir", "GAMS_MODULES_DIR"),
            ("--plugin-cache-dir", "GAMS_WASMTIME_CACHE_DIR"),
        ] {
            for value in ["", "bad\0path"] {
                assert!(parse(&[arg, value], &[]).is_err(), "{arg}");
                assert!(parse(&[], &[(variable, value)]).is_err(), "{variable}");
            }
        }
    }
    #[test]
    fn requires_absolute_modules_but_keeps_relative_project_and_cache() {
        for value in ["relative", ".", "../units"] {
            assert!(parse(&["--modules-dir", value], &[]).is_err());
            assert!(parse(&[], &[("GAMS_MODULES_DIR", value)]).is_err());
            assert!(parse(&["--project-dir", value, "--plugin-cache-dir", value], &[]).is_ok());
        }
    }
    #[test]
    fn delegates_config_filename_validation_without_fallback() {
        for value in [
            "",
            ".",
            "..",
            "../dev.json",
            "dir/dev.json",
            "dir\\dev.json",
            "bad\0.json",
        ] {
            assert!(parse(&["--config", value], &[]).is_err(), "{value:?}");
            assert!(parse(&[], &[("GAMS_CONFIG", value)]).is_err(), "{value:?}");
        }
    }
    #[test]
    fn help_returns_before_environment_lookup() {
        for arg in ["--help", "-h"] {
            assert_eq!(
                Options::parse([arg.to_owned()], |_| panic!(
                    "help must not read environment"
                ))
                .unwrap(),
                None
            );
        }
    }
    #[test]
    fn ignores_retired_and_unrelated_environment_variables() {
        assert_eq!(
            options(
                &[],
                &[
                    ("GAMS_PLUGINS", "old"),
                    ("GAMS_TARGET", "old"),
                    ("GAMS_ARGS", "old"),
                    ("GAMS_ARGS_FILE", "old"),
                    ("OTHER", ""),
                ]
            ),
            options(&[], &[])
        );
    }
    #[test]
    fn validates_listen_without_resolving_hosts() {
        assert_eq!(options(&[], &[]).listen, "127.0.0.1:8080");
        for value in [
            "localhost:8081",
            "example.invalid:0",
            "[::1]:65535",
            "0.0.0.0:80",
        ] {
            assert_eq!(
                options(&["--runtime=server", "--listen", value], &[]).listen,
                value
            );
            assert_eq!(
                options(&["--runtime=server"], &[("GAMS_LISTEN_ADDR", value)]).listen,
                value
            );
        }
        for value in [
            "",
            "localhost",
            ":80",
            "localhost:",
            "localhost:65536",
            "localhost:-1",
            "localhost:+1",
            "localhost: 1",
            "::1:80",
            "[invalid]:80",
            "bad host:80",
        ] {
            assert!(
                parse(&["--runtime=server", "--listen", value], &[]).is_err(),
                "{value:?}"
            );
            assert!(
                parse(&["--runtime=server"], &[("GAMS_LISTEN_ADDR", value)]).is_err(),
                "{value:?}"
            );
        }
        assert_eq!(
            options(
                &["--runtime=server", "--listen=localhost:8081"],
                &[("GAMS_LISTEN_ADDR", "bad")]
            )
            .listen,
            "localhost:8081"
        );
    }
    #[test]
    fn rejects_explicit_listen_outside_server() {
        for runtime in ["native", "terminal"] {
            let selector = format!("--runtime={runtime}");
            assert!(parse(&[&selector, "--listen=localhost:8080"], &[]).is_err());
            assert!(parse(&[&selector], &[("GAMS_LISTEN_ADDR", "localhost:8080")]).is_err());
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn rejects_selected_non_unicode_environment_but_ignores_overrides() {
        fn invalid_unicode() -> OsString {
            #[cfg(unix)]
            {
                use std::os::unix::ffi::OsStringExt;
                OsString::from_vec(vec![0xff])
            }
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStringExt;
                OsString::from_wide(&[0xd800])
            }
        }
        let absolute = absolute_path();
        for (arg, variable, value) in [
            ("--runtime", "GAMS_RUNTIME", "native"),
            ("--project-dir", "GAMS_APP_CWD", "project"),
            ("--config", "GAMS_CONFIG", "gams.json"),
            ("--modules-dir", "GAMS_MODULES_DIR", absolute.as_str()),
            ("--plugin-cache-dir", "GAMS_WASMTIME_CACHE_DIR", "cache"),
            ("--devtools", "GAMS_DEVTOOLS", "false"),
            ("--rpc", "GAMS_RPC", "false"),
            ("--listen", "GAMS_LISTEN_ADDR", "localhost:8080"),
        ] {
            let env = |name: &str| (name == variable).then(invalid_unicode);
            assert!(
                Options::parse(Vec::new(), env)
                    .unwrap_err()
                    .contains("UTF-8"),
                "{variable}"
            );
            let args = if arg == "--listen" {
                vec![
                    "--runtime=server".to_owned(),
                    arg.to_owned(),
                    value.to_owned(),
                ]
            } else {
                vec![arg.to_owned(), value.to_owned()]
            };
            assert!(Options::parse(args, env).is_ok(), "{variable}");
        }
    }
}
