# Split Host verification and historical extraction evidence

## v2.0.4 preparation — exact NOTICE approval and candidate review pending

v2.0.4 adds native runtime configuration, local/shared `gams_modules` storage,
prebuilt direct-file HTTP downloads, WASM byte loading, and `make run`.
ZIP/Git installation and a loading screen are not part of this release.
The native appendix has been regenerated against the updated locked Apple
Silicon graph: 395 crates and 88 full texts, adding 9 crates and 3 texts without
removing or changing prior notices. The five MPL source archives are unchanged.
Root LICENSE, browser bundles, fonts and their license texts are unchanged.
See `docs/http-license-review.md` for the dependency delta and generation commands.
Existing v2.0.0–v2.0.3 tags are immutable. Historical approvals below do not
approve these new exact bytes. **Do not push until owner notice approval; do not
publish the tag until same-commit candidate and clean-Mac review pass.**

Current NOTICE SHA-256: `afe2ab4aa21e5a640f1fc63ba81018b2db3bf37daa78b14e2f814b5a738bc16b`.
Current evidence SHA-256: `64934e3b0f5c8d2a65366dcf3c9bb608e6716d529662a8d1b84d25cc16f06db5`.
See `PUBLISHING.md` for the branch review then tag-push procedure.



## v2.0.4 local validation — 2026-10-04

Passed against the current 2.0.4 sources:

- Native appendix consistency: 395 crates, 88 complete texts; five exact MPL
  source archives; root NOTICE binds the 47-file evidence manifest.
- Full Host source-history boundary check.
- 12 offline Python publication-gate tests, 9 JS tests and 12 Rust tests.
  The 20 legacy fixture tests remain ignored; the separate external-FS smoke
  test is explicitly opt-in and was run successfully.
- Real loopback HTTP smoke with the independently built `plugin.fs` Unit:
  binary download, byte load, WASI persistence, compiled-cache/path reload, and
  another Project's offline shared-store access.
- `make app-check app-test app-bundle-release APP_BUNDLES=app`: local optimized
  Apple Silicon bundle built, ad-hoc signed and portabilized; existing bundle
  checks passed.

These are local checks, not a hosted candidate or clean-Mac/Gatekeeper review.
The new NOTICE bytes still need owner approval. No v2.0.4 tag has been published.

## Owner-reported clean-Mac result — 2026-09-30

The owner reports earlier downloaded builds worked on a fresh Mac after
disabling Gatekeeper. This confirms operation after a security bypass, not
normal Gatekeeper acceptance; the exact build and bypass method were not
specified. Do not recommend system-wide security disabling. Release guidance
retains checksum checks and an explicit app-scoped quarantine bypass for users
who trust the download. The v2.0.2 tag build subsequently passed, but release
creation failed on the incompatible gh API flags. A hosted v2.0.3 candidate
has not yet been built or reviewed; earlier results do not establish validation
of its new assets.

**The older dated results below are historical pre-split observations**, including
station paths, example ZIP tests, old notice digests, and local assembly tools.
They do not by themselves establish verification of the split `gams` and
`example.game1` repositories or permission to publish either. The Host now targets zero
example/station source (including pushed history), no station ZIP, and an
external Project selected with `GAMS_APP_CWD`; example setup, integration, and
game tests belong in `example.game1`.

Historical baseline from 2026-09-20 in `/tmp/gams-host-check/gams`, a
disposable repository generated from the former extraction, using only its Nix
environments. These commands are a record, **not current Host instructions**:

```sh
nix develop --command make app-check \
  TAURI_TARGET_DIR=/path/to/trusted-cargo-cache
nix develop .#station --command make -C examples/station-demo/game test
nix develop .#station --command make -C examples/station-demo/game web
```

At that time, all commands passed. `app-check` generated icons at the standalone
repository's root `build.nosync/app/icons`, and `cargo check` compiled the
extracted package from its `/tmp` path. The existing Cargo target cache was
deliberately reused to keep verification overhead small; no source or
sibling-repository path was reused. The game ran all 3 station and 5
content-loader tests, fetched and verified its pinned Sokol archives, and built
the web artifact without missing imports.

No full Host release build or bundle was run for **that historical baseline**.
No Git repository was initialized for that run and no push was performed.

