---
title: v2.1.0 sortable headers and async animation release preparation
status: reference
---

# v2.1.0 release preparation

## Scope

The owner requested local commits and next version tags for GAMS and view.sql;
no push or publication is part of preparation. Shared base.css now renders
Material Symbols Rounded arrow_upward / arrow_downward indicators through
th[aria-sort]::after, with empty alternative text, plus header focus styling.
The owner-approved View guide addition documents direct header activation and
aria-sort without prescribing internal data hooks or focus attributes.

This minor release also includes the already committed additive cancellable
async animation clip API since v2.0.12; see [[animation-preview|animation preview]].
The independent view.sql v1.1.0 release consumes the sortable-header styling.
No View source or external Project is bundled into the Host.

## Bounded evidence refresh

Cargo/Tauri advance from 2.0.12 to 2.1.0. Cargo.lock changes only the GAMS root
version. NATIVE-NOTICES.md changes only its lock-digest header, preserving every
other byte. The same 57 evidence paths remain; only Cargo.lock and
NATIVE-NOTICES.md hashes change. NOTICE changes only its evidence-binding digest.
Byte comparisons against the preceding commit verify this exact boundary.
Dependencies, license bodies, fonts, browser bundles and MPL archives are unchanged.
This is release maintenance, not a new legal audit or verification-policy change.

## Local validation

- nix develop --command make app-check app-test: compile check passes;
  76 JS tests and 12 Rust tests pass, with 24 Rust tests explicitly ignored.
- nix develop --command python3 -m unittest discover -s test -p 'test_*.py':
  38 tests pass, including release-helper tests.
- Native notices (395 crates, 88 full texts), five MPL archives, exact 57-input
  evidence binding, required licensing and full Host history boundary pass.
- make validate-docs: no errors; eight existing navigation/filename warnings.
- git diff --check passes.

Logs: build.nosync/release-2.1.0-checks.log and
build.nosync/release-2.1.0-python.log. These checks do not establish hosted CI,
optimized app packaging, visual/native desktop integration or clean-Mac/Gatekeeper
behavior. Tag CI independently builds and verifies the release artifact.
