## GAMS desktop Host — Apple Silicon

Download `GAMS-<version>-macos-aarch64.zip` and `SHA256SUMS-macos-aarch64` from this release. In the download directory, verify before extracting:

```sh
shasum -a 256 -c SHA256SUMS-macos-aarch64
```

Extract the ZIP and copy `GAMS.app` to `/Applications`. Keep its accompanying notices and provenance materials. This distribution includes **only the Host**: no example, Project, game, or Project Units. Supply a Project folder containing `gams.json` that refers to separately installed Units. Double-click the app and select that folder; Terminal/automation can use `GAMS_APP_CWD=/absolute/project/path /Applications/GAMS.app/Contents/MacOS/gams`.

### Project Unit downloads

Direct HTTPS file sources can be installed into `<project>/gams_modules`. Set
`GAMS_MODULES_DIR` to an absolute directory path to share installed files across
Projects. Only prebuilt Units are supported; no downloaded build scripts run.
ZIP/Git sources and a download loading screen are not implemented yet. The
filesystem bootstrap still requires the separately installed local
`plugins/fs.comp.wasm`. Downloaded Units execute code: use trusted sources; TLS
and cached files are not publisher verification or a reproducible package lock.

### macOS security and support

Apple Silicon only. The app is **ad-hoc signed, not Developer ID signed or notarized**; no publisher identity is certified. macOS may block an internet-downloaded app. Verify the checksum and review the source and license materials before deciding whether to run it. Do not disable system-wide security protections.

If you trust this verified download and accept the risk, removing quarantine from this app alone is an explicit bypass of the download check, **not** notarization or publisher verification:

```sh
xattr -dr com.apple.quarantine /Applications/GAMS.app
```

Intel, Linux, and Windows binaries are not included. Third-party terms remain unchanged; see `LICENSE`, `NOTICE`, and the license/provenance/source materials inside the ZIP.
