---
title: "v2.0.6 release preparation"
status: reference
---

# v2.0.6 release preparation

Status: local preparation and build verified; exact NOTICE/evidence approval,
hosted candidate/rehearsal and desktop/clean-Mac review remain pending. The owner
requested a commit, next-release preparation and a local tag, not a push.
No publication or remote mutation is authorized by this preparation.

## Scope

Fix duplicate FS providers when a Project requests another FS release. Select
the sole `plugins` source whose exact basename is `plugin.fs.wasm`; use the
existing v0.1.1 fallback only when absent. Multiple matches and requested-source
failures are errors. Local/direct-file sources work; ZIP bootstrap is unsupported.
Native reload deduplicates the selected cached path, avoiding a second provider.

See [installation contract](#/project-unit-installation) and
[direct-file bootstrap](#/direct-file-downloads).

## Bounded evidence refresh

The next-release preparation request authorizes preparation, not exact-byte
NOTICE approval. Compare against immutable published `v2.0.5`:

- Cargo.toml, tauri.conf.json and only Cargo.lock's root GAMS version:
  2.0.5 → 2.0.6. Parsed lock comparison with root version normalized is identical.
- NATIVE-NOTICES.md: only its Cargo.lock digest line changes. Full text and crate
  index bytes are otherwise preserved: 395 crates / 88 license texts.
- NOTICE-EVIDENCE.sha256: same 51 paths; only Cargo.lock and NATIVE-NOTICES.md
  hashes change.
- NOTICE: only the evidence-binding digest changes.
- LICENSE and every third-party/font/browser/MPL input remain unchanged.
  No new dependency audit, license approval or publication approval is claimed.

Historical v2.0.5 NOTICE: `7d0ea634ae6cebb1e9a95aacead7304461f4e1b60a48f2a71786c4a776f10b8d`.
Historical evidence: `b19ed41a33a215e6594065b04b53c6c0b40bf1971cccb6665ab256a6f353b86c`.

| Candidate file | SHA-256 | Status |
| --- | --- | --- |
| LICENSE | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | unchanged |
| NOTICE | `d07358be3f843224abc852fd8d468c6d83e70dc0ac171943a8320d474c923196` | approval pending |
| NOTICE-EVIDENCE.sha256 | `0072f2f125875bfb7246b33d986d930b552fc827d3328d76980ddd27de6dc698` | approval pending |
| NATIVE-NOTICES.md | `f5b02139970136824274f4fd8cb25bb5a9d820747c071a55ae248543928c9748` | header-only delta |
| Cargo.lock | `b03fe16d3d8e5476ef0efa9b1ef2db81d3bc451a333a85e6605a4bf6eb4e04b2` | root-version-only delta |

## Local validation

Passed:

- `python3 scripts/check-source-boundary.py`
- `python3 scripts/check-native-notices.py`
- `python3 scripts/check-mpl-source.py`
- `python3 scripts/check-notice-evidence.py`
- `python3 -m unittest discover -s test -p 'test_*.py'`: 14 tests.
- `nix develop --command make app-check app-test app-bundle-release APP_BUNDLES=app`:
  44 JS tests, 12 Rust tests; 21 Rust tests explicitly ignored.
- Ad-hoc signing, portable system-library links and required JIT entitlements
  checked by the build's portabilization step.
- `git diff --check`.

Local optimized Apple Silicon bundle:
`build.nosync/app/target/release/bundle/macos/GAMS.app`.
Ignored build log: `build.nosync/release-2.0.6-validation.log`.

No hosted candidate, release-shaped ZIP staging, desktop Project startup,
clean-Mac/Gatekeeper test or remote tag is claimed. Read-only remote checks found
no v2.0.6 tag or published release at preparation time.

## Remaining gates

1. Obtain owner approval of the exact candidate NOTICE and evidence above.
2. Before an authorized branch push, update GitHub Actions `NOTICE_SHA256` to
   the approved candidate digest and confirm unchanged `LICENSE_SHA256`.
3. Push/rehearse the release branch and review the same-commit hosted app ZIP.
4. Complete external-Project desktop and clean-Mac/Gatekeeper review. The
   v2.0.5-only exception does not apply to v2.0.6.
5. Only then create/push a new matching version tag; tag push automatically
   publishes. Do not move existing tags or treat API errors as absence.

See [publication rules](https://github.com/kkgams/gams/blob/HEAD/PUBLISHING.md). No tag has been created during
preparation because the required approvals/hosted review are still pending.
