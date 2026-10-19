---
title: v2.0.9 Game Icons WebKit release preparation
status: reference
---

# v2.0.9 local release preparation

## Scope

The owner requested a commit, patch-version increment and local release tag,
leaving publication to a single later command. `i.game-icons` now uses
`word-break: keep-all` so WebKit shapes hyphenated names as one ligature.
The browser regression and macOS WKWebView runner cover six catalogue names.
No View, sibling Project Unit or protected View guide is changed.

The current commit-and-tag publication model in PUBLISHING.md applies.
Run `bash scripts/push-release.sh --publish` from the clean committed checkout
to atomically push the branch and matching tag. No push or publication is part
of this local preparation; immutable historical tags remain unchanged.

## Bounded evidence refresh

Cargo/Tauri versions advance 2.0.8 to 2.0.9. Cargo.lock changes only the GAMS
root package version. NATIVE-NOTICES.md changes only its lock-digest header,
preserving full license bodies and line endings byte-for-byte. The same 57
NOTICE evidence paths remain; only Cargo.lock and NATIVE-NOTICES.md hashes
change. NOTICE changes only its evidence-binding digest. Native dependencies,
fonts, browser bundles, license texts and five MPL source archives are unchanged.
This is release maintenance, not a new legal audit; no verifier is weakened.

| File | SHA-256 |
| --- | --- |
| NOTICE | `417b6ea434bbc36ce85a49c68c1826c09df440caa415e32bfbf8ee83961c1d28` |
| NOTICE-EVIDENCE.sha256 | `dfdb47b60d756d7cb2aa84e2137a39d0e08b42656618196a40a5a3d2bbdf95f8` |

## Validation

- `nix develop --command make app-check app-test`: compile check, 53 JS tests
  and 12 Rust tests pass; 21 existing Rust tests remain explicitly ignored.
- `nix develop --command python3 -m unittest discover -s test -p 'test_*.py'`:
  37 tests pass.
- Native notice consistency: 395 crates and 88 license texts; all five MPL
  archives and the exact 57-input evidence binding pass.
- Host worktree and full Git ancestry source-boundary audit passes.
- Independent byte comparisons confirm the exact two-input evidence delta and
  unchanged native license bodies/line endings.
- Native WKWebView regression passes all six names against canonical Host CSS
  and font assets served by an ephemeral loopback preview. All name widths
  match direct glyph widths (32 px). The Nix SDK is incompatible with the
  system Swift compiler; the successful run explicitly selects the installed
  Command Line Tools SDK and unsets SDKROOT:
  `env -u SDKROOT DEVELOPER_DIR=/Library/Developer/CommandLineTools /Library/Developer/CommandLineTools/usr/bin/swift -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk test/check-game-icons-webkit.swift <preview-url>`.

Local logs: `build.nosync/release-2.0.9-checks.log` and
`build.nosync/release-2.0.9-native.log` (ignored build output).
A fresh optimized bundle/ZIP, hosted CI, external-Project desktop launch and
clean-Mac/Gatekeeper behavior are not verified by this preparation. Tag CI
builds and validates the release artifact independently.
