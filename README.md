# GAMS Host

## v2.0.6 preparation — exact NOTICE approval pending

The next patch selects the Project's sole `plugin.fs.wasm` source for filesystem
bootstrap, falling back to the Host pin only when absent. It rejects ambiguous
sources and propagates selected-source failures without fallback.

Cargo/Tauri version is 2.0.6. The Cargo lock changes only the GAMS root version;
all third-party dependencies, license texts, fonts and browser bundles remain
unchanged. The native appendix lock header and NOTICE evidence binding were
refreshed within that boundary. Prior v2.0.5 approval does not cover these bytes.

Candidate NOTICE SHA-256:
`d07358be3f843224abc852fd8d468c6d83e70dc0ac171943a8320d474c923196`.
Candidate evidence SHA-256:
`0072f2f125875bfb7246b33d986d930b552fc827d3328d76980ddd27de6dc698`.

See [v2.0.6 review](docs/release-2.0.6-review.md) for checks and remaining gates.
The v2.0.5-only manual-review exception does not apply to this release.
The following v2.0.5 sections are retained as historical preparation evidence.


## v2.0.5 preparation — NOTICE approved; release review pending

v2.0.4 is published. v2.0.5 adds Project Save hooks/progress, ZIP Project Unit
installation, startup progress with early Project-theme adoption, and a refreshed
app icon. Git installation remains unimplemented. ZIP extraction is a limited
slice, not a hardened installer for hostile archives.

The candidate NOTICE now covers zip.js and its embedded zlib fallback; 51 inputs
are bound by the refreshed evidence manifest. Native dependencies remain at
395 crates and 88 full texts; only the Host version and lock digest changed.
Fonts, prior browser bundles, upstream license texts and MPL archives are unchanged.

On 2026-10-12 the owner approved the exact NOTICE and linked evidence below.
This is notice approval, not publication authorization. Same-commit hosted
candidate/rehearsal, external-Project desktop smoke and clean-Mac/Gatekeeper
review are still required before tagging.

Candidate NOTICE SHA-256: `7d0ea634ae6cebb1e9a95aacead7304461f4e1b60a48f2a71786c4a776f10b8d`.
Candidate evidence SHA-256: `b19ed41a33a215e6594065b04b53c6c0b40bf1971cccb6665ab256a6f353b86c`.
See `docs/release-2.0.5-review.md` for the bounded refresh and `PUBLISHING.md`
for approval and publication gates.



`gams` is the standalone GAMS Runtime, Tauri desktop Host, and shared Host UI
API. It must contain **zero example/station source**, including in the history
pushed to its public remote. The separate `example.game1` repository owns the
example Project and visitor game. The Host neither vendors Project Units nor
ships a Project or station ZIP. Users supply an external Project root with
`gams.json` paths to independently installed Units.

## Development

Initial Host distribution target: current supported macOS on **Apple Silicon**
with Xcode command-line tools. Intel release builds are deferred.

With Nix and direnv installed and direnv hooked into your shell, run
`direnv allow` once in this repository. Entering the directory then automatically
loads the pinned Host development environment (Rust/Cargo, Tauri CLI, Node.js,
Python, pkg-config, and Make). After activation, use `make run` or `make app-check`
directly. Xcode command-line tools remain a system prerequisite. Without direnv,
use the explicit Nix commands below.

```sh
nix develop --command make run         # Build/run from source; choose a Project
nix develop --command make run GAMS_APP_CWD=../example.game1
nix develop --command make app-check   # Host-only; no sibling repositories required
nix develop --command make app-build-release
nix develop --command make app-bundle-release APP_BUNDLES=app
```

`make run` aliases `app-run` and starts `cargo tauri dev` with the frontend dev
server and native source rebuilds. Without `GAMS_APP_CWD`, macOS opens the Project
folder picker. Explicit relative Project paths are resolved before entering the
Tauri source directory. Missing remote Project Units are downloaded at startup, including the pinned
filesystem bootstrap release; this target does not build or assemble sibling
repositories. Projects must declare all six bootstrap UI Service URLs under
`ui.services` (see `docs/direct-file-downloads.md`).

For local example development, use `example.game1`'s setup and integration
tools. Its assembly copies (not symlinks) artifacts from these independent Unit
repositories into the example Project, retaining the paths in `gams.json`:

