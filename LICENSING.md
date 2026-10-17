# Host licensing and release gate

## v2.0.7 preparation — exact NOTICE approval pending

The next patch adds the generated Game Icons ligature font, selectable-cell grid
support, and Host-owned View documentation with a local wiki preview. Cargo/Tauri
version is 2.0.7. The ten existing fonts, browser bundles, native dependencies and
MPL source archives are unchanged; the new font, attribution and bounded evidence
delta are documented in [v2.0.7 review](docs/release-2-0-7-review.md).

Candidate NOTICE SHA-256: `80d419c3319abf2edc490b3bd397128b415fd56862c17d1fab4e12b09c544b37`.
Candidate evidence SHA-256: `bbc746f822cfa06a4f3072bb6b1c9925a0fb3297c994f6f9b8fd545745292c04` (57 inputs).

These are prepared candidate bytes, not owner-approved digests. Before pushing,
obtain exact approval and update the repository Actions `NOTICE_SHA256` variable.
Hosted same-commit candidate/rehearsal and external-Project/clean-Mac review remain
required before creating/pushing a release tag. Historical records below do not
approve this version. No remote mutation/publication is part of this preparation.

## v2.0.6 preparation — exact NOTICE approval pending

The next patch selects the Project's sole `plugin.fs.wasm` source for filesystem
bootstrap, falling back to the Host pin only when absent. It rejects ambiguous
sources and propagates selected-source failures without fallback.

Cargo/Tauri version is 2.0.6. The Cargo lock changes only the GAMS root version;
all third-party dependencies, license texts, fonts and browser bundles remain
unchanged. The native appendix lock header and NOTICE evidence binding were
refreshed within that boundary. Prior v2.0.5 approval does not cover these bytes.

Candidate NOTICE SHA-256:
`d07358be3f843224abc852fd8d468c6d83e70dc0ac171943a8320d474c923196`.
Candidate evidence SHA-256:
`0072f2f125875bfb7246b33d986d930b552fc827d3328d76980ddd27de6dc698`.

See [v2.0.6 review](docs/release-2.0.6-review.md) for checks and remaining gates.
The v2.0.5-only manual-review exception does not apply to this release.
The following v2.0.5 sections are retained as historical preparation evidence.


## v2.0.5 preparation — NOTICE approved; release review pending

v2.0.4 is published. v2.0.5 adds Project Save hooks/progress, ZIP Project Unit
installation, startup progress with early Project-theme adoption, and a refreshed
app icon. Git installation remains unimplemented. ZIP extraction is a limited
slice, not a hardened installer for hostile archives.

The candidate NOTICE now covers zip.js and its embedded zlib fallback; 51 inputs
are bound by the refreshed evidence manifest. Native dependencies remain at
395 crates and 88 full texts; only the Host version and lock digest changed.
Fonts, prior browser bundles, upstream license texts and MPL archives are unchanged.

On 2026-10-12 the owner approved the exact NOTICE and linked evidence below.
This is notice approval, not publication authorization. Same-commit hosted
candidate/rehearsal, external-Project desktop smoke and clean-Mac/Gatekeeper
review are still required before tagging.

Candidate NOTICE SHA-256: `7d0ea634ae6cebb1e9a95aacead7304461f4e1b60a48f2a71786c4a776f10b8d`.
Candidate evidence SHA-256: `b19ed41a33a215e6594065b04b53c6c0b40bf1971cccb6665ab256a6f353b86c`.
See `docs/release-2.0.5-review.md` for the bounded refresh and `PUBLISHING.md`
for approval and publication gates.



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
**this repository's approved** root files. The prior approval covers v2.0.4,
not this v2.0.5 candidate. The owner separately approved the exact v2.0.5
NOTICE/evidence on 2026-10-12. Update `NOTICE_SHA256` **before an authorized
push** of revised source; future input changes require renewed approval. No example/station ZIP is produced by the Host release; Windows/Linux jobs contain
README-only roadmaps, not supported executables.

The owner selected an initial ad-hoc signed, non-Developer-ID, unnotarized Apple
Silicon build. Ad-hoc signing enables local launch but supplies no publisher
identity or Gatekeeper bypass. Wasmtime 44 requires `allow-jit` and
`allow-unsigned-executable-memory` hardened-runtime entitlements; revisit them
if the compiler/JIT changes. The Host substitutes the system libiconv for the
Nix-linked dylib. A passing compile alone is not release clearance: review the
hosted candidate and run a clean-machine launch with an external Project before
pushing the version tag, which now authorizes automatic public publication.
