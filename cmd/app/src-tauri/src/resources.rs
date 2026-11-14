//! Native resource origins and immutable complete-archive storage.
use anyhow::{bail, ensure, Context, Result};
use reqwest::Url;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

const MAX_COMPRESSED: u64 = 64 * 1024 * 1024;
const MAX_EXPANDED: u64 = 256 * 1024 * 1024;
const MAX_ENTRY: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
const MARKER: &str = ".gams-resource.json";
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Location {
    Local(PathBuf),
    Remote(Url),
    /// Empty entry selects the archive root directory.
    Archive {
        url: Url,
        entry: String,
    },
}
impl Location {
    pub fn parse(value: &Value, base: &Location) -> Result<Self> {
        let (source, selector) = match value {
            Value::String(s) => (s.as_str(), None),
            Value::Object(o) => {
                ensure!(
                    o.keys().all(|k| k == "url" || k == "entry"),
                    "unknown source descriptor field"
                );
                (
                    o.get("url")
                        .and_then(Value::as_str)
                        .context("source requires url string")?,
                    o.get("entry")
                        .map(|v| v.as_str().context("entry must be a string"))
                        .transpose()?,
                )
            }
            _ => bail!("source must be string or {{url,entry}}"),
        };
        ensure!(!source.is_empty(), "empty resource source");
        let native_absolute = Path::new(source).is_absolute() && matches!(base, Self::Local(_));
        let parsed_url = if native_absolute {
            None
        } else {
            Url::parse(source).ok()
        };
        let mut location = if let Some(url) = parsed_url {
            ensure!(
                matches!(base, Self::Local(_)) || url.scheme() != "file",
                "remote sources cannot reference local files"
            );
            Self::from_url(url)?
        } else {
            match base {
                Self::Local(path) => {
                    let path =
                        fs::canonicalize(path.join(source)).context("resolve local source")?;
                    if path
                        .extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
                    {
                        let path = if path.is_absolute() {
                            path
                        } else {
                            std::env::current_dir()?.join(path)
                        };
                        Self::Archive {
                            url: Url::from_file_path(path)
                                .map_err(|_| anyhow::anyhow!("invalid file path"))?,
                            entry: String::new(),
                        }
                    } else {
                        Self::Local(path)
                    }
                }
                Self::Remote(url) => Self::from_url(url.join(source)?)?,
                Self::Archive { url, entry } => {
                    ensure!(
                        !source.starts_with('/') && !source.contains(['\\', '\0', ':']),
                        "invalid archive-relative reference"
                    );
                    let mut parts: Vec<&str> = entry.split('/').filter(|p| !p.is_empty()).collect();
                    for part in source.split('/') {
                        match part {
                            "" | "." => {}
                            ".." => {
                                ensure!(parts.pop().is_some(), "archive reference escapes root");
                            }
                            p => parts.push(p),
                        }
                    }
                    Self::Archive {
                        url: url.clone(),
                        entry: parts.join("/"),
                    }
                }
            }
        };
        if let Some(entry) = selector {
            ensure!(
                !matches!(base, Self::Archive { .. }) || Url::parse(source).is_ok(),
                "nested ZIP selectors inside archives are unsupported"
            );
            if !entry.is_empty() {
                validate_entry(entry, true)?;
            }
            let url = match location {
                Self::Archive { url, .. } | Self::Remote(url) => url,
                _ => bail!("entry selector requires ZIP source"),
            };
            ensure!(is_zip(&url), "entry selector requires ZIP source");
            location = Self::Archive {
                url,
                entry: entry.trim_end_matches('/').to_owned(),
            };
        }
        Ok(location)
    }
    fn from_url(mut url: Url) -> Result<Self> {
        ensure!(
            matches!(url.scheme(), "https" | "http" | "file"),
            "unsupported resource URL scheme"
        );
        ensure!(
            url.username().is_empty() && url.password().is_none(),
            "resource URL contains credentials"
        );
        let fragment = url.fragment().map(str::to_owned);
        url.set_fragment(None);
        if url.scheme() == "file" {
            let path = fs::canonicalize(
                url.to_file_path()
                    .map_err(|_| anyhow::anyhow!("invalid file URL"))?,
            )?;
            url = Url::from_file_path(path).map_err(|_| anyhow::anyhow!("invalid file URL"))?;
        }
        if is_zip(&url) {
            let entry = decode(fragment.as_deref().unwrap_or(""))?;
            if !entry.is_empty() {
                validate_entry(&entry, true)?;
            }
            Ok(Self::Archive {
                url,
                entry: entry.trim_end_matches('/').to_owned(),
            })
        } else {
            ensure!(
                fragment.is_none(),
                "non-ZIP fragments must be resolved as JSON pointers"
            );
            if url.scheme() == "file" {
                Ok(Self::Local(fs::canonicalize(
                    url.to_file_path()
                        .map_err(|_| anyhow::anyhow!("invalid file URL"))?,
                )?))
            } else {
                Ok(Self::Remote(url))
            }
        }
    }
    pub fn parent(&self) -> Result<Self> {
        Ok(match self {
            Self::Local(p) => Self::Local(p.parent().context("source has no parent")?.to_owned()),
            Self::Remote(u) => Self::Remote(u.join(".")?),
            Self::Archive { url, entry } => Self::Archive {
                url: url.clone(),
                entry: entry
                    .rsplit_once('/')
                    .map(|(p, _)| p.to_owned())
                    .unwrap_or_default(),
            },
        })
    }
    pub fn source_value(&self) -> Value {
        match self {
            Self::Local(p) => json!(p.to_string_lossy()),
            Self::Remote(u) => json!(u.as_str()),
            Self::Archive { url, entry } => json!({"url":url.as_str(),"entry":entry}),
        }
    }
}
fn is_zip(url: &Url) -> bool {
    url.path().to_ascii_lowercase().ends_with(".zip")
}
fn decode(s: &str) -> Result<String> {
    let mut out = Vec::new();
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        out.push(if b == b'%' {
            let a = bytes.next().context("invalid selector escape")?;
            let b = bytes.next().context("invalid selector escape")?;
            ((a as char)
                .to_digit(16)
                .context("invalid selector escape")?
                * 16
                + (b as char)
                    .to_digit(16)
                    .context("invalid selector escape")?) as u8
        } else {
            b
        });
    }
    Ok(String::from_utf8(out).context("selector is not UTF-8")?)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEvent {
    pub operation_id: u64,
    pub resource: String,
    pub phase: String,
    pub completed: u64,
    pub total: Option<u64>,
    pub unit: Option<String>,
    pub cached: bool,
    pub entry: Option<String>,
    pub error: Option<String>,
}
#[derive(Clone)]
pub struct Resources {
    modules: PathBuf,
}
impl Resources {
    pub fn new(modules_dir: PathBuf) -> Self {
        Self {
            modules: modules_dir,
        }
    }
    pub fn materialize(
        &self,
        source: &Location,
        on_progress: &mut dyn FnMut(ResourceEvent),
    ) -> Result<PathBuf> {
        let mut state = ResourceEvent {
            operation_id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            phase: "resolving".into(),
            completed: 0,
            total: None,
            unit: None,
            cached: false,
            resource: match source {
                Location::Archive { url, entry } => format!("{url}#{entry}"),
                _ => source
                    .source_value()
                    .as_str()
                    .expect("simple source is string")
                    .to_owned(),
            },
            entry: None,
            error: None,
        };
        let mut emit = |state: &ResourceEvent| on_progress(state.clone());
        emit(&state);
        let result = self.materialize_inner(source, &mut state, &mut emit);
        state.phase = if result.is_ok() { "ready" } else { "failed" }.into();
        state.completed = u64::from(result.is_ok());
        state.total = Some(1);
        state.unit = None;
        state.error = result.as_ref().err().map(|e| format!("{e:#}"));
        emit(&state);
        result
    }
}
impl Resources {
    pub fn modules_dir(&self) -> &Path {
        &self.modules
    }

