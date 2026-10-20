---
title: v2.0.12 bootstrap test fixes release preparation
status: reference
---

# v2.0.12 release preparation

## Scope

The owner requested committing and publishing the bootstrap test fixes.
The runtime-config test no longer expects an obsolete app-local modules-directory
constant: native configuration selects runtime.modulesDir. The orchestration
harness now mocks both projectUnits and require, supplies window, checks the
require export and fails directly when its import substitutions become stale.
No production behavior changes relative to v2.0.11.

Use a fresh v2.0.12 tag under PUBLISHING.md's current policy; existing tags are
not deleted or moved. scripts/push-release.sh --publish atomically pushes the
committed branch and matching annotated tag. CI builds and publishes that checkout.

## Bounded evidence refresh

Cargo/Tauri advance from 2.0.11 to 2.0.12. Cargo.lock changes only the GAMS root
version. NATIVE-NOTICES.md changes only its lock-digest header, preserving every
other byte. The same 57 evidence paths remain; only Cargo.lock and
NATIVE-NOTICES.md hashes change. NOTICE changes only its evidence-binding digest.
Byte comparisons against the preceding commit verify this exact boundary.
Dependencies, license bodies, fonts, browser bundles and MPL archives are unchanged.
This is release maintenance, not a new legal audit or verification-policy change.

## Local validation

- nix develop --command make app-check app-test: compile check passes;
  65 JS tests and 12 Rust tests pass, with 24 Rust tests explicitly ignored.
- nix develop --command python3 -m unittest discover -s test -p 'test_*.py':
  38 tests pass, including release-helper tests.
- Native notices (395 crates, 88 full texts), five MPL archives, exact 57-input
  evidence binding, required licensing and full Host history boundary pass.
- git diff --check passes.

Logs: build.nosync/release-2.0.12-checks.log and
build.nosync/release-2.0.12-python.log. These local checks do not establish hosted
publication, optimized app packaging, desktop integration or clean-Mac/Gatekeeper
behavior. The tag workflow independently builds and verifies the release artifact.
