# MPL-covered Cargo crate sources included with the app

These are the **unmodified** original `.crate` source archives from crates.io
at the exact checksums pinned in `cmd/app/src-tauri/Cargo.lock`. All five MPL-2.0
crates identified by the Apple Silicon target-filtered Cargo license inventory
are included conservatively, even when used only at build time. `option-ext`
is on the app's runtime dependency path. Four archives include their own
LICENSE; the published `selectors` crate instead has MPL notices in its
source headers. Complete applicable terms are in `NATIVE-NOTICES.md`.

| Crate | SHA-256 of original crates.io source archive |
| --- | --- |
| `cssparser-0.36.0.crate` | `dae61cf9c0abb83bd659dab65b7e4e38d8236824c85f0f804f173567bda257d2` |
| `cssparser-macros-0.6.1.crate` | `13b588ba4ac1a99f7f2964d24b3d896ddc6bf847ee3855dbd4366f058cfcd331` |
| `dtoa-short-0.3.5.crate` | `cd1511a7b6a56299bd043a9c167a6d2bfb37bf84a6dfceaba651168adfb43c87` |
| `option-ext-0.2.0.crate` | `04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d` |
| `selectors-0.36.1.crate` | `c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c` |

`python3 scripts/check-mpl-source.py` checks every archive against Cargo.lock
before staging. Do not assume a future modified version can use these
unmodified upstream source archives as its source offer.
