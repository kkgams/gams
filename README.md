# GAMS

[GAMS](https://kkgams.github.io/gams/) is a desktop Host for composing game-editing
workspaces from independently released plugins, Views, UI Services and themes.
Projects own their configuration and content; Host distributions do not bundle
an example game or Project Units.

## Desktop packages

| System | Architecture | `TARGET` | Release asset |
| --- | --- | --- | --- |
| macOS | Apple Silicon | `aarch64-apple-darwin` | `GAMS-macos-aarch64.zip` |
| Windows | x86_64 | `x86_64-pc-windows-msvc` | `GAMS-windows-x86_64.zip` |
| Linux | x86_64 | `x86_64-unknown-linux-gnu` | `GAMS-linux-x86_64.tar.gz` |

Packages contain the native application, checksums, attribution, original license
texts and corresponding MPL-covered sources. macOS builds are ad-hoc signed,
not Developer ID signed or notarized. Windows requires the WebView2 Runtime;
Linux requires GTK 3 and WebKitGTK 4.1 and compatible system libraries. The Linux
release runner is Ubuntu 24.04; the archive is not an AppImage or a promise of
compatibility with every distribution. Windows ARM and macOS Intel release
packages are not enabled.

## REPL

Start a persistent request/response session without opening a window:

```sh
gams --runtime repl --project-dir /path/to/project
```

Enter `gams/host::help` to list built-in commands. Load plugins with
`gams/host::load-plugins ["plugins/plugin.fs.wasm"]`, then call their exported
operations. Send one call per line; read one JSON response per call. The same
format works interactively or through stdin.

See [REPL usage](docs/runtime-terminal.md) and [GAMS commands](docs/runtime-commands.md).

## Development

Install Nix and direnv, hook direnv into your shell, then run `direnv allow` in
this checkout. `.envrc` loads the toolchain pinned by `flake.lock`, including
Rust, the Tauri CLI, native license tooling, Node.js 24, Python and Make. Use
`nix develop --command make <target>` without direnv. macOS additionally needs
Xcode command-line tools. Linux development uses the flake's GTK/WebKit libraries.
Nix provisions the optional font compiler only for deliberate font regeneration.

Native Windows uses MSVC/Windows SDK, Rust 1.94.1, Tauri CLI 2.11.0, cargo-about
0.8.4, GNU Make, Node.js 24 and Python 3. Nix/direnv do not provide a native
Windows development environment; WSL builds Linux targets. Official Linux release
CI uses the Ubuntu-native toolchain/SDK to avoid shipping Nix-store-linked
executables. Linux source builds inside Nix require that environment; packaging
rejects Nix-store-linked Linux binaries, so use the native system SDK for packages.

| Command | Description |
| --- | --- |
| `make run` | Run from source; use the macOS Project picker or set `GAMS_APP_CWD`. |
| `make open` | Run from source with this repository's root `gams.json` development preview. |
| `make test` | Run native Rust, JavaScript and Python tooling tests; does not create release packages. |
| `make test-rust` | Run only Rust tests; use `RUST_TEST_ARGS="--release --target <triple>"` for optimized native tests. |
| `make build` | Compile the native release executable without an archive. |
| `make package` | Build the selected platform application and its archive/checksum through incremental file targets. |
| `make clean` | Remove declared generated output/caches; refuse tracked files and directory-symlink traversal. |
| `make docs` | Build the portable wiki under `build.nosync/docs/`. |
| `make serve-docs DOCS_PORT=8080` | Preview the prepared wiki; restart after source edits. |
| `make validate-docs` | Validate wiki content using pinned justgook/wiki v1.6.0. |
| `make promo` | Assemble promo and documentation under `build.nosync/site/`. |
| `make serve-promo PROMO_PORT=8081` | Preview promo; `/docs` points to the independent docs server. |

`TARGET` defaults to the installed Rust compiler's native OS/architecture. For
example, `TARGET=aarch64-apple-darwin make package` selects the macOS package.
Selecting a target does not install a cross-compilation SDK; release CI uses a
native runner for each supported platform.

`make open` uses pinned released Units declared with `$file` in the root
`gams.json`, not sibling source checkouts. That configuration is development-only
and is not packaged. For an external Project, use
`GAMS_APP_CWD=/absolute/path make run`; set `GAMS_CONFIG` to
a filename to select a config other than `gams.json`. Windows/Linux currently
require an explicit Project path when no config is present in the working
directory; their native folder picker is not implemented.

Make-managed build, package, temporary, documentation and cache output lives
under `build.nosync/`. Tauri itself also emits capability schemas at its fixed
`cmd/app/src-tauri/gen/schemas/` location. `clean`
removes only its known generated schema files, preserving unrelated files. `clean` preserves authored assets/configuration, unrelated
files and downloaded Project Units in `gams_modules/`. Those Units may include user-managed local content.

The isolated [browser Component Model experiment](experiments/browser-jco/README.md)
transpiles and executes uploaded components using Jco entirely in a browser worker.

## CI

Matching numeric `vX.Y.Z` tag pushes build the three native packages and publish
them once with generated release notes. No tests, standalone validation stages,
manual approval digests or package reconstruction run in that pipeline. Required
native compilation, signing/relocation and license-file preparation remain build
steps. Existing releases and assets are not overwritten.

Pushes to `release` run tests/documentation validation and build/deploy promo plus
docs through Pages. They do not build release executables, bundles or archives;
Rust tests run in the optimized profile on all three native runners; JavaScript,
Python, font and documentation checks run on macOS. Trusted `release` pushes save
Cargo dependency caches for subsequent branch and tag runs, using the same target
directory and platform keys. CI keeps its Cargo registry under `build.nosync/cargo/`. Pull requests and tags restore without saving caches;
release archives and app bundles are not cached. Windows/Linux download pinned,
SHA-256-verified Tauri CLI and cargo-about binaries into `build.nosync/ci-tools/`
instead of compiling the tools. macOS retains its pinned Nix toolchain. The first
branch run populates caches; different tags cannot share tag-only caches.
GitHub Pages uses the GitHub Actions deployment source.

## Project Unit sources

Native `$ref`/`$file` resolution prepares all configuration resources before
`runtime.ready`. Frontend plugin and View/UI Service/theme loaders accept only
already-local string paths. **Breaking change:** wrap remote sources in `$file`;
use `{ "url", "entry" }` inside `$file` for ZIP entries, not bare `URL#entry`
strings. Bare HTTP, HTTPS and `file:` Unit URLs fail with a use-`$file` error;
Project-relative guest paths remain valid. Use `$file` to normalize native OS
paths, including Windows drive paths.

Projects must explicitly declare `plugin.fs` or a compatible filesystem provider.
All configured WASM plugins load together once before the theme and JS services;
there is no filename-based FS bootstrap or pinned fallback. ZIP-contained FS
components work after native resolution. The provider supplies JS/theme reads
and Project Save, not config reads, downloads or extraction.

See [Unit installation](docs/project-unit-installation.md) for examples and
[Host configuration](docs/host-runtime.md) for cache, shared-storage and Save rules.

## Documentation and licenses

See [the wiki](docs/index.md), [runtime/configuration](docs/host-runtime.md), and
[the View development guide](docs/gams-view-development-guide.md).
GAMS-authored code uses [Apache-2.0](LICENSE). [NOTICE](NOTICE), original font and
browser-library license files, native dependency notices and MPL source archives
retain their respective third-party terms.