    // Recover portable sources for runtime paths copied into newly edited
    // configuration, including descendants of a selected package directory.
    pub fn origin(&self, path: &Path) -> Result<Option<Location>> {
        let modules = fs::canonicalize(&self.modules)?;
        let Ok(relative) = path.strip_prefix(&modules) else {
            return Ok(None);
        };
        let mut parts = relative.components();
        let Some(std::path::Component::Normal(key)) = parts.next() else {
            return Ok(None);
        };
        if parts.next()
            != Some(std::path::Component::Normal(std::ffi::OsStr::new(
                "content",
            )))
        {
            return Ok(None);
        }
        let target = modules.join(key);
        let marker = target.join(MARKER);
        match fs::symlink_metadata(&marker) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
            Ok(metadata) => ensure!(metadata.is_file(), "invalid resource completion marker"),
        }
        let metadata: Value = serde_json::from_slice(&fs::read(marker)?)?;
        let url = Url::parse(
            metadata["url"]
                .as_str()
                .context("resource marker requires url")?,
        )?;
        let archive = metadata["archive"]
            .as_bool()
            .context("resource marker requires archive type")?;
        validate_cache(&target, &url, archive)?;
        let entry = parts
            .map(|part| {
                part.as_os_str()
                    .to_str()
                    .context("resource path must be UTF-8")
            })
            .collect::<Result<Vec<_>>>()?
            .join("/");
        if archive {
            if !entry.is_empty() {
                validate_entry(&entry, false)?;
            }
            Ok(Some(Location::Archive { url, entry }))
        } else {
            ensure!(
                entry == direct_name(&url)?,
                "direct resource cache path mismatch"
            );
            Ok(Some(Location::Remote(url)))
        }
    }

    fn materialize_inner(
        &self,
        source: &Location,
        state: &mut ResourceEvent,
        emit: &mut impl FnMut(&ResourceEvent),
    ) -> Result<PathBuf> {
        if let Location::Local(path) = source {
            let path = fs::canonicalize(path).context("local resource does not exist")?;
            let metadata = fs::metadata(&path)?;
            ensure!(
                metadata.is_file() || metadata.is_dir(),
                "local resource must be a regular file or directory"
            );
            state.cached = true;
            return Ok(path);
        }
        let (url, entry) = match source {
            Location::Remote(u) => (u, None),
            Location::Archive { url, entry } => (url, Some(entry.as_str())),
            _ => unreachable!(),
        };
        ensure!(url.fragment().is_none(), "resource URL contains selector");
        validate_url(url)?;
        if let Some(entry) = entry {
            if !entry.is_empty() {
                validate_entry(entry, false)?;
            }
        }
        let _guard = INSTALL_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| anyhow::anyhow!("resource installation lock poisoned"))?;
        fs::create_dir_all(&self.modules)?;
        let modules = fs::canonicalize(&self.modules)?;
        let key = format!("{:x}", Sha256::digest(url.as_str().as_bytes()));
        let target = modules.join(&key);
        state.phase = "checking-cache".into();
        emit(state);
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                validate_cache(&target, url, entry.is_some())?;
                state.cached = true;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.install(url, entry.is_some(), &key, &modules, &target, state, emit)?
            }
            Err(e) => return Err(e.into()),
        }
        let selected = if let Some(entry) = entry {
            target.join("content").join(entry)
        } else {
            target.join("content").join(direct_name(url)?)
        };
        let canonical = fs::canonicalize(&selected)
            .context("selected resource missing from completed cache")?;
        ensure!(
            canonical.starts_with(&target),
            "cached resource escapes installation"
        );
        let metadata = fs::metadata(&canonical)?;
        ensure!(
            metadata.is_file() || (entry.is_some() && metadata.is_dir()),
            "cached resource has an invalid file type"
        );
        Ok(canonical)
    }
    fn install(
        &self,
        url: &Url,
        archive: bool,
        key: &str,
        modules: &Path,
        target: &Path,
        state: &mut ResourceEvent,
        emit: &mut impl FnMut(&ResourceEvent),
    ) -> Result<()> {
        let lock_path = modules.join(format!(".{key}.lock"));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .context("resource install is active in another process or a stale lock remains")?;
        let _lock = LockFile {
            path: lock_path,
            file: Some(file),
        };
        let stage = modules.join(format!(
            ".{key}.{}.{}.tmp",
            std::process::id(),
            state.operation_id
        ));
        fs::create_dir(&stage)?;
        let _stage = Stage(stage.clone());
        let content = stage.join("content");
        fs::create_dir(&content)?;
        let bytes = if url.scheme() == "file" {
            let file = File::open(
                url.to_file_path()
                    .map_err(|_| anyhow::anyhow!("invalid local archive URL"))?,
            )?;
            ensure!(
                file.metadata()?.len() <= MAX_COMPRESSED,
                "archive compressed size exceeds limit"
            );
            let mut bytes = Vec::new();
            file.take(MAX_COMPRESSED + 1).read_to_end(&mut bytes)?;
            ensure!(
                bytes.len() as u64 <= MAX_COMPRESSED,
                "archive compressed size exceeds limit"
            );
            bytes
        } else {
            state.phase = "downloading".into();
            state.unit = Some("bytes".into());
            emit(state);
            download(url, |p| {
                state.completed = p.downloaded;
                state.total = p.total;
                emit(state);
            })?
        };
        if archive {
            state.phase = "extracting".into();
            state.unit = Some("entries".into());
            state.completed = 0;
            extract_zip(&bytes, &content, |completed, total, entry| {
                state.completed = completed;
                state.total = Some(total);
                state.entry = if entry.is_empty() {
                    None
                } else {
                    Some(entry.to_owned())
                };
                emit(state);
            })?;
        } else {
            write_new(&content.join(direct_name(url)?), &bytes)?;
        }
        write_new(
            &stage.join(MARKER),
            serde_json::to_string(&json!({"version":1,"url":url.as_str(),"archive":archive}))?
                .as_bytes(),
        )?;
        ensure!(
            fs::symlink_metadata(target).is_err(),
            "refusing to overwrite resource cache"
        );
        fs::rename(&stage, target).context("publish complete resource cache")?;
        Ok(())
    }
}
fn download(
    url: &Url,
    mut progress: impl FnMut(crate::download::DownloadProgress),
) -> Result<Vec<u8>> {
    let url = url.to_string();
    let (sender, receiver) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || -> Result<Vec<u8>> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?
            .block_on(crate::download::fetch_bytes(&url, |event| {
                sender.send(event)?;
                Ok(())
            }))
    });
    for event in receiver {
        progress(event);
    }
    worker
        .join()
        .map_err(|_| anyhow::anyhow!("resource download worker panicked"))?
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
fn validate_cache(target: &Path, url: &Url, archive: bool) -> Result<()> {
    ensure!(
        fs::symlink_metadata(target)?.file_type().is_dir(),
        "cache is not a real directory"
    );
    let marker = target.join(MARKER);
    ensure!(
        fs::symlink_metadata(&marker)?.file_type().is_file(),
        "invalid cache completion marker"
    );
    let value: Value = serde_json::from_slice(&fs::read(marker)?)?;
    ensure!(
        value == json!({"version":1,"url":url.as_str(),"archive":archive}),
        "cache completion marker mismatch"
    );
    ensure!(
        fs::symlink_metadata(target.join("content"))?
            .file_type()
            .is_dir(),
        "invalid cache content directory"
    );
    Ok(())
}
struct LockFile {
    path: PathBuf,
    file: Option<File>,
}
impl Drop for LockFile {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}
struct Stage(PathBuf);
impl Drop for Stage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn validate_entry(name: &str, directory: bool) -> Result<String> {
    ensure!(
        !name.is_empty() && !name.contains(['\\', '\0', ':']) && !name.starts_with('/'),
        "unsafe ZIP entry path: {name:?}"
    );
    let path = if directory {
        name.strip_suffix('/').unwrap_or(name)
    } else {
        name
    };
    ensure!(
        !path.is_empty()
            && path.len() <= 4096
            && path
                .split('/')
                .all(|p| !p.is_empty() && p != "." && p != ".."),
        "non-canonical ZIP entry: {name:?}"
    );
    for part in path.split('/') {
        ensure!(!part.ends_with(['.', ' ']), "unsafe ZIP entry component");
        let stem = part.split('.').next().unwrap().to_ascii_uppercase();
        ensure!(
            !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit()),
            "reserved ZIP entry component"
        );
    }
    Ok(path.to_owned())
}
fn extract_zip(
    bytes: &[u8],
    destination: &Path,
    mut progress: impl FnMut(u64, u64, &str),
) -> Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).context("invalid ZIP archive")?;
    ensure!(
        archive.len() <= MAX_ENTRIES,
        "ZIP entry count exceeds limit"
    );
    let mut paths = HashMap::new();
    let mut declared = 0u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .context("unsupported or encrypted ZIP entry")?;
        ensure!(!entry.encrypted(), "encrypted ZIP entry unsupported");
        let directory = entry.is_dir();
        let path = validate_entry(entry.name(), directory)?;
        ensure!(
            paths.insert(path.to_lowercase(), directory).is_none(),
            "duplicate/case-colliding ZIP entry"
        );
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            ensure!(
                kind == 0 || kind == 0o100000 || (directory && kind == 0o040000),
                "ZIP symlinks/special files unsupported"
            );
        }
        ensure!(
            entry.size() <= MAX_ENTRY,
            "ZIP entry expanded size exceeds limit"
        );
        declared = declared
            .checked_add(entry.size())
            .context("ZIP size overflow")?;
        ensure!(declared <= MAX_EXPANDED, "ZIP expanded size exceeds limit");
    }
    for path in paths.keys() {
        let mut ancestor = path.as_str();
        while let Some((parent, _)) = ancestor.rsplit_once('/') {
            ensure!(
                paths.get(parent) != Some(&false),
                "ZIP file/directory collision"
            );
            ancestor = parent;
        }
    }
    let total = archive.len() as u64;
    progress(0, total, "");
    let mut expanded = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let entry_name = entry.name().to_owned();
        let path = destination.join(validate_entry(&entry_name, entry.is_dir())?);
        if entry.is_dir() {
            fs::create_dir_all(path)?;
        } else {
            fs::create_dir_all(path.parent().context("ZIP entry missing parent")?)?;
            let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
            let size = entry.size();
            let copied = std::io::copy(&mut (&mut entry).take(MAX_ENTRY + 1), &mut file)
                .context("ZIP decompression/CRC failure")?;
            ensure!(
                copied == size && copied <= MAX_ENTRY,
                "ZIP expanded size mismatch"
            );
            expanded += copied;
            ensure!(expanded <= MAX_EXPANDED, "ZIP expanded size exceeds limit");
            file.sync_all()?;
        }
        progress(index as u64 + 1, total, &entry_name);
    }
    Ok(())
}