2026-09-27 local preparation: a newly extracted, sibling-free Host snapshot
built a macOS Apple Silicon `GAMS.app` with `make app-bundle-release
APP_BUNDLES=app`; its bundled binary then invoked the layout component against
an explicitly supplied local station Project (`GAMS_APP_CWD` plus locally
assembled fs/layout paths). Offline gate tests and the README-only platform ZIP
tests passed. A separate **test-only** NOTICE fixture in an ignored temporary
stage exercised ZIP packaging; it was not committed or offered as a
distribution approval. A later isolated local clone produced checksummed,
separate Apple Silicon app and station-example source ZIPs using that same
test-only fixture. After extracting the source ZIP **without any sibling
repositories**, `nix develop .#station --command make -C
examples/station-demo/game test web` passed all game tests and produced the
visitor game WASM using pinned, checksum-verified Sokol inputs. The first local ad-hoc signed app was **not** portable: it linked a Nix-store
libiconv; a load-name-only repair then revealed a Wasmtime JIT `SIGKILL (Code
Signature Invalid)` under hardened runtime. A newly extracted source snapshot
with the narrow libiconv repair and `allow-jit` plus
`allow-unsigned-executable-memory` entitlements built a portable `.app`, passed
`check-mac-bundle.sh` (`Signature=adhoc`, only Apple system dylibs), and its
bundled CLI successfully invoked fs/layout from an independently supplied
station Project. A later release-shaped app ZIP was checksummed, unpacked
with `ditto`, passed the portable-link/signature/JIT-entitlement check and
invoked fs/layout again from its unpacked `.app`. Both ZIPs in that staging
run contained an explicitly **test-only** NOTICE confined to an ignored
throwaway clone, not a reviewed distribution notice. This proves local
packaging and source buildability, **not** a hosted Apple Silicon candidate,
clean-machine launch, reviewed licensing NOTICE, or downloaded-file
Gatekeeper behavior. Developer ID signing and
notarization are intentionally deferred.

2026-09-28 font-provenance preparation: all ten WOFF2 assets were replaced
with byte-for-byte copies of official Google-hosted downloads. Seven pinned
OFL texts and the Material Symbols Apache-2.0 text are retained next to the
font sources. A fresh local Apple Silicon app built, passed the portable-link
and ad-hoc signature checks, and a release-shaped ZIP carried all eight exact
license texts and the font provenance as human-readable files beside the
`.app`. After `ditto` extraction the signed binary again invoked fs/layout
from a separately provided Project. The 23-step local assembly verification
passed at `verification/20260928T162605.046976Z`. All ZIP work used an
isolated **test-only** NOTICE; these checks do not approve Host distribution,
validate a hosted candidate, or exercise Gatekeeper on a clean machine.

2026-09-28 historical notice preparation: a root `NOTICE` candidate then mapped third-party
browser/font licenses, 386 Apple Silicon Cargo dependencies (85 distinct full
texts), and the optional example source. `NOTICE-EVIDENCE.sha256` binds 50
upstream files and notices to that exact root text. The app ZIP also includes
five checksum-locked original MPL-covered crate source archives. In a clean
**local-only** clone, temporary environment digests matching this **unapproved**
text allowed a release-shaped staging test; the two ZIP checksums and 35 app
plus 6 example notice-file byte comparisons passed. The signed app from the
unpacked ZIP invoked an independently supplied Project. The later 23-step
assembly verification passed at `verification/20260928T173047.276947Z`.
Neither repository has been pushed, no GitHub digest variables were activated,
and these tests are **not** owner approval or a hosted/Gatekeeper test.

Current split: `kkgams-local/gams` was rebuilt as a new **one-root-commit**
Host-only Git history; `example.game1` has its own local repository. Both
remain unpushed. `scripts/check-source-boundary.py` checked the Host worktree
and every commit ancestor for absent Project/game source. The new Host-only
NOTICE candidate binds **47** third-party inputs. On 2026-09-28, the
**24-step** local verification passed at
`verification/20260928T190839.839796Z`: Host check/test/release build,
`example.game1` game tests and web build, explicit assembly of 18 Unit files,
external-Project Host integration and deterministic fixture drift check. The
Cargo target cache was reused via an ignored local symlink; no assembled
Project inputs were copied into the Host repository. The split `.app` was
built, ad-hoc signed and packaged into a **single Host-only app ZIP**. An
isolated clone, using **temporary test-only environment digests** for the
unapproved NOTICE, passed source-ancestry, full-text, app-signature and ZIP
checksum checks; all 35 staged Host notice files matched source bytes. After
extracting the ZIP, the app invoked layout from the external example Project
in a local process without a Nix shell. The owner **subsequently approved**
the exact Host-only NOTICE on 2026-09-28; the local tests themselves do not
constitute a hosted candidate review, clean-Mac test or Gatekeeper launch test.

2026-09-29 Finder-style launch regression: the hosted `a2e1130` app panicked
before opening a window because LaunchServices' unrelated working directory
contained a dangling symlink and the Host tried to use it as the Project root.
Launching the same binary with `GAMS_APP_CWD` pointing at an external assembled
Project stayed running. The new Host code selects an external Project with a
native macOS folder picker before building filesystem preopens, unless an
explicit Project or a working-directory `gams.json` is available. A local
Apple Silicon build and unit test verified the selector; a directly launched,
signed local bundle stayed running with the picker instead of panicking.
**The revised binary has not yet passed a downloaded-CI-artifact or clean-Mac
test.** The owner approved its exact revised Cargo.lock-linked NOTICE and
evidence on 2026-09-29; the old GitHub notice variable still needs updating.

Remaining release checks (not claimed complete):

- set `NOTICE_SHA256` to the **revised owner-approved** Host-only NOTICE
  digest recorded in `PUBLISHING.md` before pushing revised source;
- independent owner review of `example.game1` source provenance before its
  public push or any compiled game release;
- hosted Apple Silicon Host-only app candidate and clean-machine Gatekeeper,
  ad-hoc-signature and external-Project launch behavior;
- browser smoke test for the separately built visitor game.

Linux and Windows jobs are README-only roadmap artifacts, not builds.
