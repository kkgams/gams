use anyhow::{Context, Result};
use serde::Serialize;
use std::time::Duration;

const MAX_DOWNLOAD: usize = 64 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

fn validate_url(url: &reqwest::Url) -> Result<()> {
    anyhow::ensure!(
        url.username().is_empty() && url.password().is_none(),
        "download URLs must not contain credentials"
    );
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    anyhow::ensure!(
        url.scheme() == "https" || (url.scheme() == "http" && loopback),
        "downloads require HTTPS (HTTP is allowed only for loopback testing)"
    );
    Ok(())
}

pub async fn fetch_bytes(
    source: &str,
    mut on_progress: impl FnMut(DownloadProgress) -> Result<()>,
) -> Result<Vec<u8>> {
    let url = reqwest::Url::parse(source).context("invalid download URL")?;
    validate_url(&url)?;
    anyhow::ensure!(
        url.fragment().is_none(),
        "archive selectors are not supported in this slice"
    );
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if let Err(error) = validate_url(attempt.url()) {
                attempt.error(error.to_string())
            } else if attempt
                .previous()
                .last()
                .is_some_and(|url| url.scheme() == "https")
                && attempt.url().scheme() != "https"
            {
                attempt.error("HTTPS downgrade redirect rejected")
            } else {
                attempt.follow()
            }
        }))
        .user_agent("GAMS-Project-Unit-Loader")
        .build()?;
    let mut response = client.get(url).send().await?.error_for_status()?;
    let total = response.content_length();
    anyhow::ensure!(
        total.is_none_or(|size| size <= MAX_DOWNLOAD as u64),
        "download exceeds 64 MiB limit"
    );
    on_progress(DownloadProgress {
        downloaded: 0,
        total,
    })?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        anyhow::ensure!(
            chunk.len() <= MAX_DOWNLOAD - bytes.len(),
            "download exceeds 64 MiB limit"
        );
        bytes.extend_from_slice(&chunk);
        on_progress(DownloadProgress {
            downloaded: bytes.len() as u64,
            total,
        })?;
    }
    anyhow::ensure!(!bytes.is_empty(), "empty download");
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn serve_once(status: &str, body: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/unit.wasm", listener.local_addr().unwrap());
        let status = status.to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        });
        (url, server)
    }

    #[test]
    fn rejects_http_errors_and_unsafe_urls() {
        let executor = tokio::runtime::Runtime::new().unwrap();
        let (url, server) = serve_once("404 Not Found", b"missing".to_vec());
        assert!(executor
            .block_on(fetch_bytes(&url, |_| Ok(())))
            .unwrap_err()
            .to_string()
            .contains("404"));
        server.join().unwrap();
        for source in [
            "file:///tmp/unit.wasm",
            "http://example.com/unit.wasm",
            "https://user:secret@example.com/unit.wasm",
        ] {
            assert!(executor.block_on(fetch_bytes(source, |_| Ok(()))).is_err());
        }
    }

    #[test]
    #[ignore = "requires an external prebuilt FS Unit and local static server; run scripts/test-download-smoke.sh"]
    fn prebuilt_fs_download_save_and_offline_reload_smoke() {
        let base = std::env::var("GAMS_TEST_UNIT_BASE_URL").expect("set GAMS_TEST_UNIT_BASE_URL");
        let executor = tokio::runtime::Runtime::new().unwrap();
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let runtime = crate::runtime::Runtime::new_at(
            root_path.clone(),
            vec![crate::runtime::FsPreopen {
                host_path: root_path.clone(),
                guest_path: root_path.display().to_string(),
            }],
        )
        .unwrap();
        let modules = root_path.join("gams_modules");
        std::fs::create_dir(&modules).unwrap();
        let cache = root_path.join("compiled-cache");
        runtime
            .set_compiled_component_cache_dir(cache.clone())
            .unwrap();
        let fs_bytes = executor
            .block_on(fetch_bytes(&format!("{base}/fs.wasm"), |_| Ok(())))
            .unwrap();
        let fs_path = modules.join("fs.wasm").display().to_string();
        runtime
            .load_from_bytes(fs_bytes.clone(), fs_path.clone())
            .unwrap();
        assert!(!std::path::Path::new(&fs_path).exists());
        let saved = runtime
            .invoke("fs/fs::write-file", serde_json::json!([fs_path, fs_bytes]))
            .unwrap();
        assert!(saved.get("ok").is_some(), "{saved}");
        let js = executor
            .block_on(fetch_bytes(&format!("{base}/view.js"), |_| Ok(())))
            .unwrap();
        let js_path = modules.join("view.js").display().to_string();
        let saved = runtime
            .invoke("fs/fs::write-file", serde_json::json!([js_path, js]))
            .unwrap();
        assert!(saved.get("ok").is_some(), "{saved}");
        runtime.add_plugins(vec![fs_path], true).unwrap();
        let read = runtime
            .invoke("fs/fs::read-file", serde_json::json!([js_path]))
            .unwrap();
        assert_eq!(read["ok"], serde_json::json!(js));
        assert!(
            cache.is_dir(),
            "path-based reload should populate the existing compiled cache"
        );
        // Another Project reuses this store through an explicit shared preopen,
        // loading only persisted files with no network calls.
        let offline_root = tempfile::tempdir().unwrap();
        let offline = crate::runtime::Runtime::new_at(
            offline_root.path().to_path_buf(),
            vec![crate::runtime::FsPreopen {
                host_path: modules.clone(),
                guest_path: modules.display().to_string(),
            }],
        )
        .unwrap();
        offline
            .add_plugins(vec![modules.join("fs.wasm").display().to_string()], false)
            .unwrap();
        assert_eq!(
            offline
                .invoke("fs/fs::read-file", serde_json::json!([js_path]))
                .unwrap()["ok"],
            serde_json::json!(js)
        );
    }

    #[test]
    fn downloads_binary_component_from_local_http_server_with_progress() {
        let bytes = b"\0asm\x0d\0\x01\0".to_vec();
        let (url, server) = serve_once("200 OK", bytes.clone());
        let mut progress = Vec::new();
        let downloaded = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_bytes(&url, |event| {
                progress.push(event);
                Ok(())
            }))
            .unwrap();
        server.join().unwrap();
        assert_eq!(downloaded, bytes);
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let runtime = crate::runtime::Runtime::new_at(
            root_path.clone(),
            vec![crate::runtime::FsPreopen {
                host_path: root_path.clone(),
                guest_path: ".".into(),
            }],
        )
        .unwrap();
        let path = root_path.join("unit.wasm");
        runtime
            .load_from_bytes(downloaded.clone(), path.display().to_string())
            .unwrap();
        std::fs::write(&path, downloaded).unwrap();
        runtime
            .add_plugins(vec![path.display().to_string()], true)
            .unwrap();
        assert_eq!(progress.last().unwrap().downloaded, bytes.len() as u64);
        assert_eq!(progress.last().unwrap().total, Some(bytes.len() as u64));
    }
}
