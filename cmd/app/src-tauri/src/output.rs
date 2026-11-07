use serde_json::Value;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Format {
    #[default]
    Json,
    Human,
}

impl Format {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "json" => Ok(Self::Json),
            "human" => Ok(Self::Human),
            _ => Err(format!(
                "invalid response format {value:?}; expected json or human"
            )),
        }
    }

    pub fn encode(self, result: Result<Value, String>) -> serde_json::Result<Vec<u8>> {
        let mut bytes = match self {
            Self::Json => serde_json::to_vec(&match result {
                Ok(value) => serde_json::json!({ "ok": value }),
                Err(message) => serde_json::json!({ "error": { "message": message } }),
            })?,
            Self::Human => {
                let (label, value) = match result {
                    Ok(value) => ("OK", value),
                    Err(message) => ("ERROR", Value::String(message)),
                };
                format!(
                    "{label}\n{}\n--- end ---",
                    serde_json::to_string_pretty(&value)?
                )
                .into_bytes()
            }
        };
        bytes.push(b'\n');
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_stays_compact_and_human_keeps_unambiguous_boundaries() {
        let value = json!({"message":"line\n--- end ---\nnext", "result":{"err":"guest error"}});
        let json = Format::Json.encode(Ok(value.clone())).unwrap();
        assert_eq!(json.iter().filter(|byte| **byte == b'\n').count(), 1);
        assert_eq!(
            serde_json::from_slice::<Value>(&json).unwrap(),
            json!({"ok":value})
        );
        let human = String::from_utf8(Format::Human.encode(Ok(value.clone())).unwrap()).unwrap();
        assert!(human.starts_with("OK\n{\n  "));
        assert_eq!(
            human.lines().filter(|line| *line == "--- end ---").count(),
            1
        );
        assert_eq!(
            serde_json::from_str::<Value>(
                human
                    .strip_prefix("OK\n")
                    .unwrap()
                    .strip_suffix("\n--- end ---\n")
                    .unwrap()
            )
            .unwrap(),
            value
        );
        let human = String::from_utf8(
            Format::Human
                .encode(Err("failure\n--- end ---\n".into()))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            human.lines().filter(|line| *line == "--- end ---").count(),
            1
        );
        assert_eq!(human, "ERROR\n\"failure\\n--- end ---\\n\"\n--- end ---\n");
    }
}
