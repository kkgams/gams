use anyhow::{Context, Result};
use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

mod refs;

const MODULES_FOLDER: &str = "gams_modules";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub config: serde_json::Value,
    pub config_file: String,
    pub modules_dir: PathBuf,
}

pub fn config_file(value: Option<&OsStr>) -> Result<String> {
    let value = value.unwrap_or_else(|| OsStr::new("gams.json"));
    let name = value.to_str().context("GAMS_CONFIG must be valid UTF-8")?;
    anyhow::ensure!(
        !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains(['/', '\\', '\0'])
            && Path::new(name).file_name() == Some(value),
        "GAMS_CONFIG must be a non-empty filename within the Project directory"
    );
    Ok(name.to_owned())
}

impl Project {
    pub fn load(root: &Path, shared_modules: Option<&OsStr>, config_file: &str) -> Result<Self> {
        let config_path = root.join(config_file);
        let config = refs::load(&config_path)?;
        anyhow::ensure!(
            config.is_object(),
            "{} must contain an object",
            config_path.display()
        );
        let modules_dir = match shared_modules {
            Some(path) => {
                let path = PathBuf::from(path);
                anyhow::ensure!(
                    path.is_absolute(),
                    "GAMS_MODULES_DIR must be a non-empty absolute directory path"
                );
                path
            }
            None => root.join(MODULES_FOLDER),
        };
        std::fs::create_dir_all(&modules_dir)
            .with_context(|| format!("failed to create {}", modules_dir.display()))?;
        Ok(Self {
            config,
            config_file: config_file.to_owned(),
            modules_dir: modules_dir.canonicalize()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_default_or_explicit_filename() {
        assert_eq!(config_file(None).unwrap(), "gams.json");
        assert_eq!(
            config_file(Some(OsStr::new("dev config.json"))).unwrap(),
            "dev config.json"
        );
        for name in [
            "", ".", "..", "../dev.json", "/dev.json", "dir/dev.json", "dir\\dev.json", "bad\0.json",
        ] {
            assert!(config_file(Some(OsStr::new(name))).is_err(), "{name:?}");
        }
    }

    #[test]
    fn loads_selected_config_without_fallback() {
        let root = project_root();
        let path = root.path().join("dev.json");
        assert!(Project::load(root.path(), None, "dev.json").is_err());
        for config in ["{", "[]"] {
            std::fs::write(&path, config).unwrap();
            assert!(Project::load(root.path(), None, "dev.json").is_err());
        }
        assert!(!root.path().join(MODULES_FOLDER).exists());
        std::fs::write(path, r#"{"dev":true}"#).unwrap();
        let project = Project::load(root.path(), None, "dev.json").unwrap();
        assert_eq!(project.config, serde_json::json!({"dev": true}));
        assert_eq!(project.config_file, "dev.json");
    }

    #[test]
    fn resolves_files_pointers_and_nested_file_relative_references() {
        let root = project_root();
        std::fs::create_dir(root.path().join("config")).unwrap();
        std::fs::write(
            root.path().join("gams.json"),
            r##"{
            "database": {"$ref": "config/settings.json#/database"},
            "copy": {"$ref": "#/database"},
            "values": [{"$ref": "config/values.json"}],
            "escaped": {"$ref": "config/settings.json#/a~1b/~0key/0"},
            "emptyKey": {"$ref": "config/settings.json#/"}
        }"##,
        )
        .unwrap();
        std::fs::write(
            root.path().join("config/settings.json"),
            r##"{
            "database": {"$ref": "values.json#/0"},
            "a/b": {"~key": [42]},
            "": true
        }"##,
        )
        .unwrap();
        std::fs::write(
            root.path().join("config/values.json"),
            r#"[{"path":"data.sqlite"}, null, false, 3, "text"]"#,
        )
        .unwrap();
        let project = Project::load(root.path(), None, "gams.json").unwrap();
        assert_eq!(
            project.config,
            serde_json::json!({
            "database": {"path": "data.sqlite"},
            "copy": {"path": "data.sqlite"},
            "values": [[{"path": "data.sqlite"}, null, false, 3, "text"]],
            "escaped": 42,
            "emptyKey": true
            })
        );
    }

    #[test]
    fn replaces_root_reference_before_validating_config_shape() {
        let root = project_root();
        std::fs::write(root.path().join("gams.json"), r#"{"$ref":"other.json#"}"#).unwrap();
        std::fs::write(root.path().join("other.json"), r#"{"plugins":[]}"#).unwrap();
        assert_eq!(
            Project::load(root.path(), None, "gams.json").unwrap().config,
            serde_json::json!({"plugins": []})
        );
        std::fs::write(root.path().join("other.json"), "[]").unwrap();
        assert!(Project::load(root.path(), None, "gams.json").is_err());
    }

    #[test]
    fn rejects_invalid_references_before_creating_modules() {
        for (config, message) in [
            (r#"{"x":{"$ref":3}}"#, "$ref must be a string"),
            (r#"{"x":{"$ref":""}}"#, "$ref must not be empty"),
            (
                r##"{"x":{"$ref":"#/target","override":true},"target":{}}"##,
                "sibling properties",
            ),
            (r##"{"x":{"$ref":"#missing"}}"##, "starting with /"),
            (r##"{"x":{"$ref":"#/~2"}}"##, "invalid JSON Pointer escape"),
            (r##"{"x":{"$ref":"#/~"}}"##, "invalid JSON Pointer escape"),
            (r##"{"x":{"$ref":"#/missing"}}"##, "JSON Pointer not found"),
            (
                r##"{"x":{"$ref":"#/array/01"},"array":[1,2]}"##,
                "JSON Pointer not found",
            ),
            (r#"{"x":{"$ref":"missing.json"}}"#, "failed to locate"),
            (r#"{"x":{"$ref":"invalid.json"}}"#, "invalid JSON"),
        ] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            std::fs::write(root.path().join("invalid.json"), "{").unwrap();
            let error = Project::load(root.path(), None, "gams.json").err().unwrap();
            assert!(format!("{error:#}").contains(message), "{error:#}");
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    #[test]
    fn rejects_direct_indirect_and_cross_file_cycles() {
        for config in [
            r##"{"$ref":"#"}"##,
            r##"{"x":{"$ref":"#/x"}}"##,
            r##"{"x":{"$ref":"#/y"},"y":{"$ref":"#/x"}}"##,
            r##"{"x":{"$ref":"#"}}"##,
            r#"{"$ref":"other.json"}"#,
        ] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            std::fs::write(root.path().join("other.json"), r#"{"$ref":"./gams.json"}"#).unwrap();
            let error = Project::load(root.path(), None, "gams.json").err().unwrap();
            assert!(format!("{error:#}").contains("circular $ref"), "{error:#}");
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    fn project_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("gams.json"), r#"{"plugins":[]}"#).unwrap();
        root
    }

    #[test]
    fn reads_config_without_a_filesystem_plugin_and_creates_local_modules() {
        let root = project_root();
        let project = Project::load(root.path(), None, "gams.json").unwrap();
        assert_eq!(project.config, serde_json::json!({"plugins": []}));
        assert_eq!(
            project.modules_dir,
            root.path().join(MODULES_FOLDER).canonicalize().unwrap()
        );
        assert!(project.modules_dir.is_dir());
    }

    #[test]
    fn creates_and_selects_shared_modules_without_local_fallback() {
        let root = project_root();
        let shared = tempfile::tempdir().unwrap();
        let path = shared.path().join("units");
        let project = Project::load(root.path(), Some(path.as_os_str()), "gams.json").unwrap();
        assert_eq!(project.modules_dir, path.canonicalize().unwrap());
        assert!(!root.path().join(MODULES_FOLDER).exists());
    }

    #[test]
    fn rejects_invalid_config_before_creating_modules() {
        for config in ["[1]", "null", "{"] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            assert!(Project::load(root.path(), None, "gams.json").is_err());
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    #[test]
    fn rejects_empty_relative_and_file_module_paths() {
        let root = project_root();
        for path in [OsStr::new(""), OsStr::new("relative/units")] {
            assert!(Project::load(root.path(), Some(path), "gams.json").is_err());
        }
        let file = root.path().join("gams.json");
        assert!(Project::load(root.path(), Some(file.as_os_str()), "gams.json").is_err());
    }
}
