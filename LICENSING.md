# Host licensing and release gate

The owner approved Apache-2.0 for **GAMS-authored** Runtime and desktop Host
code. Root `LICENSE` contains that license. `example.game1` owns and must
independently review the example Project and visitor game; their source and Git
history must not appear in the public `gams` repository. This approval does
**not** relicense fonts, browser bundles, Rust crates, or other third-party
material.

The new Host-only root `NOTICE` and 47-file evidence manifest are an
**unapproved candidate**, not permission to distribute. The font provenance,
Ajv/markdown-it family notices, and locked target-filtered Cargo appendix are
review inputs, not substitute approval. Obtain explicit owner approval of the
exact resulting bytes; see `THIRD-PARTY-REVIEW.md`. Earlier
commits containing example source must also be excluded from public Host Git
history. Another repository's approval does not transfer.

The macOS job may compile/test privately, but candidate upload requires
repository-scoped Actions variables `LICENSE_SHA256` and `NOTICE_SHA256` matching
**this repository's freshly approved** root files. Leave them unset until the
owner approves the clean Host source, exact notice, and Host-only ZIP. No
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
