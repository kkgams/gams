# Publishing the GAMS desktop Host — source approved, candidate review pending

Target repository: `kkgams/gams`. The standalone Host must have **zero example/station source or pushed history**.
`example.game1` separately owns the example Project, visitor game, and local
setup/integration tooling; verify the generated repositories actually satisfy
this split before pushing. The Host app ZIP contains no
example, Project Units, Project configuration, or game WASM. No example ZIP
is built, uploaded or attached. A user supplies a Project folder with `gams.json` and
working local paths to independently installed Units.

## Approved Host source and notice — 2026-09-28

The owner approved this **Host-only** source and its exact root `NOTICE` after
reviewing the disclosed historical Ajv/markdown-it bundle-version limit. The
notice binds 47 browser/font/native evidence files, including complete license
texts and five original MPL crate source archives. Apache-2.0 approval applies
to GAMS-authored Host/Runtime code only; `example.game1` requires its **own**
source and notice approval. Never reuse another Unit's approval.

Approved bytes (verify again immediately before configuring distribution):

| File / Actions variable | SHA-256 |
| --- | --- |
| `LICENSE` / `LICENSE_SHA256` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `NOTICE` / `NOTICE_SHA256` | `829bfb24dadbe1bfa6990527cf4c758c706f173dace0b912b81672d93ac0a3c5` |
| `NOTICE-EVIDENCE.sha256` (bound by `NOTICE`) | `3885b014c70012bc60ccb04139fa5513be6ef26ff1e6fa93fbc536fe24da0af7` |

The local Host `release` branch was rebuilt with a clean root history; the
`check-source-boundary.py` gate rejects example source in the worktree or any
ancestor. Its local Apple Silicon ZIP passed signature, evidence, checksum and
external-Project launch checks. **No public Host push, GitHub variable, hosted
candidate or clean-Mac Gatekeeper test has happened yet.** These are distinct
from notice approval and still gate release publication.

## Owner publication steps

1. Recompute and compare the table above, then set `kkgams/gams` repository
   Actions **variables** `LICENSE_SHA256` and `NOTICE_SHA256` to those exact
   values. They are not secrets. Actions provides `GITHUB_TOKEN`. Confirm the
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
3. Rehearse `release.yml` on the branch (no upload/release on manual dispatch):
   `gh workflow run release.yml -R kkgams/gams --ref release`. Inspect its job.
4. Only after the app ZIP candidate and the branch rehearsal pass on the
   **same release-branch commit**, the owner checks that `v<tauri.conf.json
   version>` has never been pushed, then pushes a new matching version tag.
   Do not move a pushed tag. Tag jobs recheck licensing and require the tag to
   point to the current `release` branch head. They create a **draft-only**
   GitHub Release with **one Apple Silicon app ZIP**, a SHA256SUMS file and
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
   installed external Project selected using `GAMS_APP_CWD`.
   `check-mac-bundle.sh` rejects any non-system
   dylib path and missing JIT entitlements, but only a launch test proves the
   app actually works. No Developer ID-signed/notarized DMG or Intel app is
   claimed.

Current source version is `2.0.0` (Cargo/Tauri), which is different from
Project Unit distribution and WIT versions. The tag workflow refuses a tag
whose version differs. An existing GitHub Release or API/authentication error
must not be interpreted as permission to overwrite an immutable release.
