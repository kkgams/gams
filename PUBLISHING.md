# Publishing the GAMS desktop Host — NOT READY

Target repository: `kkgams/gams`. The standalone Host must have **zero example/station source or pushed history**.
`example.game1` separately owns the example Project, visitor game, and local
setup/integration tooling; verify the generated repositories actually satisfy
this split before pushing. The Host app ZIP contains no
example, Project Units, Project configuration, or game WASM. No example ZIP
is built, uploaded or attached. A user supplies a Project folder with `gams.json` and
working local paths to independently installed Units.

## Blockers before any public source push

- Audit the generated Host tree, source archives, staging, and public Git
  history for example/station source; none may remain. Removing working-tree
  files alone does not erase earlier commits. Review `example.game1`
  independently; it does not inherit Host licensing clearance.
- Apache-2.0 for GAMS-authored Host/Runtime code is approved.
  The current root `NOTICE` and `NOTICE-EVIDENCE.sha256` are a **fresh Host-only
  candidate**, not owner approval. The manifest pins 47 browser/font/native
  inputs; obtain **fresh owner approval** of the exact root `NOTICE` and linked
  terms. Five unmodified MPL crate
  source archives are also offered beside the `.app`. The inventory in
  `THIRD-PARTY-REVIEW.md` records
  known provenance limits: historical browser bundles do not identify exact
  resolved transitive versions. **Do not push the public source branch**, set
  Actions digest variables or upload Host binaries until the Host's clean
  source/history is verified and the owner approves the exact Host NOTICE and
  license appendices. Never reuse another Unit's approval.

## After source/notice review

1. After confirming zero example/station source in Host tree and pushed history,
   and obtaining fresh owner approval of the Host-only `NOTICE` and linked terms,
   compute root `LICENSE` and `NOTICE` SHA-256 values. Set repository
   Actions **variables** (`LICENSE_SHA256`, `NOTICE_SHA256`) on `kkgams/gams`;
   they are not secrets. Actions provides `GITHUB_TOKEN`.
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
