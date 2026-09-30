# Bundled Host fonts — sourced and licensed

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
