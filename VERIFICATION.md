# Historical extraction verification — not current split verification

**All dated results below are historical pre-split observations**, including
station paths, example ZIP tests, old notice digests, and local assembly tools.
They do not establish verification of the split `gams` and `example.game1`
repositories or permission to publish either. The Host now targets zero
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

The subsequent release-scope decision removed the example ZIP from Host
staging. The older two-ZIP and 23-step checks above remain **historical**; none
verify the new split. Before any Host push, check the generated Host tree and
pushed branch history for zero example/station source. Regenerate the Host-only
root NOTICE and evidence and obtain fresh owner approval; prior test-only or
pre-split notices do not qualify.

Remaining release checks (not claimed complete):

- verify the new split's repository boundaries, including no Host station ZIP;
- Host-only compile and bundle on a clean supported macOS machine;
- `example.game1` assembly, integration against the external Host with
  `GAMS_APP_CWD`, game tests and browser smoke in its own repository;
- Host-only third-party inventory and fresh exact NOTICE approval;
- hosted Apple Silicon Host-only app candidate checksum and clean-machine
  Gatekeeper/ad-hoc-signature behavior.

Linux and Windows jobs are README-only roadmap artifacts, not builds.
