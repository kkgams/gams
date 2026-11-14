use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

use crate::resources::{Location, Resources};

#[derive(Clone)]
struct Reference {
    expression: Value,
    resolved: Value,
    root_dependencies: Vec<(String, Value)>,
}

#[derive(Clone, Default)]
pub(super) struct Provenance {
    references: HashMap<String, Reference>,
    files: HashMap<String, Value>,
}

impl Provenance {
    // Preserve unchanged inclusions, but keep edits to included config in the
    // active Project file. Never publish installation-cache paths as config.
    pub(super) fn prepare(&self, value: &Value) -> Value {
        self.prepare_at(value, "", value)
    }

    fn prepare_at(&self, value: &Value, pointer: &str, config: &Value) -> Value {
        if let Some(reference) = self.references.get(pointer) {
            if &reference.resolved == value
                && reference
                    .root_dependencies
                    .iter()
                    .all(|(target, expected)| config.pointer(target) == Some(expected))
            {
                return reference.expression.clone();
            }
        }
        match value {
            Value::String(path) if self.files.contains_key(path) => self.files[path].clone(),
            Value::Array(values) => Value::Array(
                values
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        self.prepare_at(value, &format!("{pointer}/{index}"), config)
                    })
                    .collect(),
            ),
            Value::Object(values) => Value::Object(
                values
                    .iter()
                    .map(|(name, value)| {
                        (
                            name.clone(),
                            self.prepare_at(value, &child_pointer(pointer, name), config),
                        )
                    })
                    .collect(),
            ),
            value => value.clone(),
        }
    }
}

pub(super) fn load(
    path: &Path,
    resources: &Resources,
    on_progress: &mut dyn FnMut(crate::resources::ResourceEvent),
    file_path: &dyn Fn(&Path) -> Result<String>,
) -> Result<(Value, Provenance)> {
    let root = Location::Local(
        path.canonicalize()
            .with_context(|| format!("failed to locate {}", path.display()))?,
    );
    let mut resolver = Resolver {
        resources,
        on_progress,
        file_path,
        root: root.clone(),
        documents: HashMap::new(),
        materialized: HashMap::new(),
        active: Vec::new(),
        provenance: Provenance::default(),
        root_dependencies: Vec::new(),
    };
    let config = resolver.resolve(&root, "", "")?;
    Ok((config, resolver.provenance))
}

struct Resolver<'a> {
    resources: &'a Resources,
    on_progress: &'a mut dyn FnMut(crate::resources::ResourceEvent),
    file_path: &'a dyn Fn(&Path) -> Result<String>,
    root: Location,
    documents: HashMap<Location, Value>,
    materialized: HashMap<Location, std::path::PathBuf>,
    active: Vec<(Location, String)>,
    provenance: Provenance,
    root_dependencies: Vec<(String, Value)>,
}

