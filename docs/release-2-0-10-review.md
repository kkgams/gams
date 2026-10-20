---
title: v2.0.10 multiple SQL databases release preparation
status: reference
---

# v2.0.10 local release preparation

## Scope

`/util/sql.js` retains string configuration and accepts a database map requiring
`main`. Other entries attach databases as named SQLite schemas on the shared
connection. Paths are bound parameters; schema identifiers are quoted. Invalid
maps fail before opening, and attachment failures close the connection.

The owner requested a commit and new local release tag, leaving the push to the
owner. PUBLISHING.md's current version-commit/tag policy applies. No push or
publication is performed during preparation.

## Bounded evidence refresh

Cargo/Tauri advance from 2.0.9 to 2.0.10. Cargo.lock changes only the GAMS root
version. NATIVE-NOTICES.md changes only its lock-digest header, preserving all
remaining bytes. The same 57 evidence paths remain; only Cargo.lock and
NATIVE-NOTICES.md hashes change. NOTICE changes only its evidence-binding digest.
Dependencies, license bodies, fonts, browser bundles and MPL archives are unchanged.
This is release maintenance, not a new legal audit or verification-policy change.

## Validation

- `node --test test/sql.test.mjs`: four tests pass.
- `node --test test/*.test.mjs`: 53 pass, four fail. The same four failures
  reproduce on the unchanged prior HEAD: the runtime-config bootstrap assertion
  and three startup-orchestration tests. They remain outside this change.
- Python SQLite smoke: bound attachment path, quoted schema and cross-database
  join pass. This is not WASM provider integration coverage.
- Native notice consistency, exact 57-input evidence binding, five MPL archive
  checks, required license files and `git diff --check` pass.
- Native build, desktop/WASM integration, hosted CI and clean-Mac behavior have
  not been verified for this release preparation.
