---
title: v2.0.7 candidate preparation and Game Icons notice review
status: reference
---

# v2.0.7 candidate preparation

Status: local release preparation requested; **exact NOTICE/evidence approval,
same-commit hosted candidate/rehearsal and desktop/clean-Mac review pending**.
The owner requested local commits/release preparation so they can push later.
No push, remote variable update, tag creation or publication is authorized by
this preparation. v2.0.6 is the published baseline (read-only GitHub check).

## Scope

- Game Icons WOFF2 with 4,180 name ligatures, opt-in `i.game-icons` styling,
  full per-icon author/CC BY 3.0/CC0 attribution and readable ZIP packaging.
- File-based, pinned font-generation tooling; existing checked-in fonts need
  no npm/pip/download step during normal Host builds.
- Shared selectable-cell grid helper and semantic base CSS, with roving focus,
  disabled guards and View-owned activation/selection.
- Host-owned protected View guide, moved from agent-context while retaining
  pending selectable-grid additions; approved Game Icons/accessibility rules.
- Wiki-native docs and actual-font catalogue, served/validated through the
  upstream v1.4.0 wiki Makefile. No custom preview script or bundled wiki engine.

Contracts: [View guide](#/gams-view-development-guide),
[font recipe](#/game-icons-build), [grid helper](#/selectable-grids).
Existing breadcrumb `icon` properties remain Material Symbol names.

## Bounded evidence refresh

This release-preparation request authorizes candidate preparation, **not** exact
NOTICE approval. Against immutable `v2.0.6`:

- Cargo.toml, tauri.conf.json and only Cargo.lock's root GAMS version change
  2.0.6 → 2.0.7. Native dependency packages/versions/checksums/edges are unchanged.
- NATIVE-NOTICES.md changes only its Cargo.lock digest header: still 395 crates
  and 88 full texts. Five MPL source archives and their notices are unchanged.
- Ten existing WOFF2 files and their eight license texts, every prior browser
  bundle/license and other native evidence input retain their exact bytes.
- Existing font PROVENANCE.md adds a pointer to the distinct generated font;
  it does not describe the derivative as an unmodified Google download.
- Six new evidence paths: game-icons.woff2, game-icons.json,
  GAME-ICONS-PROVENANCE.md and three game-icons license/contributor texts.
- The manifest grows from 51 to 57 inputs. Three previous entries change:
  font PROVENANCE.md, Cargo.lock and NATIVE-NOTICES.md. NOTICE adds the
  derivative-artwork attribution/license/package description and new binding.
- LICENSE is unchanged. Build-only npm/Python/wiki tooling is outside the
  embedded frontend; it is not represented as an added native dependency.

The font strips verified square backgrounds, preserves compound artwork,
converts it to monochrome glyphs and adds name/private-use mappings. Source pin:
`game-icons/icons@82d948812bfe3f269ef8f731dcdb07b08160edc4`.
Most artwork is CC BY 3.0; Viscious Speed, Zeromancer and the two Various artists
icons are CC0. Various artists exceptions and the original Swedish Road
Administration salmon credit are recorded in the per-font provenance. No
relicensing of that artwork under GAMS's Apache-2.0 license is claimed.

Historical v2.0.6 NOTICE:
`d07358be3f843224abc852fd8d468c6d83e70dc0ac171943a8320d474c923196`.
Historical evidence:
`0072f2f125875bfb7246b33d986d930b552fc827d3328d76980ddd27de6dc698`.
Those historical files remain in Git; no prior audit or approval is rewritten.

| Candidate file | SHA-256 | Status |
| --- | --- | --- |
| LICENSE | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | unchanged |
| NOTICE | `80d419c3319abf2edc490b3bd397128b415fd56862c17d1fab4e12b09c544b37` | exact approval pending |
| NOTICE-EVIDENCE.sha256 | `bbc746f822cfa06a4f3072bb6b1c9925a0fb3297c994f6f9b8fd545745292c04` | exact approval pending |
| NATIVE-NOTICES.md | `6aba19e4221364c54e1b8293bbdf46549fb95e452922f85c331547cd458dc2c7` | lock-header-only delta |
| Cargo.lock | `c4c398d225b03c104a7a1a9d61052b1823b227d8a40be4eba45fe60dc9d7f57c` | root-version-only delta |
| game-icons.woff2 | `393ac3fa2dbd8c28e2bdaea24c7f038e19fa93dda84e98ab5823cbe46e7c761e` | deterministic generated derivative |

## Local validation

Passed during preparation:

- Source/worktree/Git-ancestry boundary check; no external Project/game source.
- Native notice consistency (395 crates/88 texts), five exact MPL archives,
  and NOTICE binding of the exact 57-input manifest.
- `nix develop --command python3 -m unittest discover -s test -p 'test_*.py'`:
  17 tests passed.
- Font generation checks all 4,180 ligatures with HarfBuzz; repeat generations
  preserve WOFF2 bytes. Prior real Chrome catalogue check loaded the local
  font and resolved every ligature to one glyph-width, with no SVG images.
- Wiki validation: no errors; four explicit historical-release filename/alias
  warnings retained, not suppressed.

- `nix develop --command make app-check app-test app-bundle-release APP_BUNDLES=app`:
  53 JS tests and 12 Rust tests passed; 21 Rust tests remain explicitly ignored.
  Optimized Apple Silicon GAMS.app, portable system-only links, strict/deep
  ad-hoc signature and required Wasmtime JIT entitlements passed. Log:
  `build.nosync/release-2.0.7-build.log`.
- Independently verified bounded byte delta: native full texts unchanged,
  only the root Cargo version changed, exactly six new evidence files and
  three changed prior entries. Existing font/browser/MPL bytes are unchanged.

No release-shaped ZIP, external-Project desktop launch, clean-Mac/Gatekeeper or
hosted run is claimed here. The optimized bundle is at
`build.nosync/app/target/release/bundle/macos/GAMS.app`.

## Owner steps — not a single unconditional push

1. Review the exact new NOTICE, retained legal texts and evidence delta above;
   explicitly approve the current NOTICE/evidence digests.
2. Update the repository Actions `NOTICE_SHA256` variable to the approved
   `80d419c3319abf2edc490b3bd397128b415fd56862c17d1fab4e12b09c544b37`.
   Confirm `LICENSE_SHA256` still matches unchanged LICENSE. The existing
   NOTICE variable points to v2.0.6, so pushing now will fail closed.
3. Push only the release branch: `git push origin release`. Review verify.yml's
   app ZIP candidate and release.yml's rehearsal at the same commit.
4. Complete external-Project desktop and clean-Mac/Gatekeeper review; prior
   patch-specific exceptions do not cover this version.
5. Only after those gates, confirm v2.0.7 remains absent, create a matching new
   tag and push it. Tag push automatically publishes the public Apple Silicon
   ZIP. Never move an existing tag. No local v2.0.7 tag is created by this prep.

See [publication procedure](https://github.com/kkgams/gams/blob/HEAD/PUBLISHING.md).
Local consistency/build success is not exact license approval or publication
authorization. No API failure may be treated as evidence of tag/release absence.
