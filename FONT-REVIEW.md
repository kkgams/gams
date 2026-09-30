# Bundled Host fonts — sourced and licensed

## v2.0.1 preparation — new exact NOTICE approval pending

The immutable v2.0.0 tag's workflow failed because a depth-limited identity
fetch made the checkout shallow. v2.0.1 preserves full ancestry. Only the GAMS
package version changed in Cargo.lock; no third-party package or upstream
license text changed. Updating that lock digest and the evidence binding
changes the exact NOTICE bytes. The approvals described below are historical
and do not cover this new candidate. **Do not push until owner approval.**

Current NOTICE SHA-256: `aac1de934824782a4b965097200d7ecd26ca2b22f08037a847fbfe0d7b139387`.
Current evidence SHA-256: `f101ff06a09c911948d27cd750867914ba99e21db23c6c16f0445f8b12df442f`.
See `PUBLISHING.md` for the two-phase branch/tag procedure.



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
