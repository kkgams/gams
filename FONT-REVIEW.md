# Bundled Host fonts — sourced and licensed

## v2.0.3 preparation — exact NOTICE approval pending

v2.0.3 corrects release-notes generation: paginated GitHub API output is
flattened with external jq, without the incompatible gh --slurp/--jq pairing.
Regression tests cover multiple pages, no releases and API failures. Releases
remain automatically **public** after tag gates, with tag-named titles and
complete commit/author notes. Existing v2.0.0–v2.0.2 tags are immutable.
The version bump changes only the GAMS package version in Cargo.lock and its
linked notice evidence; no third-party package or upstream license text changes.
Earlier notice approvals below are historical, not approval of these new bytes.
**Do not push until owner approval; a version tag authorizes public publication.**

Current NOTICE SHA-256: `31bf9dfb5321e81b8f1911b579d7541fe5fcb3acb304c42774346031b0fd46dd`.
Current evidence SHA-256: `ccf527975996844ab638866d70ab992b8ce71949d4ff8b708eb0f7f66b616781`.
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
