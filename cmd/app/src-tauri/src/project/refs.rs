use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub(super) fn load(path: &Path) -> Result<Value> {
    Resolver::default().resolve(&canonical_file(path)?, "")
}

fn canonical_file(path: &Path) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to locate {}", path.display()))
}

#[derive(Default)]
struct Resolver {
    documents: HashMap<PathBuf, Value>,
    active: Vec<(PathBuf, String)>,
}

impl Resolver {
    fn resolve(&mut self, path: &Path, pointer: &str) -> Result<Value> {
        let file = path.to_path_buf();
        let key = (file.clone(), pointer.to_owned());
        anyhow::ensure!(
            !self.active.contains(&key),
            "circular $ref at {}#{pointer}",
            file.display()
        );
        if !self.documents.contains_key(&file) {
            let bytes = std::fs::read(&file)
                .with_context(|| format!("failed to read {}", file.display()))?;
            let document = serde_json::from_slice(&bytes)
                .with_context(|| format!("invalid JSON in {}", file.display()))?;
            self.documents.insert(file.clone(), document);
        }
        let value = self.documents[&file]
            .pointer(pointer)
            .with_context(|| format!("JSON Pointer not found: {}#{pointer}", file.display()))?
            .clone();
        self.active.push(key);
        let result = self.expand(value, &file, pointer)
            .with_context(|| format!("resolving {}#{pointer}", file.display()));
        self.active.pop();
        result
    }

    fn expand(&mut self, value: Value, file: &Path, pointer: &str) -> Result<Value> {
        match value {
            Value::Object(object) if object.contains_key("$ref") => {
                anyhow::ensure!(
                    object.len() == 1,
                    "$ref objects must not have sibling properties"
                );
                let reference = object["$ref"].as_str().context("$ref must be a string")?;
                anyhow::ensure!(!reference.is_empty(), "$ref must not be empty");
                let (path, target) = reference.split_once('#').unwrap_or((reference, ""));
                validate_pointer(target)?;
                let target_file = if path.is_empty() {
                    file.to_path_buf()
                } else {
                    file.parent().context("config file has no parent")?.join(path)
                };
                self.resolve(&canonical_file(&target_file)?, target)
            }
            Value::Object(mut object) => {
                for (name, value) in &mut object {
                    let token = name.replace('~', "~0").replace('/', "~1");
                    *value = self.resolve(file, &format!("{pointer}/{token}"))?;
                }
                Ok(Value::Object(object))
            }
            Value::Array(mut array) => {
                for (index, value) in array.iter_mut().enumerate() {
                    *value = self.resolve(file, &format!("{pointer}/{index}"))?;
                }
                Ok(Value::Array(array))
            }
            value => Ok(value),
        }
    }
}

fn validate_pointer(pointer: &str) -> Result<()> {
    anyhow::ensure!(
        pointer.is_empty() || pointer.starts_with('/'),
        "$ref fragment must be empty or a JSON Pointer starting with /"
    );
    let mut chars = pointer.chars();
    while let Some(ch) = chars.next() {
        if ch == '~' {
            anyhow::ensure!(
                matches!(chars.next(), Some('0' | '1')),
                "invalid JSON Pointer escape"
            );
        }
    }
    Ok(())
}
