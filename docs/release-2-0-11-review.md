---
title: v2.0.11 console forwarding and SQL resource fixes release preparation
status: reference
---

# v2.0.11 local release preparation

## Scope

The owner requested all current Host changes be committed and the next local
release tag prepared. Development WebViews now forward console log/info/debug
to stdout and warn/error, uncaught errors and rejected promises to stderr,
while preserving the browser console. No dependency is added.

SQL error tracing accepts the original types/readwrite resource namespace and
releases error resources even when tracing fails. Resource-release IPC dispatches
through spawn_blocking rather than waiting for the Wasmtime mutex on the native
UI thread. Three opt-in external SQL tests cover error origins, dotfile locks and
read-only database queries; they require external inputs and remain ignored in
the ordinary suite.

The existing scripts/push-release.sh handles read-only preflight and optional
atomic branch/tag publication. A local annotated v2.0.11 tag is prepared; no push
or publication is part of this work. The current PUBLISHING.md policy applies.

## Bounded evidence refresh

Cargo/Tauri advance from 2.0.10 to 2.0.11. Cargo.lock changes only the GAMS root
version. NATIVE-NOTICES.md changes only its lock-digest header, preserving all
other bytes. The same 57 evidence paths remain; only Cargo.lock and
NATIVE-NOTICES.md hashes change. NOTICE changes only its evidence-binding digest.
Dependencies, license texts, fonts, browser bundles and MPL archives are unchanged.
This is release maintenance, not a new legal audit or verification-policy change.
Byte comparisons against the preceding commit verify this exact boundary.

| File | SHA-256 |
| --- | --- |
| NOTICE | `784c2704c65fa000e6581e9d2f8b69e5e4fa67a5674ad692d9585ac17dd83713` |
| NOTICE-EVIDENCE.sha256 | `6f229e0ddfaa1f4dd5988d2158430a36041ea680e02182d1d52e5940cca42604` |

## Validation and publication blocker

- `nix develop --command make app-check`: passes.
- Native `cargo test` in the Nix environment: 12 pass, 24 explicitly ignored.
- `nix develop --command python3 -m unittest discover -s test -p 'test_*.py'`:
  38 pass, including push-release helper tests.
- `node --test test/*.test.mjs`: 61 pass, four fail. The same four failures
  reproduce from a clean archive of preceding commit 21548bf (v2.0.10): the
  runtime-config bootstrap assertion and three startup-orchestration tests.
  They remain unresolved and will block the tag workflow's app-test step.
- Native notices (395 crates, 88 full texts), five exact MPL archives, 57-input
  evidence binding, required licensing, full Host history source boundary and
  git diff whitespace checks pass.

Logs are under build.nosync/release-2.0.11-{check,rust,python,js}.log.
No optimized bundle, desktop smoke, opt-in external SQL integration, hosted CI
or clean-Mac/Gatekeeper test is claimed by this preparation.
