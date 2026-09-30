# GAMS Host

## v2.0.3 preparation — exact NOTICE approval pending

v2.0.3 corrects release-notes generation: paginated GitHub API output is
flattened with external jq, without the incompatible gh --slurp/--jq pairing.
Regression tests cover multiple pages, no releases and API failures. Releases
remain automatically **public** after tag gates, with tag-named titles and
complete commit/author notes. Existing v2.0.0–v2.0.2 tags are immutable.
The version bump changes only the GAMS package version in Cargo.lock and its
linked notice evidence; no third-party package or upstream license text changes.
Earlier notice approvals below are historical, not approval of these new bytes.
**Do not push until owner approval; a version tag authorizes public publication.**

Current NOTICE SHA-256: `31bf9dfb5321e81b8f1911b579d7541fe5fcb3acb304c42774346031b0fd46dd`.
Current evidence SHA-256: `ccf527975996844ab638866d70ab992b8ce71949d4ff8b708eb0f7f66b616781`.
See `PUBLISHING.md` for the branch review then tag-push procedure.



`gams` is the standalone GAMS Runtime, Tauri desktop Host, and shared Host UI
API. It must contain **zero example/station source**, including in the history
pushed to its public remote. The separate `example.game1` repository owns the
example Project and visitor game. The Host neither vendors Project Units nor
ships a Project or station ZIP. Users supply an external Project root with
`gams.json` paths to independently installed Units.

## Development

Initial Host distribution target: current supported macOS on **Apple Silicon**
with Xcode command-line tools. Intel release builds are deferred.

```sh
nix develop --command make app-check   # Host-only; no sibling repositories required
nix develop --command make app-build-release
nix develop --command make app-bundle-release APP_BUNDLES=app
```

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
the Project's `plugins` array. The example repository checks assembly before
its integration/run steps. Host release builds do not assemble or bundle any
of these Units. Build the visitor game using `example.game1`'s instructions.

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
`NOTICE-EVIDENCE.sha256` binds 47 Host-only third-party inputs to the root
`NOTICE`. The owner approved the revised exact bytes on 2026-09-29 for the
macOS Project picker; the prior approval digest must be replaced in GitHub
Actions **before pushing**. Publication gates are recorded in `PUBLISHING.md`.

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
awk '$2 == "GAMS-2.0.3-macos-aarch64.zip" {print}' SHA256SUMS-macos-aarch64 | shasum -a 256 --check
mkdir -p gams-2.0.3
ditto -x -k GAMS-2.0.3-macos-aarch64.zip gams-2.0.3
ditto gams-2.0.3/GAMS.app /Applications/GAMS.app
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

Apache-2.0 for GAMS-authored Host code and the exact **revised** Host-only
`NOTICE` are owner-approved. Update the repository's `NOTICE_SHA256` variable
before pushing and inspect the new hosted candidate; see `LICENSING.md`,
`THIRD-PARTY-REVIEW.md`, and `PUBLISHING.md`.
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
