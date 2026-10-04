# v2.0.4 HTTP dependency notice review

Status: notices regenerated and local consistency checks passed; exact-byte owner
approval, hosted candidate review and clean-Mac release validation remain pending.
No tag or public publication is authorized by this document.

## Scope

The Host directly adds `reqwest 0.12.28` with default features disabled and
`rustls-tls` enabled for prebuilt Project Unit binary downloads. No downloaded
Project Unit is bundled in the Host distribution. ZIP/Git installation and the
loading screen are not included in this release.

GAMS-authored code remains Apache-2.0. Cargo package metadata now states that
already-approved license explicitly. Root `LICENSE`, existing font/browser
license texts, and the five MPL source archives are unchanged. GNU Make was
added to the development shell for consistent `make run`/test behavior; that
build tool is not shipped in the Host app.

## Apple Silicon native graph delta

Generated with cargo-about **0.9.0**, `native-about.toml`, the locked graph,
`--frozen --fail`, and default Host features. The appendix conservatively includes
build/proc-macro/dev dependencies, not just linked runtime code.

| Added indexed crate | Declared expression | Selected full text |
| --- | --- | --- |
| `reqwest@0.12.28` | MIT OR Apache-2.0 | Apache-2.0, Sean McArthur copyright |
| `hyper-rustls@0.27.10` | Apache-2.0 OR ISC OR MIT | existing Apache-2.0 text |
| `ryu@1.0.23` | Apache-2.0 OR BSL-1.0 | existing Apache-2.0 text |
| `serde_urlencoded@0.7.1` | MIT OR Apache-2.0 | existing Apache-2.0 text |
| `sync_wrapper@1.0.2` | Apache-2.0 | existing Apache-2.0 text |
| `tower@0.5.3` | MIT | Tower Contributors, 2019 |
| `tower-layer@0.3.3` | MIT | Tower Contributors, 2019 |
| `tower-service@0.3.3` | MIT | Tower Contributors, 2019 |
| `tower-http@0.6.10` | MIT | Tower Contributors, 2019–2021 |

- Indexed crates: **386 → 395**. None removed; no previous crate's license
  selection or referenced text hash changed.
- Distinct full texts: **85 → 88**. No prior text removed. The three additions
  retain the upstream reqwest Apache notice and two distinct Tower MIT notices.
- All crates reachable in the locked Apple Silicon normal/build `cargo tree`
  are represented in the appendix. Target-filtered Cargo metadata lists 423
  external packages, including packages not enabled in the actual feature tree;
  the metadata count is not the notice/linked-code count.
- MPL-covered set is unchanged: `cssparser`, `cssparser-macros`, `dtoa-short`,
  `option-ext`, and `selectors`. All five saved original `.crate` archives match
  the locked crates.io checksums. No extra source archive is needed for this delta.

### Added complete-text SHA-256 values

| Text | SHA-256 |
| --- | --- |
| reqwest Apache-2.0 | `751963a8b88c0e3a9f27e98933079fbcf09b9998b2c13ac49c2e4d58444520d6` |
| Tower MIT, 2019 | `4249c8e6c5ebb85f97c77e6457c6fafc1066406eb8f1ef61e796fbdc5ff18482` |
| Tower HTTP MIT, 2019–2021 | `5049cf464977eff4b4fcfa7988d84e74116956a3eb9d5f1d451b3f828f945233` |

## Exact review inputs

| File | SHA-256 |
| --- | --- |
| `LICENSE` (unchanged) | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `NOTICE` | `afe2ab4aa21e5a640f1fc63ba81018b2db3bf37daa78b14e2f814b5a738bc16b` |
| `NOTICE-EVIDENCE.sha256` | `64934e3b0f5c8d2a65366dcf3c9bb608e6716d529662a8d1b84d25cc16f06db5` |
| `NATIVE-NOTICES.md` | `7601b5563f763d9f51806c8c0c4f5fcb6496ba4ee7bb07ce1f654410d1cf5c37` |
| `cmd/app/src-tauri/Cargo.lock` | `016c9a94f47ae158d71d1cf552c241eb870a7d086686bcfbb0aefb966cae4bbc` |

The root NOTICE binds the exact 47-file evidence manifest, including the native
appendix and lockfile. Historical notice approval does not cover these bytes.

## Regeneration procedure

Use cargo-about 0.9.0 alongside the Host Nix shell. First fetch the exact locked
sources if they are not already cached; do not update dependency versions:

```sh
cargo fetch --manifest-path cmd/app/src-tauri/Cargo.toml --locked
cargo-about generate --manifest-path cmd/app/src-tauri/Cargo.toml \
  --config native-about.toml --frozen --fail --format json \
  --output-file build.nosync/native-about-2.0.4.json
python3 scripts/generate-native-notices.py \
  --json build.nosync/native-about-2.0.4.json \
  --lock cmd/app/src-tauri/Cargo.lock \
  --output build.nosync/NATIVE-NOTICES-2.0.4.md
```

The renderer intentionally refuses an existing output file. Compare the
candidate with the reviewed appendix before replacing it. Then regenerate
`NOTICE-EVIDENCE.sha256` with `check-notice-evidence.py --write-manifest`, update
the root NOTICE's evidence digest and explanation, and recompute all review
hashes. Never treat regeneration as owner approval.

Check locally:

```sh
python3 scripts/check-native-notices.py
python3 scripts/check-mpl-source.py
python3 scripts/check-notice-evidence.py
python3 scripts/check-source-boundary.py
nix develop --command python3 -m unittest discover -s test -p 'test_*.py'
nix develop --command make app-check app-test app-bundle-release APP_BUNDLES=app
```

After owner approval, update the repository Actions notice digest, push the
reviewed release branch, and review its same-commit candidate and rehearsal.
Only then publish a new matching `v2.0.4` tag. Existing version tags are immutable.
See `../PUBLISHING.md` for the complete publication/Gatekeeper procedure.