- `plugin.fs`, `plugin.layout`, `plugin.lua`, `plugin.director-compiler`, and
  `plugin.respack` -> `plugins/{fs,layout,lua,director-compiler,respack}.comp.wasm`
- `ui-service.context`, `ui-service.keys`, `ui-service.layout`,
  `ui-service.toast`, `ui-service.popup`, and `ui-service.tooltip` ->
  `ui-plugins/{context,keys,layout,toast,popup,tooltip}.js`
- `view.files`, `view.code`, `view.ng`, `view.ng-node`, `view.files-rename`, and
  `view.files-default` ->
  `views/{view-files,view-code,view-ng,view-ng-node,files-rename,files-default}.js`
- `theme.the98` -> `themes/the98.css`

The filesystem plugin is required by Host bootstrap even though it is not in
the Project's `plugins` array. The development Host selects the sole Project `plugins` source named exactly
`plugin.fs.wasm`, falling back to the pinned FS v0.1.1 release only when absent.
Multiple matches and configured-source failures are errors. `example.game1` now uses release URLs for GUI
Units; local assembly remains separate tooling for native CLI integration.
Host builds do not assemble or bundle these Units. Build the visitor game using
`example.game1`'s instructions.

## Project bootstrap and Unit storage

After `await runtime.ready`, frontend code can read native-loaded `gams.json`
as `runtime.config` and the selected Unit storage path as `runtime.modulesDir`.
Configuration reading does not depend on the filesystem plugin. Direct-file
HTTPS (and loopback HTTP test) sources can be downloaded and installed via
`require` and configured WASM/theme loading. The development ZIP slice also
supports `https://example.com/unit.zip#path/to/entry`, extracting packages through
the filesystem plugin. A Host-owned startup screen reports per-Unit downloads,
ZIP extraction, cache reuse and initialization, with visible errors and reload;
see `docs/project-loading.md`. Git sources are not implemented.
FS bootstrap uses the configured `plugin.fs.wasm` local/direct-file source,
or the pinned v0.1.1 fallback if absent; it does not accept ZIP sources. See `docs/direct-file-downloads.md` for APIs and the local-server smoke
test, and `docs/zip-project-units.md` for ZIP scope, deferred safeguards and tests.
The ZIP browser bundle is covered by the v2.0.5 candidate NOTICE/evidence and
readable license packaging; exact NOTICE/evidence was owner-approved 2026-10-12.

GUI startup creates `<project>/gams_modules` by default. Set `GAMS_MODULES_DIR`
to a non-empty absolute directory path to select shared storage instead. The
selected directory is canonicalized and preopened for runtime/filesystem access;
there is no local fallback when the override is set. CLI commands, including
`init`, do not require this GUI bootstrap or an existing config.

See `docs/project-unit-installation.md` for the remaining installation design.

## Host UI URL contract

The Host continues to expose these existing URL roots as owned files:

- `/core` from `cmd/app/src/core`
- `/util`, `/widgets`, `/css`, and `/fonts` from real directories under
  `cmd/app/src`

Those served directories are the canonical, Host-owned editable sources. There
is no duplicate `packages/` tree. They are internal shared Host UI API, not
separately extracted helper repositories.

The current `gams.json` shape and bootstrap ordering are pre-release contracts.
This extraction intentionally does **not** perform a broad runtime-config
migration. Independent Unit resolution and the planned Project Config migration
remain known gaps.

## Verification and release status

Run `make app-check` in the Nix environment for the pure Host compile check.
Run the assembled example smoke and visitor game from `example.game1` using
that repository's documented tools, not Host-local setup or integration scripts.
The Host-only release builds are `make app-build-release` and
`make app-bundle-release APP_BUNDLES=app`; they do not bundle example source,
Project config, game WASM, or station Project Units.
The Host uses an external Project folder as its runtime root; do not compile
in a developer's station path. On macOS, double-click `GAMS.app` to choose an
existing folder containing `gams.json` through a native folder picker. Cancel
exits. An explicit `GAMS_APP_CWD` skips the picker; to launch an existing
Project from Terminal, run `GAMS_APP_CWD=/absolute/path/to/project
/Applications/GAMS.app/Contents/MacOS/gams`. Running the executable from an
existing Project directory also uses that directory. No Project or Unit is
bundled with the Host.

