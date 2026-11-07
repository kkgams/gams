use std::io::{self, BufRead, Write};

use serde_json::Value;

#[derive(Debug, PartialEq)]
pub struct Call {
    pub target: String,
    pub args: Vec<Value>,
}

/// Parse one physical request line. Bare text is never expanded or evaluated.
pub fn parse(line: &str) -> Result<Call, String> {
    let line = line.trim();
    if line.is_empty() {
        return Err("Expected an operation".into());
    }
    let target_end = line.find(char::is_whitespace).unwrap_or(line.len());
    let target = &line[..target_end];
    if target.contains('"') {
        return Err("Operation must be bare text".into());
    }
    let mut rest = line[target_end..].trim_start();
    let mut args = Vec::new();
    while !rest.is_empty() {
        let (value, consumed) = if rest.starts_with(['"', '[', '{']) {
            let mut values = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
            let value = values
                .next()
                .expect("nonempty JSON argument")
                .map_err(|error| format!("Invalid JSON argument: {error}"))?;
            (value, values.byte_offset())
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let token = &rest[..end];
            if token.contains('"') {
                return Err("JSON and bare arguments must be separated by whitespace".into());
            }
            let value = match serde_json::from_str::<Value>(token) {
                Ok(value @ (Value::Number(_) | Value::Bool(_) | Value::Null)) => value,
                _ => Value::String(token.into()),
            };
            (value, end)
        };
        rest = &rest[consumed..];
        if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
            return Err("Arguments must be separated by whitespace".into());
        }
        args.push(value);
        rest = rest.trim_start();
    }
    Ok(Call {
        target: target.into(),
        args,
    })
}

pub fn response(result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => serde_json::json!({ "ok": value }),
        Err(message) => serde_json::json!({ "error": { "message": message } }),
    }
}

