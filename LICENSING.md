# Host licensing and release gate

The owner approved Apache-2.0 for **GAMS-authored** Runtime and desktop Host
code. Root `LICENSE` contains that license. `example.game1` owns and must
independently review the example Project and visitor game; their source and Git
history must not appear in the public `gams` repository. This approval does
**not** relicense fonts, browser bundles, Rust crates, or other third-party
material.

On 2026-09-28 the owner approved this Host-only source and the exact root
`NOTICE` (SHA-256 `829bfb24dadbe1bfa6990527cf4c758c706f173dace0b912b81672d93ac0a3c5`).
It binds `NOTICE-EVIDENCE.sha256` and 47 browser/font/native inputs, including
the historical Ajv/markdown-it bundle-version limitation, all referenced
third-party license texts and original MPL source archives. See
`THIRD-PARTY-REVIEW.md` and `PUBLISHING.md`. Do not reuse this approval if the
NOTICE or any linked evidence changes. Earlier commits containing example
source must be excluded from public Host Git history. Another repository's
approval does not transfer.

The macOS job may compile/test privately, but candidate upload requires
repository-scoped Actions variables `LICENSE_SHA256` and `NOTICE_SHA256` matching
**this repository's approved** root files. The owner configures these
variables as part of the public candidate sequence; no variables or public
push have yet been made. No
example/station ZIP is produced by the Host release; Windows/Linux jobs contain
README-only roadmaps, not supported executables.

The owner selected an initial ad-hoc signed, non-Developer-ID, unnotarized Apple
Silicon build. Ad-hoc signing enables local launch but supplies no publisher
identity or Gatekeeper bypass. Wasmtime 44 requires `allow-jit` and
`allow-unsigned-executable-memory` hardened-runtime entitlements; revisit them
if the compiler/JIT changes. The Host substitutes the system libiconv for the
Nix-linked dylib. A passing compile alone is not release clearance: review the
hosted candidate and run a clean-machine launch with an external Project before
publishing a draft.
