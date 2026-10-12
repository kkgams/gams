# Bundled Host fonts — sourced and licensed

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