/// Flush one compact JSON response per nonempty physical input line until EOF.
/// Request errors continue the session; I/O errors end it. The caller owns state.
pub fn run(
    mut reader: impl BufRead,
    mut writer: impl Write,
    mut invoke: impl FnMut(&str, Vec<Value>) -> Result<Value, String>,
) -> io::Result<()> {
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        if line.trim().is_empty() {
            continue;
        }
        let result = parse(&line).and_then(|call| invoke(&call.target, call.args));
        let response = response(result);
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    #[test]
    fn parses_strings_with_unicode_and_json_escaping() {
        let call = parse(r#"fs/fs::read-text README.md "project notes/雪.txt" "quote: \" slash: \\ newline: \n" "\u96ea\ud83d\ude80" """#).unwrap();
        assert_eq!(call.target, "fs/fs::read-text");
        assert_eq!(
            call.args,
            vec![
                json!("README.md"),
                json!("project notes/雪.txt"),
                json!("quote: \" slash: \\ newline: \n"),
                json!("雪🚀"),
                json!("")
            ]
        );
    }

    #[test]
    fn parses_nested_structures_as_single_arguments() {
        let call = parse(r#"call [1, {"two": [true, null, "a } ] b"]}] { "name": "with spaces", "nested": {"x": []} } tail"#).unwrap();
        assert_eq!(
            call.args,
            vec![
                json!([1, {"two": [true, null, "a } ] b"]}]),
                json!({"name": "with spaces", "nested": {"x": []}}),
                json!("tail")
            ]
        );
    }

    #[test]
    fn recognizes_only_standard_json_scalars() {
        assert_eq!(parse(r#"call 0 -12 1.25 2e3 true false null "12" "true" "null" 01 +1 .5 NaN TRUE undefined"#).unwrap().args,
            vec![json!(0), json!(-12), json!(1.25), json!(2000.0), json!(true), json!(false), Value::Null,
                json!("12"), json!("true"), json!("null"), json!("01"), json!("+1"), json!(".5"), json!("NaN"), json!("TRUE"), json!("undefined")]);
    }

    #[test]
    fn accepts_whitespace_and_no_arguments() {
        assert_eq!(
            parse(" \tcall\r\n").unwrap(),
            Call {
                target: "call".into(),
                args: vec![]
            }
        );
        assert_eq!(
            parse("call\t[]\u{2003}雪\r\n").unwrap().args,
            vec![json!([]), json!("雪")]
        );
        assert!(parse(" \t\r\n").is_err());
    }

    #[test]
    fn rejects_malformed_json_and_concatenated_arguments() {
        for input in [
            "call [",
            "call {",
            "call \"",
            "call [1,]",
            "call {bad: 1}",
            r#"call "bad\q""#,
            r#"call "\ud800""#,
            "call [true false]",
            "call []tail",
            "call {}[]",
            r#"call "a""b""#,
            r#"call "a"tail"#,
            r#"call bare"quoted""#,
            "call \"actual\nnewline\"",
        ] {
            assert!(parse(input).is_err(), "accepted {input:?}");
        }
    }

    #[test]
    fn accepts_resource_method_names_and_brackets_in_bare_paths() {
        for target in [
            "sql/types::[method]error.trace",
            "sql/types::[constructor]connection",
            "[method]counter.next",
        ] {
            assert_eq!(parse(target).unwrap().target, target);
        }
        assert_eq!(
            parse("fs/fs::read-text notes[1].md").unwrap().args,
            vec![json!("notes[1].md")]
        );
        assert_eq!(
            parse("call bare{} 1[] ] }").unwrap().args,
            vec![json!("bare{}"), json!("1[]"), json!("]"), json!("}")]
        );
    }

    #[test]
    fn does_not_expand_or_evaluate_bare_text() {
        assert_eq!(
            parse("call $HOME ~ *.rs 1+2 | ;").unwrap().args,
            vec![
                json!("$HOME"),
                json!("~"),
                json!("*.rs"),
                json!("1+2"),
                json!("|"),
                json!(";")
            ]
        );
    }

    #[test]
    fn stream_recovers_from_errors_and_preserves_state() {
        let input = "\n \t\nadd 2\ninvalid [\nfail\r\nadd 3\ntext";
        let mut output = Vec::new();
        let mut total = 0;
        let mut invocations = 0;
        run(Cursor::new(input), &mut output, |target, args| {
            invocations += 1;
            match target {
                "add" => {
                    total += args[0].as_i64().unwrap();
                    Ok(json!(total))
                }
                "fail" => Err("operation failed\nwith details".into()),
                "text" => Ok(json!({"text": "line one\nline two", "nested": [1, 2]})),
                _ => panic!("unexpected invocation"),
            }
        })
        .unwrap();
        assert_eq!(invocations, 4);
        assert_eq!(total, 5);
        let output = String::from_utf8(output).unwrap();
        assert!(output.ends_with('\n'));
        let lines: Vec<_> = output.lines().collect();
        assert_eq!(lines.len(), 5);
        let responses: Vec<Value> = lines
            .iter()
            .map(|line| {
                let value = serde_json::from_str(line).unwrap();
                assert_eq!(*line, serde_json::to_string(&value).unwrap());
                value
            })
            .collect();
        assert_eq!(responses[0], json!({"ok": 2}));
        assert!(responses[1]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Invalid JSON"));
        assert_eq!(
            responses[2],
            json!({"error": {"message": "operation failed\nwith details"}})
        );
        assert_eq!(responses[3], json!({"ok": 5}));
        assert_eq!(
            responses[4],
            json!({"ok": {"text": "line one\nline two", "nested": [1, 2]}})
        );
    }

    #[test]
    fn propagates_io_errors() {
        assert!(run(Cursor::new([0xff, b'\n']), Vec::new(), |_, _| Ok(
            Value::Null
        ))
        .is_err());
        let mut output = [0u8; 0];
        assert!(run(Cursor::new("call\n"), &mut output[..], |_, _| Ok(
            Value::Null
        ))
        .is_err());
    }
}
