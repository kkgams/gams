# v2.0.5 release preparation and bounded NOTICE refresh

Status: **exact NOTICE/evidence owner-approved on 2026-10-12**. Local build
and checks passed. Hosted candidate/rehearsal, external-Project desktop smoke
and clean-Mac/Gatekeeper review were pending at preparation. The owner
subsequently explicitly authorized “commit / push / release” on 2026-10-12,
accepting the patch preparation without further manual review. Publication will
still require same-commit CI gates and immutable-tag/artifact checks; no new
clean-Mac or external-Project desktop result is claimed. See the version-specific
exception in PUBLISHING.md.

## Release scope

Changes since published v2.0.4:

- Native File → Save Project, ordered JS persistence hooks, config publication,
  shared in-flight saves, and progress/error feedback. Keyboard bindings remain
  Project-owned. See [Project saving](project-saving.md).
- ZIP Project Unit sources with explicit entry selectors, staged extraction and
  offline reuse, plus Project-configured shell UI Service sources. Filesystem
  bootstrap uses its independent pinned v0.1.1 direct-file release.
- Startup download/extraction/cache progress, visible failures/reload, early
  external Project theme adoption, themeless fallback and refreshed Host icon.
  See [Project loading](project-loading.md).
- A release-check regression fix: `grep -q` could close the verbose codesign pipe
  early, causing SIGPIPE under `pipefail` and falsely rejecting an ad-hoc bundle.
  The checker now consumes all output without changing signature requirements;
  a failing-then-passing regression test covers the production pipeline.

ZIP extraction remains a limited slice, not a hostile-archive security boundary.
CRC verification, expanded-byte/count limits, archive-level deduplication and
package-relative JS imports are deferred. Git sources remain unimplemented.
See [ZIP scope and limitations](zip-project-units.md).

The Host still contains no external Project, Project Units, example/game source
or compiled game. Apple Silicon app-only, ad-hoc signed/unnotarized distribution
remains the target; Linux/Windows artifacts remain README-only roadmaps.

## Authorized refresh boundary

The owner authorized v2.0.5 preparation and NOTICE/evidence refresh in this
session, then approved the exact NOTICE and its linked evidence on 2026-10-12.
That approval does not authorize publication or changes to these bound bytes.
The historical v2.0.4 tag and its approval are unchanged and remain available
as the audit baseline (`git show v2.0.4:<path>`).

- Cargo/Tauri Host version: 2.0.4 → 2.0.5. Cargo.lock changes only the root
  `gams` version; every third-party package, checksum and dependency edge is
  unchanged (verified by parsed lockfile comparison with root version removed).
- Native appendix: only its Cargo.lock digest line changes. Regeneration with
  the saved v2.0.4 cargo-about JSON and new lock reproduces the candidate exactly.
  The index remains 395 crates / 88 full texts. All license-text bytes, including
  embedded CRLF line endings, are preserved. No new native license audit is claimed.
- Evidence: 47 → 51 inputs. Of the prior 47, only Cargo.lock and the native
  appendix hashes change. Add exactly the ZIP bundle, its LICENSE, fallback
  license and PROVENANCE.md. All prior font/browser/native source/license inputs
  remain byte-identical.
- NOTICE: add ZIP attribution and retained-license paths, explicitly distinguish
  the altered zlib port, disclose unknown fallback build revision, and update
  its evidence binding. Prior attribution remains intact.
- Packaging/checks: stage the ZIP library's two original license texts and
  provenance under `BUNDLE-LICENSES/zipjs/`; reject missing/altered members and
  evidence. No approval gate is bypassed or weakened.

Historical approved NOTICE SHA-256:
`afe2ab4aa21e5a640f1fc63ba81018b2db3bf37daa78b14e2f814b5a738bc16b`.
Historical evidence SHA-256:
`64934e3b0f5c8d2a65366dcf3c9bb608e6716d529662a8d1b84d25cc16f06db5`.

## ZIP redistribution evidence

`cmd/app/src/util/vendor/zipjs/PROVENANCE.md` records official npm zip.js 2.23.0
package and bundle hashes and upstream license URLs. During preparation:

- Downloaded the official pinned npm tarball; its SHA-256 matched the recorded
  receipt. Its `index-native.min.js` and LICENSE matched local bytes exactly.
- The package's zlib-js README identifies the zlib-streams-ts fallback family.
- Downloaded the retained fallback license at its pinned upstream revision;
  bytes matched the saved combined BSD-3-Clause/zlib text exactly.

The exact fallback source revision used by npm remains unestablished. This is a
bounded attribution/packaging review, not a reproducibility or security audit.
Both BSD redistribution notices and the zlib origin/alteration notice are
retained, not rewritten or represented as GAMS compression authorship.

## Candidate review digests

