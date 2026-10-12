# Host third-party review — v2.0.5 NOTICE approved

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

- `cmd/app/src/util/vendor/zipjs/zip-native.js`: unmodified zip.js 2.23.0
  npm native browser bundle, BSD-3-Clause, with embedded zlib-streams-ts fallback
  under BSD-3-Clause/zlib terms. Both original license texts and pinned provenance
  are retained beside it and packaged under `BUNDLE-LICENSES/zipjs/`. The exact
  fallback build revision remains unknown. See `docs/release-2.0.5-review.md`;
  the owner approved the exact NOTICE/evidence on 2026-10-12.

## Native Host dependencies — historical pre-HTTP baseline

The inventory counts in this section describe the earlier 386-crate baseline.
The current 395-crate graph and HTTP delta are recorded in
`docs/http-license-review.md` and the regenerated `NATIVE-NOTICES.md`.

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
   example source; retain that invariant for any public push. The v2.0.5 candidate
   root `NOTICE` and evidence were owner-approved on 2026-10-12; digests are
   recorded in `PUBLISHING.md`. Update `NOTICE_SHA256` before an authorized push.
   The historical Ajv/markdown-it version uncertainty remains disclosed.
   `example.game1` requires independent review.
2. Inspect the built Apple Silicon `.app` contents for further bundled
   dependencies and test launch against a separately provided Project.
3. The owner chose ad-hoc signed, unnotarized initial Apple Silicon builds.
   Verify Gatekeeper behavior on a clean macOS machine, explain the limited
   trust model, and inspect the checksummed Host-only app candidate.
   README-only Windows/Linux ZIPs have no executable and are never attached
   to a release.
