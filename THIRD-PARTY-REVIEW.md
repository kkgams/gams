# Host third-party review — revised NOTICE approved; hosted review pending

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



The owner approved Apache-2.0 for GAMS-authored code and, on 2026-09-29,
approved the **revised** Host-only root `NOTICE` and its exact 47-file evidence
manifest. The new native macOS folder chooser uses objc2-app-kit and
objc2-foundation, already represented in the 386-crate native appendix; only
the root Cargo dependency edges changed. Third-party works retain their
original terms. Hosted review of the revised binary is still pending.

## Included in Host frontend source and bundled `.app`

- `cmd/app/src/widgets/markdown-it.js`: markdown-it 14.1.0 MIT bundle,
  adapted from UMD to ES module. `cmd/app/src/widgets/markdown-it.LICENSE`
  matches the official npm tarball; the embedded mdurl, uc.micro, entities,
  linkify-it and punycode notices are saved under `widgets/licenses/`.
  `widgets/BUNDLE-REVIEW.md` records their official tarball hashes and the
  bundle SHA-256. Its build does not pin exact resolved transitive versions;
  those versions are **not** claimed as known, and argparse is not found in
  the browser bundle.
- `cmd/app/src/util/ajv.js`: `esm.sh` production bundle of `ajv@8.17.1`.
  Ajv and its declared fast-uri, fast-deep-equal, json-schema-traverse and
  require-from-string family notices are retained under `util/licenses/`.
  `util/BUNDLE-REVIEW.md` records exact npm tarball and bundle hashes,
  including both upstream fast-uri v3 copyright notices (which vary across
  its permitted semver range). Exact resolved versions inside the historical
  esm.sh build cannot be recovered from its banner alone; these retained
  notices do not claim a reproducible original CDN build. The ZIP also carries
  both browsers' license texts as readable files beside the embedded assets.
- `cmd/app/src/util/aseprite.js`: the owner confirms a mostly independent
  GAMS rewrite based on the Aseprite file-format documentation, with
  TheCyberRonin/ase-parser as inspiration, **not** a vendored copy. Do not
  label the whole GAMS file as Ronin's work. Its upstream MIT license is
  nevertheless retained beside the file in `aseprite.LICENSE` for provenance
  and to cover any structure informed by that source. The saved license matches
  upstream SHA-256 `96463a0a540f4880189724004ac7038725254205c3fa826b963f83bc499a4a75`.
- The ten `.woff2` files in `cmd/app/src/fonts/` were replaced by freshly
  downloaded, unmodified official upstream WOFF2 bytes: nine Google Fonts
  CSS API Latin subsets (OFL-1.1) and one Google Material Symbols repository
  binary (Apache-2.0). Exact URL, SHA-256, weights, pinned license revision,
  full family-specific license files and the Reserved Font Name constraints
  are documented in `cmd/app/src/fonts/PROVENANCE.md` and
  `cmd/app/src/fonts/licenses/`. They are embedded through Tauri
  `frontendDist`; the app ZIP also carries readable font-license and
  provenance files beside the `.app`. The old WOFF2 files had different bytes (despite similar
  font metadata); no modification by GAMS is inferred from that difference.
  Keep the provenance checks current if any font is replaced.

## Native Host dependencies

- `cmd/app/src-tauri/Cargo.lock` pins Tauri 2, Wasmtime 44, WASI, networking
  and other Rust/native dependencies. Inventory the locked crate licenses and
  any bundled native/static libraries for the actual macOS build. Nix/build
  tooling is not automatically shipped with the app, but native code embedded
  in its binary is. The Nix shell initially caused a signed local `.app` to
  load `/nix/store/.../libiconv.2.dylib`, which failed at launch. The bundle
  step rewrites only that known reference to Apple's system
  `/usr/lib/libiconv.2.dylib`, re-signs ad-hoc with Wasmtime JIT entitlements,
  and rejects any other non-system dylib/rpath. Record linked-code evidence
  against the final bundle and verify it runs on a Mac without Nix. An offline
  `cargo metadata --locked --filter-platform aarch64-apple-darwin` inventory
  of the lockfile listed 405 external crates across 30 declared license
  expressions; it over-approximates enabled features. `NATIVE-NOTICES.md`
  contains the target/default-feature cargo-about 0.9.0 output: **386
  third-party crates and 85 deduplicated full texts**, conservatively
  including build and dev crates. The 19 metadata-only crates absent from
  cargo-about were also absent from a locked, offline Apple Silicon
  `cargo tree --edges normal,build` (including optional Winch, tray-icon,
  alternate schemars and unused platform crates). This reconciles the
  counts; the actual hosted build must still be audited. It maps selected SPDX
  expressions, including MPL-2.0, Unicode-3.0, CDLA-Permissive-2.0 and the
  Apache LLVM exception. One MPL crate, `option-ext`, is on a runtime path;
  four others (`cssparser`, `cssparser-macros`, `dtoa-short`, `selectors`) are
  build-related. The unmodified crates.io source archive for **each** of
  those five MPL crates is preserved under `NATIVE-SOURCE/`, included beside
  the `.app` in the ZIP and checked byte-for-byte against Cargo.lock. Both
  versions of `webpki-roots` are release-reachable. The
  appendix does not prove every listed crate's code appears in the `.app`;
  conversely Cargo does not inventory non-Cargo linked or Apple system code.
  The checked bundle currently has only system dynamic library paths.
`example.game1` separately owns the example Project, visitor game, pinned
Sokol inputs, fixture packs and their license review. Earlier Host extraction
snapshots included example/game infrastructure with unresolved authorship;
those files and their history must not be pushed as Host source. Example
approval and any game-core linked-output audit belong to `example.game1`,
not this Host inventory. Neither the Host source nor its ZIP includes an
example or station game.

## Next gates

1. `check-source-boundary.py` confirms the Host's clean ancestry contains no
   example source; retain that invariant for any public push. The owner-approved
   revised root `NOTICE` and bound evidence are recorded in `PUBLISHING.md`;
   change `NOTICE_SHA256` before the next push. Re-review if those bytes change.
   The historical Ajv/markdown-it version uncertainty remains disclosed.
   `example.game1` requires independent review.
2. Inspect the built Apple Silicon `.app` contents for further bundled
   dependencies and test launch against a separately provided Project.
3. The owner chose ad-hoc signed, unnotarized initial Apple Silicon builds.
   Verify Gatekeeper behavior on a clean macOS machine, explain the limited
   trust model, and inspect the checksummed Host-only app candidate.
   README-only Windows/Linux ZIPs have no executable and are never attached
   to a release.
