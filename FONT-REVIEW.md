# Bundled Host fonts — sourced and licensed

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
