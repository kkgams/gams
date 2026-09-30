# Host licensing and release gate

## v2.0.2 preparation — exact NOTICE approval pending

v2.0.2 includes automatic **public** tag releases, tag-named titles, a reusable
installation/security guide and complete generated commit/author notes.
The version bump changes only the GAMS package version in Cargo.lock and its
linked notice evidence; no third-party package or upstream license text changes.
Earlier notice approvals below are historical, not approval of these new bytes.
**Do not push until owner approval; a version tag authorizes public publication.**

Current NOTICE SHA-256: `86df311f31799ddbd1b4e9260dce3d6b61021de836c5fcbc0e720c15447d6030`.
Current evidence SHA-256: `4c8b25cd4edf3f8406d367b19578d761c6f2b4d26f2e9bd39cc63fa4d3c2642b`.
See `PUBLISHING.md` for the branch review then tag-push procedure.



The owner approved Apache-2.0 for **GAMS-authored** Runtime and desktop Host
code. Root `LICENSE` contains that license. `example.game1` owns and must
independently review the example Project and visitor game; their source and Git
history must not appear in the public `gams` repository. This approval does
**not** relicense fonts, browser bundles, Rust crates, or other third-party
material.

On 2026-09-29 the owner approved the **revised** Host-only `NOTICE` (SHA-256
`54845bd559c3edbbb16c4f31d4b0ce11e9547da4592fd5e20e5e688367bb9fa8`)
and its bound evidence (SHA-256
`c38a82a3d8aff8061a69c41bd3c33256ca5117f9d5ea7b2b7535c914a4ad8bb9`).
The macOS folder chooser directly uses two already-noticed objc2 crates; its
root Cargo dependency edges, lock digest and native appendix changed, but no
third-party crate or upstream license text changed. The 47 bound inputs include
the historical Ajv/markdown-it bundle-version limitation and original MPL
source archives. See `PUBLISHING.md` for the exact approval gate; a new notice
or linked-input change requires renewed owner review. Earlier commits
containing example source remain excluded from public Host Git history.
Another repository's approval does not transfer.

The macOS job may compile/test privately, but candidate upload requires
repository-scoped Actions variables `LICENSE_SHA256` and `NOTICE_SHA256` matching
**this repository's approved** root files. The existing public
`NOTICE_SHA256` variable still covers the **old** notice; the owner must
update it to the newly approved digest **before pushing** the revised source.
No
example/station ZIP is produced by the Host release; Windows/Linux jobs contain
README-only roadmaps, not supported executables.

The owner selected an initial ad-hoc signed, non-Developer-ID, unnotarized Apple
Silicon build. Ad-hoc signing enables local launch but supplies no publisher
identity or Gatekeeper bypass. Wasmtime 44 requires `allow-jit` and
`allow-unsigned-executable-memory` hardened-runtime entitlements; revisit them
if the compiler/JIT changes. The Host substitutes the system libiconv for the
Nix-linked dylib. A passing compile alone is not release clearance: review the
hosted candidate and run a clean-machine launch with an external Project before
pushing the version tag, which now authorizes automatic public publication.
