# Publishing the GAMS desktop Host

## v2.0.7 preparation — exact NOTICE approval pending

The next patch adds the generated Game Icons ligature font, selectable-cell grid
support, and Host-owned View documentation with a local wiki preview. Cargo/Tauri
version is 2.0.7. The ten existing fonts, browser bundles, native dependencies and
MPL source archives are unchanged; the new font, attribution and bounded evidence
delta are documented in [v2.0.7 review](docs/release-2-0-7-review.md).

Candidate NOTICE SHA-256: `80d419c3319abf2edc490b3bd397128b415fd56862c17d1fab4e12b09c544b37`.
Candidate evidence SHA-256: `bbc746f822cfa06a4f3072bb6b1c9925a0fb3297c994f6f9b8fd545745292c04` (57 inputs).

These are prepared candidate bytes, not owner-approved digests. Before pushing,
obtain exact approval and update the repository Actions `NOTICE_SHA256` variable.
Hosted same-commit candidate/rehearsal and external-Project/clean-Mac review remain
required before creating/pushing a release tag. Historical records below do not
approve this version. No remote mutation/publication is part of this preparation.

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



Target repository: `kkgams/gams`. The standalone Host must have **zero example/station source or pushed history**.
`example.game1` separately owns the example Project, visitor game, and local
setup/integration tooling; verify the generated repositories actually satisfy
this split before pushing. The Host app ZIP contains no
example, Project Units, Project configuration, or game WASM. No example ZIP
is built, uploaded or attached. A user supplies a Project folder with `gams.json` and
configured prebuilt Unit sources and an available filesystem bootstrap Unit.

## Historical Host notice approval — 2026-09-29

The owner approved the exact **revised** Host-only `NOTICE` and linked evidence
at that time; historical approvals do not cover the v2.0.5 candidate table below. The macOS Project chooser directly uses objc2-app-kit and
objc2-foundation, already covered by the native appendix. All third-party
Cargo packages, versions, checksums and edges remain unchanged; only the
GAMS root crate's dependency edges changed. That changed Cargo.lock's
checksum, the native appendix header, 47-file evidence manifest and root
NOTICE. The previous CI candidate was built at an earlier commit and cannot
stand in for hosted review of the revised binary. Apache-2.0 remains approved
for GAMS-authored code; `example.game1` has **no** publication approval.

| Candidate v2.0.5 file / Actions variable | SHA-256 | Status |
| --- | --- | --- |
| `LICENSE` / `LICENSE_SHA256` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | previously approved, unchanged |
| `NOTICE` / `NOTICE_SHA256` | `7d0ea634ae6cebb1e9a95aacead7304461f4e1b60a48f2a71786c4a776f10b8d` | owner-approved 2026-10-12 |
| `NOTICE-EVIDENCE.sha256` | `b19ed41a33a215e6594065b04b53c6c0b40bf1971cccb6665ab256a6f353b86c` | owner-approved 2026-10-12; bound by NOTICE |

The clean Host Git history remains required. Confirm `check-source-boundary.py`
passes before the next public push. Do not tag `v2.0.5` until this revised
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
not move `v2.0.0`, `v2.0.1`, `v2.0.2` or `v2.0.3` or `v2.0.4` to pick up these improvements. Existing draft
notes may be edited by the owner without modifying the tag or app assets.

On 2026-09-30 the owner approved **automatic public publication on tag push**.
Pushing the version tag is the publication authorization: there is no draft or
manual approval after the build. Complete candidate, external Project and
clean-Mac/Gatekeeper review **before tagging**. GitHub selects Latest using its
default release rules. Branch pushes/manual branch rehearsals publish nothing;
all tag build, exact-notice, source-history and overwrite checks remain required.

## v2.0.5 owner-directed publication exception — 2026-10-12

After exact NOTICE/evidence approval and local build/ZIP verification, the owner
explicitly requested “commit / push / release”, treating this patch preparation
as sufficient without further manual review. For v2.0.5 only, proceed after the
same-commit hosted candidate and rehearsal pass; do not claim a new external-
Project desktop or clean-Mac/Gatekeeper test. This does not weaken notice,
source-history, CI, immutable-tag or artifact-byte checks, and does not waive
manual review for future releases.

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

Current source version is `2.0.7` (Cargo/Tauri), which is different from
Project Unit distribution and WIT versions. The tag workflow refuses a tag
whose version differs. An existing GitHub Release or API/authentication error
must not be interpreted as permission to overwrite an immutable release.