`verify.yml` builds **Apple Silicon only**; Intel is deferred. Separate Linux
and Windows jobs publish conspicuous **README-only** roadmap ZIPs: no binary,
installer, or supported Linux/Windows release exists yet. The macOS branch
candidate is **one Host app ZIP**, uploaded only when reviewed `LICENSE`/`NOTICE`
match this repository's Actions variables `LICENSE_SHA256` and `NOTICE_SHA256`.
No example source or compiled game WASM is attached. The app ZIP includes
readable font and browser-bundle license texts, pinned provenance,
the native-license appendix and original source archives for five MPL-covered
crates beside the `.app` (Tauri embeds the frontend assets in the executable).
`NOTICE-EVIDENCE.sha256` binds 51 Host-only third-party inputs to the candidate
`NOTICE`, including zip.js and its fallback notices. Historical v2.0.4 approval
does not cover these bytes; the owner separately approved them on 2026-10-12.
Update GitHub Actions digests before an authorized candidate push. Gates:
`PUBLISHING.md`.

`release.yml` rehearses on `release` without publishing. After all gates pass,
a matching owner-pushed version tag automatically creates a **public** Apple
Silicon-only Release, named after the tag, with installation instructions and
a generated commit/author changelog. Tag push is publication authorization. Initial builds use an **ad-hoc** local
signature so Apple Silicon can launch them—no Developer ID certificate or
Apple notarization. Wasmtime JIT needs two explicit hardened-runtime memory
entitlements. The bundle target rewrites the Nix toolchain's **known** libiconv
reference to the macOS system library, re-signs with those entitlements and
rejects any remaining non-system library path before staging. A build from a
Nix shell is not proof that the `.app` runs without Nix. Gatekeeper may warn
about internet-downloaded builds; test this and invoke a real component on a
clean machine **before pushing the version tag**.

### Installing the initial unnotarized app (after release review)

Download the Apple Silicon app ZIP **and** `SHA256SUMS-macos-aarch64` from
this repository's official GitHub Release. On an Apple Silicon Mac, verify
both the download's origin and the checksum before extracting or running it:

```sh
cd ~/Downloads
awk '$2 == "GAMS-2.0.5-macos-aarch64.zip" {print}' SHA256SUMS-macos-aarch64 | shasum -a 256 --check
mkdir -p gams-2.0.5
ditto -x -k GAMS-2.0.5-macos-aarch64.zip gams-2.0.5
ditto gams-2.0.5/GAMS.app /Applications/GAMS.app
codesign --verify --deep --strict /Applications/GAMS.app
```

The initial app is ad-hoc signed and **not notarized**. If Gatekeeper blocks
that verified app, `xattr -dr com.apple.quarantine /Applications/GAMS.app` is
the correct macOS command to remove quarantine **from this app only**; it opts
out of Gatekeeper's download check for those files. Use it only when you trust
the source and accept that risk, not as an automated install step or a
system-wide security change. You may need administrator permission to modify
an app you placed in `/Applications`. This does not give the app a Developer ID
signature or notarization. For the current Host, launch from Terminal with
`GAMS_APP_CWD` pointing at your own Project as shown above; you must install
its Project Units separately.

Apache-2.0 for GAMS-authored Host code remains owner-approved. The v2.0.5
NOTICE/evidence was separately owner-approved on 2026-10-12. Update
`NOTICE_SHA256` before an authorized push and inspect the hosted candidate;
see `LICENSING.md`, `THIRD-PARTY-REVIEW.md`, and `PUBLISHING.md`.
The separate `example.game1` repository is **not** approved
for publication by that Host decision. The owner still needs to configure the
Host's exact approval digests, push the clean-history branch, inspect hosted
candidates, and test a downloaded app on a clean Mac before pushing a release tag.

The old station integration and game-owned tests belong to `example.game1`,
not the Host. Host `app-check` covers Host-only compilation; it does not prove
an external Project works. Cargo tests cover native/fixture-free Rust units;
legacy runtime tests requiring monorepo plugin fixtures remain excluded.
Exercise the runtime with an externally supplied Project through the example
repository's integration test and perform a clean-machine Host bundle check
before release.
