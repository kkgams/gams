---
title: v2.0.8 mixed button/select group release preparation
status: reference
---

# v2.0.8 local release preparation

The owner approved focused local commits, version/evidence maintenance and
release preparation. This is not exact NOTICE approval, a new legal audit or
permission to tag, push, change remote variables or publish. Historical tags
and review records remain unchanged.

## Scope and source boundary

Based on feature commit `672a463`, this patch supports direct-child buttons and
single-line selects in button groups, documents that vocabulary and adds a
standalone visual fixture with icon buttons and eight group arrangements.
The independently released `theme.the98` 0.2.4 supplies its own group sizing
and select-arrow scaling. No sibling sources are bundled into the Host.

The original working checkout has unrelated edits to app bootstrap, SQL,
Game Icons and other documentation. They are excluded. Native builds and tests
use a detached worktree at `build.nosync/release-2.0.8-source`, containing only
the feature commit and the release-version/evidence delta.

## Bounded evidence refresh

Against immutable v2.0.7:

- Cargo.toml and tauri.conf.json advance 2.0.7 to 2.0.8; Cargo.lock changes only
  the root GAMS package version. All native dependencies and their edges remain
  unchanged.
- NATIVE-NOTICES.md changes only its lock-digest header. Its 395-crate index,
  88 full texts and their original line endings remain byte-identical.
- NOTICE-EVIDENCE.sha256 retains the same 57 paths. Only Cargo.lock and
  NATIVE-NOTICES.md hashes change. Fonts, browser bundles, full license texts,
  provenance files and five MPL source archives retain their exact bytes.
- NOTICE changes only its evidence-binding digest. LICENSE is unchanged.
  No production verification rule is loosened.

Historical v2.0.7 NOTICE SHA-256:
`80d419c3319abf2edc490b3bd397128b415fd56862c17d1fab4e12b09c544b37`.
Historical evidence SHA-256:
`bbc746f822cfa06a4f3072bb6b1c9925a0fb3297c994f6f9b8fd545745292c04`.
Those bytes remain in v2.0.7; no past approval is extended to this candidate.

| Candidate file | SHA-256 |
| --- | --- |
| LICENSE | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| NOTICE | `0812caaeb3a34c202aaeb1d7751ebbc499c670b6f8e6efe71ca0d64b842e6977` |
| NOTICE-EVIDENCE.sha256 | `e7efb3cfa398eb3fe1fea38b793dba4788c73419a0a5ba70506b17417cc393d1` |
| NATIVE-NOTICES.md | `7643d641b42f03fdd1b85032ed3d82f2604fb967ea90fb18461cf847aeef9e2b` |
| Cargo.lock | `78c517f1bc9c95a42765257629f83dd838e4487401373a2c222b783515ced792` |

## Validation

Browser validation passed 81 Host group checks, 111 The98 group checks and
10 existing select-arrow states. Equal heights, control order, button joins,
disabled controls, taller buttons and standalone/listbox exclusions are covered.
These browser CSS checks do not establish external-Project desktop consumption.

Passed on the isolated candidate:

- `nix develop --command make app-check app-test app-bundle-release APP_BUNDLES=app`:
  53 JS tests and 12 Rust tests passed; 21 Rust tests remain explicitly ignored.
- `nix develop --command python3 -m unittest discover -s test -p 'test_*.py'`:
  17 tests passed.
- Source-history boundary, native notice consistency (395 crates/88 texts),
  five MPL source archives and exact 57-input NOTICE binding passed.
- Optimized Apple Silicon build, system-only dylib links, strict/deep ad-hoc
  signature and required Wasmtime JIT entitlements passed. App plist is 2.0.8.
- Local ZIP staging/checksum, ZIP integrity and 43 readable notice/source files
  compared byte-for-byte against this candidate passed. Candidate output:
  `dist/release-2.0.8/GAMS-2.0.8-macos-aarch64.zip` and its SHA256SUMS sidecar.
- Wiki validation passed: 17 pages, zero errors and four retained historical
  release-filename/navigation warnings.
- Independent byte checks confirmed the precise two-input evidence delta,
  preserved native full-text bytes/line endings and unchanged third-party assets.

Final build log: `build.nosync/release-2.0.8-build-final.log`.
Staging log: `build.nosync/release-2.0.8-stage.log`.
The initial build log predates the final byte-preserving native-header check;
use the final build/staging logs for current evidence digests.

## Remaining publication gates

Exact candidate NOTICE/evidence approval and remote digest-variable updates,
same-commit hosted candidate/rehearsal, external-Project desktop consumption and
clean-Mac/Gatekeeper review remain pending. No remote check or publication is
claimed. Locally computed digest variables test candidate consistency only.
Follow PUBLISHING.md before creating a new matching tag. Never overwrite tags,
release assets or historical review records.