impl Resolver<'_> {
    fn materialize(&mut self, location: &Location) -> Result<std::path::PathBuf> {
        if let Some(path) = self.materialized.get(location) {
            return Ok(path.clone());
        }
        let path = self.resources.materialize(location, self.on_progress)?;
        self.materialized.insert(location.clone(), path.clone());
        Ok(path)
    }

    fn resolve(&mut self, location: &Location, pointer: &str, output: &str) -> Result<Value> {
        let key = (location.clone(), pointer.to_owned());
        anyhow::ensure!(
            !self.active.contains(&key),
            "circular $ref at {location:?}#{pointer}"
        );
        anyhow::ensure!(
            self.active.len() < 256,
            "configuration reference nesting exceeds 256 levels"
        );
        if !self.documents.contains_key(location) {
            let path = self.materialize(location)?;
            let bytes = std::fs::read(&path)
                .with_context(|| format!("failed to read {}", path.display()))?;
            let document = serde_json::from_slice(&bytes)
                .with_context(|| format!("invalid JSON in {}", path.display()))?;
            self.documents.insert(location.clone(), document);
        }
        let value = self.documents[location]
            .pointer(pointer)
            .with_context(|| format!("JSON Pointer not found: {location:?}#{pointer}"))?
            .clone();
        self.active.push(key);
        let result = self
            .expand(value, location, pointer, output)
            .with_context(|| format!("resolving {location:?}#{pointer}"));
        self.active.pop();
        result
    }

    fn expand(
        &mut self,
        value: Value,
        location: &Location,
        pointer: &str,
        output: &str,
    ) -> Result<Value> {
        match value {
            Value::Object(object) if object.contains_key("$ref") => {
                anyhow::ensure!(
                    object.len() == 1,
                    "$ref objects must not have sibling properties"
                );
                let (target, target_pointer) = reference(&object["$ref"], location)?;
                let expression = if location == &self.root {
                    Value::Object(object)
                } else {
                    canonical_reference(&target, &target_pointer, &self.root)
                };
                let dependency_start = self.root_dependencies.len();
                let resolved = self.resolve(&target, &target_pointer, output)?;
                if target == self.root {
                    self.root_dependencies
                        .push((target_pointer.clone(), resolved.clone()));
                }
                let root_dependencies = self.root_dependencies[dependency_start..].to_vec();
                self.provenance.references.insert(
                    output.to_owned(),
                    Reference {
                        expression,
                        resolved: resolved.clone(),
                        root_dependencies,
                    },
                );
                Ok(resolved)
            }
            Value::Object(object) if object.contains_key("$file") => {
                anyhow::ensure!(
                    object.len() == 1,
                    "$file objects must not have sibling properties"
                );
                let target = Location::parse(&object["$file"], &location.parent()?)?;
                let path = self.materialize(&target)?;
                let path = (self.file_path)(&path)?;
                // Canonical sources survive moving values out of included files
                // and editing/reordering arrays in the expanded config.
                let expression = if location == &self.root {
                    Value::Object(object)
                } else {
                    json!({"$file": portable_source(&target, &self.root)})
                };
                self.provenance.files.insert(path.clone(), expression);
                Ok(Value::String(path))
            }
            Value::Object(mut object) => {
                for (name, value) in &mut object {
                    *value = self.resolve(
                        location,
                        &child_pointer(pointer, name),
                        &child_pointer(output, name),
                    )?;
                }
                Ok(Value::Object(object))
            }
            Value::Array(mut array) => {
                for (index, value) in array.iter_mut().enumerate() {
                    *value = self.resolve(
                        location,
                        &format!("{pointer}/{index}"),
                        &format!("{output}/{index}"),
                    )?;
                }
                Ok(Value::Array(array))
            }
            value => Ok(value),
        }
    }
}

fn reference(value: &Value, base: &Location) -> Result<(Location, String)> {
    let (source, pointer) = match value {
        Value::String(reference) => {
            anyhow::ensure!(!reference.is_empty(), "$ref must not be empty");
            let (source, pointer) = reference.split_once('#').unwrap_or((reference, ""));
            // # selects the current document, including its ZIP entry.
            let location = if source.is_empty() {
                base.clone()
            } else {
                Location::parse(&Value::String(source.to_owned()), &base.parent()?)?
            };
            (location, pointer.to_owned())
        }
        Value::Object(descriptor) => {
            let mut source = descriptor.clone();
            let pointer = match source.remove("pointer") {
                Some(value) => value
                    .as_str()
                    .context("$ref pointer must be a string")?
                    .to_owned(),
                None => String::new(),
            };
            (
                Location::parse(&Value::Object(source), &base.parent()?)?,
                pointer,
            )
        }
        _ => anyhow::bail!("$ref must be a string or source descriptor"),
    };
    validate_pointer(&pointer)?;
    Ok((source, pointer))
}

fn portable_source(location: &Location, root: &Location) -> Value {
    let Location::Local(root_file) = root else {
        return location.source_value();
    };
    let Some(directory) = root_file.parent() else {
        return location.source_value();
    };
    let relative = |path: &std::path::Path| {
        path.strip_prefix(directory).ok().map(|path| {
            path.components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
    };
    match location {
        Location::Local(path) => relative(path)
            .map(Value::String)
            .unwrap_or_else(|| location.source_value()),
        Location::Archive { url, entry } if url.scheme() == "file" => {
            let path = url
                .to_file_path()
                .expect("local archive URL must contain a file path");
            relative(&path)
                .map(|path| json!({"url": path, "entry": entry}))
                .unwrap_or_else(|| location.source_value())
        }
        _ => location.source_value(),
    }
}

fn canonical_reference(location: &Location, pointer: &str, root: &Location) -> Value {
    let mut source = match portable_source(location, root) {
        Value::String(url) => json!({"url": url}),
        value => value,
    };
    source
        .as_object_mut()
        .expect("source descriptor must be an object")
        .insert("pointer".into(), Value::String(pointer.to_owned()));
    json!({"$ref": source})
}

fn child_pointer(parent: &str, name: &str) -> String {
    format!("{parent}/{}", name.replace('~', "~0").replace('/', "~1"))
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
