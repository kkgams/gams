# Bundled Host fonts — sourced and licensed

## v2.0.4 preparation — NOTICE approved; candidate review pending

v2.0.4 adds native runtime configuration, local/shared `gams_modules` storage,
prebuilt direct-file HTTP downloads, WASM byte loading, and `make run`.
ZIP/Git installation and a loading screen are not part of this release.
The native appendix has been regenerated against the updated locked Apple
Silicon graph: 395 crates and 88 full texts, adding 9 crates and 3 texts without
removing or changing prior notices. The five MPL source archives are unchanged.
Root LICENSE, browser bundles, fonts and their license texts are unchanged.
See `docs/http-license-review.md` for the dependency delta and generation commands.
Existing v2.0.0–v2.0.3 tags are immutable. On 2026-10-04 the owner approved
the exact NOTICE and linked evidence below and authorized the release-branch
push. **Do not publish the tag until same-commit candidate and clean-Mac review
pass.**

Current NOTICE SHA-256: `afe2ab4aa21e5a640f1fc63ba81018b2db3bf37daa78b14e2f814b5a738bc16b`.
Current evidence SHA-256: `64934e3b0f5c8d2a65366dcf3c9bb608e6716d529662a8d1b84d25cc16f06db5`.
See `PUBLISHING.md` for the branch review then tag-push procedure.



The previous ten untraced WOFF2 files have been replaced with **unmodified
upstream bytes** from the Google Fonts CSS API and Google's Material Symbols
repository. See [`cmd/app/src/fonts/PROVENANCE.md`](cmd/app/src/fonts/PROVENANCE.md)
for every official URL, fixed SHA-256, requested CSS family/weight, and exact
upstream commit used for its license. All seven full OFL texts and the
Material Symbols Apache-2.0 text are checked in under
`cmd/app/src/fonts/licenses/`. Tauri embeds frontend resources in the signed
executable; the app ZIP separately includes readable `FONT-LICENSES/` and
`FONT-PROVENANCE.md` beside `GAMS.app`.

These unchanged font records were covered by the 2026-09-28 Host-only NOTICE
approval and remain bound by the **revised** root NOTICE approved on 2026-09-29.
No font or font-license bytes changed. Notice approval alone does not prove a
hosted binary or clean-Mac launch.
`example.game1` owns the example Project and visitor game and reviews their
dependencies independently; they are absent from the Host source/history and
app ZIP.
