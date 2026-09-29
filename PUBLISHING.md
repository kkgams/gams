# Publishing the GAMS desktop Host — revised NOTICE requires owner review

Target repository: `kkgams/gams`. The standalone Host must have **zero example/station source or pushed history**.
`example.game1` separately owns the example Project, visitor game, and local
setup/integration tooling; verify the generated repositories actually satisfy
this split before pushing. The Host app ZIP contains no
example, Project Units, Project configuration, or game WASM. No example ZIP
is built, uploaded or attached. A user supplies a Project folder with `gams.json` and
working local paths to independently installed Units.

## Revised candidate — NOT APPROVED for this build

The owner approved the **previous** Host-only `NOTICE` on 2026-09-28. The macOS
Project chooser now directly uses objc2-app-kit and objc2-foundation. Both were
already covered by the native appendix, and all third-party Cargo packages,
versions, checksums and edges are unchanged; only the root crate's dependency
edges changed. This changes the Cargo.lock checksum, native appendix header,
47-file evidence manifest and root NOTICE. The **new exact bytes below require
fresh owner approval** before updating `kkgams/gams` Actions variables or
pushing source that would upload an artifact. The existing CI candidate is
for an earlier commit and cannot authorize the new binary. Apache-2.0 remains
approved for GAMS-authored code; `example.game1` has no publication approval.

| Current file / Actions variable | SHA-256 | Status |
| --- | --- | --- |
| `LICENSE` / `LICENSE_SHA256` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | previously approved, unchanged |
| `NOTICE` / `NOTICE_SHA256` | `54845bd559c3edbbb16c4f31d4b0ce11e9547da4592fd5e20e5e688367bb9fa8` | **pending owner approval** |
| `NOTICE-EVIDENCE.sha256` | `c38a82a3d8aff8061a69c41bd3c33256ca5117f9d5ea7b2b7535c914a4ad8bb9` | **pending owner review** |

The clean Host Git history remains required. Confirm `check-source-boundary.py`
passes before the next public push. Do not tag `v2.0.0` until this revised
source, hosted candidate and release rehearsal pass at the same commit.

## Owner publication steps

1. Obtain renewed owner approval of the **exact current** NOTICE and linked
   inputs above, then recompute both digests and update `kkgams/gams` Actions
   **variables** `LICENSE_SHA256` and `NOTICE_SHA256` to the approved bytes.
   The old `NOTICE_SHA256` must not authorize the revised binary. They are not
   secrets. Actions provides `GITHUB_TOKEN`. Confirm the
   public Host branch will contain no pre-split history; never push the
   archived old Host checkout.
2. Owner pushes the local `release` branch. `verify.yml` builds **Apple Silicon
   only**; when both digests match, a branch push uploads one checksummed
   app ZIP. Linux/Windows jobs each upload a ZIP containing only a README
   labeled **NEXT**, with no binary. Review the macOS job log and the
   downloaded ZIP, including exact LICENSE/NOTICE bytes and absence of any
   example source, Project config, Project Units, game WASM, or station ZIP. A green compile without an uploaded
   candidate is
   not distribution approval.
3. The same branch push also rehearses `release.yml`: it checks identity,
   notices, history and offline release gates **without repeating the full
   macOS build**, uploading an artifact or creating a Release. `verify.yml`
   independently builds and uploads the Host candidate at that same commit.
   Inspect both workflows. Optional repeat:
   `gh workflow run release.yml -R kkgams/gams --ref release`.
4. Only after the app ZIP candidate and the branch rehearsal pass on the
   **same release-branch commit**, the owner checks that `v<tauri.conf.json
   version>` has never been pushed, then pushes a new matching version tag.
   Do not move a pushed tag. Tag jobs recheck licensing and require the tag to
   point to the current `release` branch head. The tag job independently
   rebuilds, re-tests and stages the Host; it restores only dependency cache
   entries from successful `release` verification, never a cached app binary.
   It creates a **draft-only** GitHub Release with **one Apple Silicon app ZIP**, a SHA256SUMS file and
   licensing texts. They
   never attach the Linux/Windows roadmap ZIPs to a Release.
5. The owner has chosen an **ad-hoc signed, non-Developer-ID and unnotarized**
   initial macOS distribution. Ad-hoc signing enables local Apple Silicon
   launch but proves no publisher identity. Before publishing the draft,
   verify the app ZIP and Gatekeeper behavior on a clean macOS machine **without
   Nix**. Record the normal first-launch result before any workaround. If
   blocked, a user who trusts the checksummed download may choose
   `xattr -dr com.apple.quarantine /Applications/GAMS.app` for that app only;
   explain that this bypasses the download check, not publisher identity or
   notarization. After that, run a Wasmtime component from a separately
   installed external Project selected via the native folder chooser or
   explicitly with `GAMS_APP_CWD`.
   `check-mac-bundle.sh` rejects any non-system
   dylib path and missing JIT entitlements, but only a launch test proves the
   app actually works. No Developer ID-signed/notarized DMG or Intel app is
   claimed.

Current source version is `2.0.0` (Cargo/Tauri), which is different from
Project Unit distribution and WIT versions. The tag workflow refuses a tag
whose version differs. An existing GitHub Release or API/authentication error
must not be interpreted as permission to overwrite an immutable release.