fn direct_name(url: &Url) -> Result<String> {
    let name = decode(
        url.path_segments()
            .and_then(|s| s.last())
            .context("resource URL has no filename")?,
    )?;
    if name.is_empty() {
        return Ok("resource".to_owned());
    }
    validate_entry(&name, false)?;
    ensure!(!name.contains('/'), "resource filename contains separator");
    Ok(name)
}
fn validate_url(url: &Url) -> Result<()> {
    if url.scheme() == "file" {
        ensure!(
            url.username().is_empty() && url.password().is_none(),
            "resource URL contains credentials"
        );
        return Ok(());
    }
    crate::download::validate_url(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(
                    *name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn serve_once(body: Vec<u8>, name: &str) -> (Url, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://{}/{name}", listener.local_addr().unwrap())).unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            stream.read(&mut [0; 4096]).unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        });
        (url, worker)
    }
    #[test]
    fn http_zip_deduplicates_selectors_and_reuses_complete_archive_offline() {
        let root = tempfile::tempdir().unwrap();
        let modules = root.path().join("modules");
        let resources = Resources::new(modules.clone());
        let (url, server) = serve_once(
            archive(&[
                ("a/file.json", b"{}"),
                ("b.js", b"export {}"),
                ("NOTICE", b"notice"),
            ]),
            "pack.zip",
        );
        let first = Location::Archive {
            url: url.clone(),
            entry: "a/file.json".into(),
        };
        let mut events = Vec::new();
        let path = resources
            .materialize(&first, &mut |event| events.push(event))
            .unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(path).unwrap(), b"{}");
        assert!(events.iter().any(|e| e.phase == "downloading"));
        assert!(events.iter().any(|e| e.phase == "extracting"));
        assert_eq!(events.last().unwrap().phase, "ready");
        assert!(events
            .iter()
            .all(|e| e.operation_id == events[0].operation_id));
        let offline = Resources::new(modules.clone());
        let second = Location::Archive {
            url: url.clone(),
            entry: "b.js".into(),
        };
        let mut cached = Vec::new();
        assert_eq!(
            fs::read(
                offline
                    .materialize(&second, &mut |e| cached.push(e))
                    .unwrap()
            )
            .unwrap(),
            b"export {}"
        );
        assert!(cached.last().unwrap().cached);
        let directory = offline
            .materialize(
                &Location::Archive {
                    url: url.clone(),
                    entry: String::new(),
                },
                &mut |_| {},
            )
            .unwrap();
        assert_eq!(fs::read(directory.join("NOTICE")).unwrap(), b"notice");
        assert!(offline
            .materialize(
                &Location::Archive {
                    url,
                    entry: "missing".into()
                },
                &mut |_| {}
            )
            .is_err());
        assert_eq!(fs::read_dir(modules).unwrap().count(), 1);
    }
    #[test]
    fn direct_http_retains_basename_and_reuses_offline() {
        let root = tempfile::tempdir().unwrap();
        let resources = Resources::new(root.path().join("modules"));
        let (url, server) = serve_once(b"hello".to_vec(), "plugin.fs.wasm");
        let source = Location::Remote(url);
        let path = resources.materialize(&source, &mut |_| {}).unwrap();
        server.join().unwrap();
        assert_eq!(path.file_name().unwrap(), "plugin.fs.wasm");
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        assert_eq!(
            resources.clone().materialize(&source, &mut |_| {}).unwrap(),
            path
        );
    }
    #[test]
    fn traversal_fails_atomically_and_reports_failed_state() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("bad.zip");
        fs::write(&zip, archive(&[("valid", b"ok"), ("../escape", b"bad")])).unwrap();
        let resources = Resources::new(root.path().join("modules"));
        let source = Location::parse(
            &json!({"url":"bad.zip","entry":"valid"}),
            &Location::Local(root.path().to_owned()),
        )
        .unwrap();
        let mut events = Vec::new();
        assert!(resources
            .materialize(&source, &mut |e| events.push(e))
            .is_err());
        assert_eq!(events.last().unwrap().phase, "failed");
        assert!(events.last().unwrap().error.is_some());
        assert_eq!(fs::read_dir(resources.modules_dir()).unwrap().count(), 0);
        assert!(!root.path().join("escape").exists());
    }
    #[test]
    fn local_files_directories_and_zip_descriptors() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("assets")).unwrap();
        fs::write(root.path().join("data.json"), "{}").unwrap();
        fs::write(
            root.path().join("pack.zip"),
            archive(&[("dir/file", b"yes"), ("LICENSE", b"terms")]),
        )
        .unwrap();
        let base = Location::Local(root.path().to_owned());
        let resources = Resources::new(root.path().join("modules"));
        for source in ["assets", "data.json"] {
            let location = Location::parse(&json!(source), &base).unwrap();
            assert_eq!(
                resources.materialize(&location, &mut |_| {}).unwrap(),
                fs::canonicalize(root.path().join(source)).unwrap()
            );
        }
        assert!(!resources.modules_dir().exists());
        let source = Location::parse(&json!({"url":"pack.zip","entry":"dir"}), &base).unwrap();
        let dir = resources.materialize(&source, &mut |_| {}).unwrap();
        assert_eq!(fs::read(dir.join("file")).unwrap(), b"yes");
        let root_source = Location::parse(&json!("pack.zip"), &base).unwrap();
        assert!(resources
            .materialize(&root_source, &mut |_| {})
            .unwrap()
            .join("LICENSE")
            .exists());
    }
    #[test]
    fn origins_resolve_relative_documents_without_local_escape() {
        let remote = Location::Remote(Url::parse("https://example.com/config/").unwrap());
        assert_eq!(
            Location::parse(&json!("../data.json"), &remote)
                .unwrap()
                .source_value(),
            json!("https://example.com/data.json")
        );
        assert_eq!(
            Location::parse(&json!("/root.json"), &remote)
                .unwrap()
                .source_value(),
            json!("https://example.com/root.json")
        );
        assert!(Location::parse(&json!("file:///tmp/private"), &remote).is_err());
        let archive = Location::Archive {
            url: Url::parse("https://example.com/a.zip").unwrap(),
            entry: "config/sub".into(),
        };
        assert_eq!(
            Location::parse(&json!("../data.json"), &archive)
                .unwrap()
                .source_value(),
            json!({"url":"https://example.com/a.zip","entry":"config/data.json"})
        );
        for source in [
            "../../../private",
            "/private",
            "file:///tmp/private",
            "C:\\private",
        ] {
            assert!(Location::parse(&json!(source), &archive).is_err());
        }
        assert!(Location::parse(&json!({"url":"nested.zip","entry":"foo"}), &archive).is_err());
        assert!(Location::parse(
            &json!({"url":"https://example.com/other.zip","entry":"foo"}),
            &archive
        )
        .is_ok());
    }
    #[test]
    fn rejects_symlinks_encryption_and_expanded_limits_before_writes() {
        let original = archive(&[("member", b"hello")]);
        let central = original
            .windows(4)
            .position(|w| w == b"PK\x01\x02")
            .unwrap();
        for variant in 0..3 {
            let mut bytes = original.clone();
            match variant {
                0 => {
                    bytes[central + 5] = 3; // Unix creator, symlink external mode.
                    bytes[central + 38..central + 42]
                        .copy_from_slice(&(0o120777u32 << 16).to_le_bytes());
                }
                1 => {
                    bytes[6] |= 1;
                    bytes[central + 8] |= 1;
                }
                _ => {
                    bytes[central + 24..central + 28]
                        .copy_from_slice(&((MAX_ENTRY + 1) as u32).to_le_bytes());
                }
            }
            let root = tempfile::tempdir().unwrap();
            assert!(
                extract_zip(&bytes, root.path(), |_, _, _| {}).is_err(),
                "variant {variant}"
            );
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        }
    }
    #[test]
    fn incomplete_cache_is_never_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let modules = root.path().join("modules");
        let resources = Resources::new(modules.clone());
        let url = Url::parse("https://example.com/data.json").unwrap();
        let key = format!("{:x}", Sha256::digest(url.as_str().as_bytes()));
        let target = modules.join(key);
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("authored"), b"preserve").unwrap();
        assert!(resources
            .materialize(&Location::Remote(url), &mut |_| {})
            .is_err());
        assert_eq!(fs::read(target.join("authored")).unwrap(), b"preserve");
    }
    #[test]
    fn rejects_unsafe_paths_collisions_corrupt_crc_and_http_policy() {
        for name in [
            "/absolute",
            "a/../bad",
            "a\\bad",
            "a//bad",
            "C:/bad",
            "CON",
            "a./bad",
        ] {
            assert!(validate_entry(name, false).is_err(), "{name}");
        }
        let root = tempfile::tempdir().unwrap();
        for entries in [
            vec![("a", b"x".as_slice()), ("a/b", b"y".as_slice())],
            vec![("a", b"x".as_slice()), ("A", b"y".as_slice())],
        ] {
            assert!(extract_zip(&archive(&entries), root.path(), |_, _, _| {}).is_err());
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        }
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(
                "crc",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(b"unique payload").unwrap();
        let mut bytes = writer.finish().unwrap().into_inner();
        let offset = bytes
            .windows(14)
            .position(|w| w == b"unique payload")
            .unwrap();
        bytes[offset] ^= 1;
        assert!(extract_zip(&bytes, root.path(), |_, _, _| {}).is_err());
        assert!(validate_url(&Url::parse("http://example.com/pack.zip").unwrap()).is_err());
        assert!(
            validate_url(&Url::parse("https://user:secret@example.com/pack.zip").unwrap()).is_err()
        );
    }
}