| File | SHA-256 | Status |
| --- | --- | --- |
| LICENSE | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | unchanged, previously approved |
| NOTICE | `7d0ea634ae6cebb1e9a95aacead7304461f4e1b60a48f2a71786c4a776f10b8d` | owner-approved 2026-10-12 |
| NOTICE-EVIDENCE.sha256 | `b19ed41a33a215e6594065b04b53c6c0b40bf1971cccb6665ab256a6f353b86c` | owner-approved 2026-10-12, bound by NOTICE |
| NATIVE-NOTICES.md | `3cd6bf957395264773cf60fb7449bbac1f91ec5aed88128e0c217320dabbda59` | header-only delta |
| cmd/app/src-tauri/Cargo.lock | `02e1b423b2c2911d662e9ed4ed526090e6352d5b09b14cb21f7c54d0f3ed0670` | root-version-only delta |

## Local validation

Passed:

```sh
python3 scripts/check-source-boundary.py
python3 scripts/check-native-notices.py
python3 scripts/check-mpl-source.py
python3 scripts/check-notice-evidence.py
python3 -m unittest discover -s test -p 'test_*.py'
nix develop --command make app-check app-test app-bundle-release APP_BUNDLES=app
bash scripts/check-mac-bundle.sh build.nosync/app/target/release/bundle/macos/GAMS.app
git diff --check
```

- 14 Python publication-gate/release-note tests, including missing/altered ZIP
  notices/evidence and the verbose-signature SIGPIPE regression.
- 42 JS tests and 12 Rust tests passed. 21 Rust tests remain explicitly ignored:
  20 legacy fixture tests and one opt-in external-FS download smoke.
- Optimized local Apple Silicon app built; Info.plist reports 2.0.5. Separate
  bundle checks passed for signature, system-only links and JIT entitlements.
- Synthetic notice ZIP checks passed; they test packaging byte contracts, not
  a staged or uploaded release candidate. Full build log is in ignored
  `build.nosync/release-2.0.5-validation.log`.

After notice approval on 2026-10-12, `scripts/stage-mac-candidate.sh` passed
using the approved LICENSE/NOTICE digests: ZIP integrity and checksum passed;
38 readable notice/provenance/source files matched their reviewed bytes.
The local archive is `dist/macos-aarch64/GAMS-2.0.5-macos-aarch64.zip` (ignored),
SHA-256 `094f4523ea956d04909d397ac399563153b2a4468506d8d858f1a6fd71ab94dd`.
The ZIP was also extracted to a fresh temporary directory; the extracted app
passed portable-link, ad-hoc signature and JIT-entitlement checks. This is a
locally staged preparation candidate, not a hosted same-commit artifact.
The working tree has not been committed. Log: `build.nosync/release-2.0.5-staging.log`.

Not verified: v2.0.5 external-Project desktop Save/ZIP/theme startup smoke,
opt-in external-FS smoke, hosted same-commit candidate/rehearsal, downloaded ZIP
review or clean-Mac/Gatekeeper behavior.

## Remaining gates

1. Exact NOTICE/evidence approval is complete (2026-10-12). Preserve these bytes.
   The bound ZIP PROVENANCE.md retains its preparation-time pending status as
   historical evidence; this record supersedes that status. Editing the bound
   provenance to record approval would change the approved digest unnecessarily.
2. Commit/push/publication authorization was given 2026-10-12. Update Actions
   `NOTICE_SHA256` to the approved digest; confirm unchanged `LICENSE_SHA256`.
   Retain all immutable existing tags.
3. Review hosted candidate and rehearsal at the same release-branch commit;
   inspect the app ZIP's new readable ZIP notices and absence of Project assets.
4. Additional external-Project desktop and clean-Mac/Gatekeeper review is not
   being performed under the owner's v2.0.5-only publication exception. These
   outcomes remain unverified, not silently marked passed.
5. After hosted candidate/rehearsal and artifact checks pass, push a fresh
   matching v2.0.5 tag under the owner's publication authorization. Tag push
   automatically publishes a public release.

## Owner-run publication helper

Prepared `/tmp/gams-release-2.0.5.sh` (temporary, not a repository source file).
It never commits or force-pushes. Commands:

```sh
bash /tmp/gams-release-2.0.5.sh preflight
# After separately reviewing and committing the preparation on release:
bash /tmp/gams-release-2.0.5.sh branch --push-reviewed-branch
# After both hosted workflows and all human reviews pass:
bash /tmp/gams-release-2.0.5.sh publish FULL_SHA VERIFY_RUN_ID RELEASE_RUN_ID
```

The branch command updates the approved GitHub NOTICE variable and pushes only
`release`; it does not tag or publish. The publish command verifies both successful
same-commit workflows, a live Host candidate, matching remote branch/digests and
absent local/remote tag and GitHub Release. It requires interactive confirmation
of candidate, external-Project and clean-Mac review before pushing the new tag.
Authentication/API failures stop it. Human review cannot be established by CI
and must be recorded honestly. The helper has not run in either write mode.

See [PUBLISHING.md](../PUBLISHING.md) for the full release procedure.
