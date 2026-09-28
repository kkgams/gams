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

These font records are review inputs, not approval to publish. The pre-split
root `NOTICE` is historical and unapproved: prepare a fresh Host-only notice
covering all material actually bundled (including browser and native inputs),
then obtain owner approval of its exact bytes. `example.game1` owns the example
Project and visitor game and reviews their dependencies independently; they
must not be present in the Host source, history, or app ZIP.
