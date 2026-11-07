use crate::runtime::Runtime;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Serialize)]
struct Argument {
    name: &'static str,
    kind: &'static str,
    description: &'static str,
    optional: bool,
}

#[derive(Serialize)]
struct Command {
    name: &'static str,
    description: &'static str,
    arguments: &'static [Argument],
    result: &'static str,
}

const COMMANDS: &[Command] = &[
    Command {
        name: "gams/host::help",
        description: "List GAMS commands, or describe one command.",
        arguments: &[Argument {
            name: "command",
            kind: "string",
            description: "Command to describe; omit to list commands.",
            optional: true,
        }],
        result: "Command descriptions with ordered arguments and results.",
    },
    Command {
        name: "gams/host::load-plugins",
        description: "Load plugin files and their dependencies into this workspace.",
        arguments: &[Argument {
            name: "paths",
            kind: "array of strings",
            description: "Plugin files, relative to the Project directory or absolute.",
            optional: false,
        }],
        result: "Loaded plugins with paths, handles, imports and exports.",
    },
    Command {
        name: "gams/host::plugins",
        description: "List loaded plugins and their exports.",
        arguments: &[],
        result: "Array of loaded plugin descriptions.",
    },
    Command {
        name: "gams/host::diagnostics",
        description:
            "Inspect loaded plugins, exported operations, resources and plugin cache location.",
        arguments: &[],
        result: "Workspace diagnostics.",
    },
    Command {
        name: "gams/host::cache-plugin",
        description: "Compile and cache a plugin without loading it.",
        arguments: &[Argument {
            name: "path",
            kind: "string",
            description: "Plugin file, relative to the Project directory or absolute.",
            optional: false,
        }],
        result: "Compiled cache file path.",
    },
    Command {
        name: "gams/host::clear-cache",
        description: "Clear compiled plugin cache files without unloading plugins.",
        arguments: &[],
        result: "null on success.",
    },
    Command {
        name: "gams/host::release-resource",
        description: "Release a resource returned by a plugin in this workspace.",
        arguments: &[Argument {
            name: "resource",
            kind: "object",
            description: "The complete resource reference returned by the plugin.",
            optional: false,
        }],
        result: "null on success.",
    },
    Command {
        name: "gams/host::project-init",
        description: "Create the selected Project config without overwriting an existing file.",
        arguments: &[],
        result: "Created config file path.",
    },
    Command {
        name: "gams:shell/shell@1.0.0::run",
        description: "Run an operating-system shell command with this user's permissions.",
        arguments: &[
            Argument {
                name: "command",
                kind: "string",
                description: "Shell command executed in the Project directory.",
                optional: false,
            },
            Argument {
                name: "timeout-ms",
                kind: "unsigned integer",
                description: "Maximum execution time in milliseconds.",
                optional: false,
            },
        ],
        result: "Plugin-style result containing exit-code, stdout and stderr, or a shell error.",
    },
];

#[derive(Clone)]
pub struct Commands {
    pub runtime: Runtime,
    pub root: PathBuf,
    pub config_file: String,
}

impl Commands {
    pub fn invoke(&self, target: &str, args: Vec<Value>) -> Result<Value, String> {
        let Some(command) = COMMANDS.iter().find(|command| command.name == target) else {
            if target.starts_with("gams/host::") {
                return Err(format!(
                    "Unknown GAMS command '{target}'; use gams/host::help"
                ));
            }
            return self.runtime.invoke(target, Value::Array(args));
        };
        validate_arguments(command, &args)?;
        match target {
            "gams/host::help" => {
                if let Some(name) = args.first() {
                    let name = name.as_str().expect("validated command argument");
                    let command = COMMANDS
                        .iter()
                        .find(|command| command.name == name)
                        .ok_or_else(|| format!("Unknown GAMS command '{name}'"))?;
                    serde_json::to_value(command).map_err(|error| error.to_string())
                } else {
                    serde_json::to_value(COMMANDS).map_err(|error| error.to_string())
                }
            }
            "gams/host::load-plugins" => {
                let paths = args[0]
                    .as_array()
                    .expect("validated paths")
                    .iter()
                    .map(|path| self.path(path.as_str().expect("validated path")))
                    .collect();
                let handles = self.runtime.add_component_files(paths)?;
                serde_json::to_value(handles).map_err(|error| error.to_string())
            }
            "gams/host::plugins" => {
                let diagnostics = self.runtime.diagnostics()?;
                let components = diagnostics
                    .get("components")
                    .and_then(Value::as_array)
                    .expect("runtime diagnostics must contain components");
                Ok(json!(components))
            }
            "gams/host::diagnostics" => self.runtime.diagnostics(),
            "gams/host::cache-plugin" => {
                let path = self.path(args[0].as_str().expect("validated path"));
                Ok(json!(self.runtime.cache_component(path)?))
            }
            "gams/host::clear-cache" => {
                self.runtime.clear_compiled_component_cache()?;
                Ok(Value::Null)
            }
            "gams/host::release-resource" => {
                self.runtime.release_resource(args[0].clone())?;
                Ok(Value::Null)
            }
            "gams/host::project-init" => {
                let path = self.root.join(&self.config_file);
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .map_err(|error| format!("failed to create {}: {error}", path.display()))?;
                use std::io::Write;
                file.write_all(b"{}\n").map_err(|error| error.to_string())?;
                Ok(json!(path))
            }
            "gams:shell/shell@1.0.0::run" => self.runtime.invoke(target, Value::Array(args)),
            _ => unreachable!("every catalog command has a dispatcher"),
        }
    }

