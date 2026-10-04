use anyhow::{Context, Result};
use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

const MODULES_FOLDER: &str = "gams_modules";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub config: serde_json::Value,
    pub modules_dir: PathBuf,
}

impl Project {
    pub fn load(root: &Path, shared_modules: Option<&OsStr>) -> Result<Self> {
        let config_path = root.join("gams.json");
        let config: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&config_path)
                .with_context(|| format!("failed to read {}", config_path.display()))?,
        )
        .with_context(|| format!("invalid JSON in {}", config_path.display()))?;
        anyhow::ensure!(config.is_object(), "gams.json must contain an object");
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
            modules_dir: modules_dir.canonicalize()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("gams.json"), r#"{"plugins":[]}"#).unwrap();
        root
    }

    #[test]
    fn reads_config_without_a_filesystem_plugin_and_creates_local_modules() {
        let root = project_root();
        let project = Project::load(root.path(), None).unwrap();
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
        let project = Project::load(root.path(), Some(path.as_os_str())).unwrap();
        assert_eq!(project.modules_dir, path.canonicalize().unwrap());
        assert!(!root.path().join(MODULES_FOLDER).exists());
    }

    #[test]
    fn rejects_invalid_config_before_creating_modules() {
        for config in ["[1]", "null", "{"] {
            let root = project_root();
            std::fs::write(root.path().join("gams.json"), config).unwrap();
            assert!(Project::load(root.path(), None).is_err());
            assert!(!root.path().join(MODULES_FOLDER).exists());
        }
    }

    #[test]
    fn rejects_empty_relative_and_file_module_paths() {
        let root = project_root();
        for path in [OsStr::new(""), OsStr::new("relative/units")] {
            assert!(Project::load(root.path(), Some(path)).is_err());
        }
        let file = root.path().join("gams.json");
        assert!(Project::load(root.path(), Some(file.as_os_str())).is_err());
    }
}
