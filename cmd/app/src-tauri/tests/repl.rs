use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn gams(root: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_gams"));
    command.current_dir(root);
    for name in [
        "GAMS_RUNTIME",
        "GAMS_APP_CWD",
        "GAMS_CONFIG",
        "GAMS_MODULES_DIR",
        "GAMS_WASMTIME_CACHE_DIR",
        "GAMS_DEVTOOLS",
        "GAMS_RPC",
        "GAMS_LISTEN_ADDR",
    ] {
        command.env_remove(name);
    }
    command.env("GAMS_WASMTIME_CACHE_DIR", root.join("cache"));
    command
}

#[test]
fn headless_process_keeps_wasm_state_and_recovers_from_bad_requests() {
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
    let mut child = gams(root.path())
        .args(["--runtime", "terminal"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let input = b"gams/host::help\ngams/host::load-plugins [\"counter.wat\"]\nnext\nbad [\nnext\nunknown\nnext\n";
    child.stdin.take().unwrap().write_all(input).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let responses: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).expect("stdout must contain only JSON responses"))
        .collect();
    assert_eq!(responses.len(), 7);
    assert!(responses[0]["ok"]
        .as_array()
        .unwrap()
        .iter()
        .any(|command| command["name"] == "gams/host::load-plugins"));
    assert_eq!(responses[2], json!({"ok":1}));
    assert!(responses[3]["error"]["message"].is_string());
    assert_eq!(responses[4], json!({"ok":2}));
    assert!(responses[5]["error"]["message"].is_string());
    assert_eq!(responses[6], json!({"ok":3}));
}

#[test]
fn arguments_override_environment_and_eof_closes_the_process() {
    let root = tempfile::tempdir().unwrap();
    let output = gams(root.path())
        .env("GAMS_RUNTIME", "invalid")
        .env("GAMS_CONFIG", "../bad.json")
        .args(["--runtime", "terminal", "--config", "gams.json"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    let output = gams(root.path())
        .env("GAMS_RUNTIME", "terminal")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(output.status.success());
}

#[test]
fn unsupported_features_and_removed_subcommands_fail_before_opening_a_window() {
    let root = tempfile::tempdir().unwrap();
    for args in [
        vec!["run"],
        vec!["init"],
        vec!["serve"],
        vec!["add", "plugin", "file.wasm"],
        vec!["--runtime", "terminal", "--target", "anything"],
        vec!["--runtime", "server"],
        vec!["--runtime", "native", "--rpc"],
    ] {
        let output = gams(root.path())
            .args(&args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(!output.status.success(), "unexpected success for {args:?}");
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).starts_with("error:"));
    }
}