    fn path(&self, path: &str) -> PathBuf {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            path
        } else {
            self.root.join(path)
        }
    }
}

fn validate_arguments(command: &Command, args: &[Value]) -> Result<(), String> {
    let required = command
        .arguments
        .iter()
        .filter(|argument| !argument.optional)
        .count();
    if args.len() < required || args.len() > command.arguments.len() {
        return Err(format!(
            "{} expects {}..={} arguments, got {}",
            command.name,
            required,
            command.arguments.len(),
            args.len()
        ));
    }
    for (value, argument) in args.iter().zip(command.arguments) {
        let valid = match argument.kind {
            "string" => value.is_string(),
            "object" => value.is_object(),
            "unsigned integer" => value.as_u64().is_some(),
            "array of strings" => value.as_array().is_some_and(|values| {
                !values.is_empty()
                    && values
                        .iter()
                        .all(|value| value.as_str().is_some_and(|value| !value.is_empty()))
            }),
            _ => unreachable!("known catalog argument kind"),
        };
        if !valid {
            return Err(format!(
                "{} argument '{}' must be {}",
                command.name, argument.name, argument.kind
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_unique_and_validates_every_command() {
        let names: std::collections::BTreeSet<_> =
            COMMANDS.iter().map(|command| command.name).collect();
        assert_eq!(names.len(), COMMANDS.len());
        for command in COMMANDS {
            assert!(
                validate_arguments(command, &vec![Value::Null; command.arguments.len() + 1])
                    .is_err()
            );
            if command.arguments.iter().any(|argument| !argument.optional) {
                assert!(validate_arguments(command, &[]).is_err());
            } else {
                assert!(validate_arguments(command, &[]).is_ok());
            }
        }
    }

    #[test]
    fn host_commands_preserve_session_and_do_not_overwrite_config() {
        let root = tempfile::tempdir().unwrap();
        let runtime = Runtime::new_at(root.path().into(), vec![]).unwrap();
        let commands = Commands {
            runtime: runtime.clone(),
            root: root.path().into(),
            config_file: "dev.json".into(),
        };
        assert_eq!(
            commands
                .invoke("gams/host::help", vec![])
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            COMMANDS.len()
        );
        assert!(commands
            .invoke("gams/host::help", vec![json!("unknown")])
            .is_err());
        assert_eq!(
            commands.invoke("gams/host::plugins", vec![]).unwrap(),
            json!([])
        );
        assert_eq!(
            commands
                .invoke("gams:shell/shell@1.0.0::run", vec![json!(""), json!(0)])
                .unwrap()["err"]["case"],
            "timeout"
        );
        assert!(commands
            .invoke("gams/host::load-plugins", vec![json!([])])
            .is_err());
        assert!(commands
            .invoke("gams/host::load-plugins", vec![json!([false])])
            .is_err());
        assert!(commands
            .invoke("gams/host::diagnostics", vec![Value::Null])
            .is_err());
        commands.invoke("gams/host::project-init", vec![]).unwrap();
        std::fs::write(root.path().join("dev.json"), "{\"keep\":true}").unwrap();
        assert!(commands.invoke("gams/host::project-init", vec![]).is_err());
        assert_eq!(
            std::fs::read_to_string(root.path().join("dev.json")).unwrap(),
            "{\"keep\":true}"
        );
        assert!(commands
            .invoke("gams/host::missing", vec![])
            .unwrap_err()
            .contains("Unknown GAMS command"));
    }
    #[test]
    fn repl_loads_real_wasm_and_reuses_state_after_errors() {
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
        let runtime = Runtime::new_for_repl(root.path().into(), vec![]).unwrap();
        runtime
            .set_compiled_component_cache_dir(root.path().join("cache"))
            .unwrap();
        let commands = Commands {
            runtime: runtime.clone(),
            root: root.path().into(),
            config_file: "gams.json".into(),
        };
        let input = b"gams/host::load-plugins [\"counter.wat\"]\nnext\nnext\nmissing-operation\nnext\ngams/host::plugins\n";
        let mut output = Vec::new();
        crate::repl::run(
            &input[..],
            &mut output,
            crate::output::Format::Json,
            |target, args| commands.invoke(target, args),
        )
        .unwrap();
        let responses: Vec<Value> = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(responses.len(), 6);
        assert_eq!(responses[1], json!({"ok": 1}));
        assert_eq!(responses[2], json!({"ok": 2}));
        assert!(responses[3].get("error").is_some());
        assert_eq!(responses[4], json!({"ok": 3}));
        assert_eq!(responses[5]["ok"].as_array().unwrap().len(), 1);
        assert!(responses[5]["ok"][0]["exports"]
            .as_array()
            .unwrap()
            .contains(&json!("next")));
    }
}
