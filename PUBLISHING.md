# Publishing the GAMS desktop Host — v2.0.4 notice approval and hosted review pending

## v2.0.4 preparation — exact NOTICE approval and candidate review pending

v2.0.4 adds native runtime configuration, local/shared `gams_modules` storage,
prebuilt direct-file HTTP downloads, WASM byte loading, and `make run`.
ZIP/Git installation and a loading screen are not part of this release.
The native appendix has been regenerated against the updated locked Apple
Silicon graph: 395 crates and 88 full texts, adding 9 crates and 3 texts without
removing or changing prior notices. The five MPL source archives are unchanged.
Root LICENSE, browser bundles, fonts and their license texts are unchanged.
See `docs/http-license-review.md` for the dependency delta and generation commands.
Existing v2.0.0–v2.0.3 tags are immutable. Historical approvals below do not
approve these new exact bytes. **Do not push until owner notice approval; do not
publish the tag until same-commit candidate and clean-Mac review pass.**

Current NOTICE SHA-256: `afe2ab4aa21e5a640f1fc63ba81018b2db3bf37daa78b14e2f814b5a738bc16b`.
Current evidence SHA-256: `64934e3b0f5c8d2a65366dcf3c9bb608e6716d529662a8d1b84d25cc16f06db5`.
See `PUBLISHING.md` for the branch review then tag-push procedure.



Target repository: `kkgams/gams`. The standalone Host must have **zero example/station source or pushed history**.
`example.game1` separately owns the example Project, visitor game, and local
setup/integration tooling; verify the generated repositories actually satisfy
this split before pushing. The Host app ZIP contains no
example, Project Units, Project configuration, or game WASM. No example ZIP
is built, uploaded or attached. A user supplies a Project folder with `gams.json` and
configured prebuilt Unit sources and an available filesystem bootstrap Unit.

## Historical Host notice approval — 2026-09-29

The owner approved the exact **revised** Host-only `NOTICE` and linked evidence
at that time; that approval does not cover the current v2.0.4 table below. The macOS Project chooser directly uses objc2-app-kit and
objc2-foundation, already covered by the native appendix. All third-party
Cargo packages, versions, checksums and edges remain unchanged; only the
GAMS root crate's dependency edges changed. That changed Cargo.lock's
checksum, the native appendix header, 47-file evidence manifest and root
NOTICE. The previous CI candidate was built at an earlier commit and cannot
stand in for hosted review of the revised binary. Apache-2.0 remains approved
for GAMS-authored code; `example.game1` has **no** publication approval.

| Current v2.0.4 file / Actions variable | SHA-256 | Status |
| --- | --- | --- |
| `LICENSE` / `LICENSE_SHA256` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | previously approved, unchanged |
| `NOTICE` / `NOTICE_SHA256` | `afe2ab4aa21e5a640f1fc63ba81018b2db3bf37daa78b14e2f814b5a738bc16b` | **exact-byte owner approval pending** |
| `NOTICE-EVIDENCE.sha256` | `64934e3b0f5c8d2a65366dcf3c9bb608e6716d529662a8d1b84d25cc16f06db5` | **review pending; bound by NOTICE** |

The clean Host Git history remains required. Confirm `check-source-boundary.py`
passes before the next public push. Do not tag `v2.0.4` until this revised
source, hosted candidate and release rehearsal pass at the same commit.

## Automatic tag release notes

After a matching `vX.Y.Z` tag passes all build/notice/history gates, Actions
creates a **public release** whose title is exactly the tag name. Its description starts
with `.github/RELEASE_GUIDE.md` (installation, scope and honest macOS security
instructions), followed by an automatically generated changelog and authors.
No manually maintained per-version RELEASE_NOTES.md is required.

`scripts/generate-release-notes.py` includes **every commit**, including direct
pushes, since the nearest published stable ancestor release. First publication
includes the full Host history. Drafts, prereleases and failed tags are not
baselines. Authenticated Releases API errors fail the job rather than silently
choosing a different history. Author names come from Git; private email
addresses are not published and names are not asserted to be GitHub accounts.

New workflow/source changes do not alter existing immutable tags or existing
drafts. Use a new approved version and tag for future workflow execution; do
not move `v2.0.0`, `v2.0.1`, `v2.0.2` or `v2.0.3` to pick up these improvements. Existing draft
notes may be edited by the owner without modifying the tag or app assets.

On 2026-09-30 the owner approved **automatic public publication on tag push**.
Pushing the version tag is the publication authorization: there is no draft or
manual approval after the build. Complete candidate, external Project and
clean-Mac/Gatekeeper review **before tagging**. GitHub selects Latest using its
default release rules. Branch pushes/manual branch rehearsals publish nothing;
all tag build, exact-notice, source-history and overwrite checks remain required.

## Owner publication steps

1. Obtain approval of the **current exact** NOTICE and linked evidence above.
   Recompute the table, then **replace the old** `kkgams/gams` Actions
   variable `NOTICE_SHA256` with the approved revised digest. Confirm its
   `LICENSE_SHA256` still matches the unchanged LICENSE. These are variables,
   not secrets; Actions provides `GITHUB_TOKEN`. **Update the notice variable
   before pushing** so the branch candidate does not fail closed. Confirm the
   public Host branch contains no pre-split history; never push the archived
   old Host checkout.
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
   It creates a **public** GitHub Release with **one Apple Silicon app ZIP**, a SHA256SUMS file and
   licensing texts. They
   never attach the Linux/Windows roadmap ZIPs to a Release.
5. The owner has chosen an **ad-hoc signed, non-Developer-ID and unnotarized**
   initial macOS distribution. Ad-hoc signing enables local Apple Silicon
   launch but proves no publisher identity. **Before pushing the release tag**,
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

Current source version is `2.0.4` (Cargo/Tauri), which is different from
Project Unit distribution and WIT versions. The tag workflow refuses a tag
whose version differs. An existing GitHub Release or API/authentication error
must not be interpreted as permission to overwrite an immutable release.
