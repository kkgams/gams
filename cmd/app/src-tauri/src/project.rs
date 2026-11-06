use anyhow::{Context, Result};
use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

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
        let config: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&config_path)
                .with_context(|| format!("failed to read {}", config_path.display()))?,
        )
        .with_context(|| format!("invalid JSON in {}", config_path.display()))?;
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
