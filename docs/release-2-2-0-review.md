---
title: v2.2.0 Project config and canvas release preparation
status: reference
---

# v2.2.0 release preparation

## Scope

Local version commit and annotated tag only; no push or publication.
Since v2.1.0, the Host adds `GAMS_CONFIG` selection (default `gams.json`),
stacked canvas/table surfaces, overlay pointer pass-through, optional Project
themes, and the revised promo site with GitHub Pages deployment.
Project loading, folder selection, saving and CLI `init` honor the selected
config filename. Explicit missing or invalid config files fail without fallback.
No external Project or Project Unit source is bundled.

## Bounded evidence refresh

Cargo/Tauri advance from 2.1.0 to 2.2.0. Byte comparisons confirm Cargo.lock
changes only the GAMS root version. NATIVE-NOTICES.md changes only its lock
hash, preserving original license bytes including line endings. The same 57
evidence paths remain; only Cargo.lock and NATIVE-NOTICES.md hashes change.
NOTICE changes only its evidence-binding digest. Dependencies, license bodies,
fonts, browser bundles and MPL archives are unchanged. This is release
maintenance, not a new legal audit or publishing-policy change.

## Local validation

- `nix develop --command make app-check app-test`: compile check passes;
  89 JS tests and 14 Rust tests pass, with 24 legacy fixture tests ignored.
- `nix develop --command python3 -m unittest discover -s test -p 'test_*.py'`:
  45 tests pass.
- Native notices (395 crates, 88 texts), five MPL archives, 57-input evidence
  binding, licensing and full Host history boundary pass.
- `make validate-docs`: no errors; eight existing navigation/filename warnings.
- `git diff --check` passes.

Log: `build.nosync/release-2.2.0-checks.log`. Hosted CI, optimized app packaging,
native desktop interaction and clean-Mac/Gatekeeper behavior are not verified.
Tag CI independently builds and checks the published artifact.
