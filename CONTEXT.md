# GAMS Host context

`gams` owns the GAMS Runtime shell, Tauri desktop Host, browser bootstrap, and
shared Host UI API. It loads independently released Project Units and an
**external** Project; it does not own the example Project or visitor game.
`example.game1` is the separate repository for those example sources and their
local assembly, integration, and game build tools.

## Owned source

- `cmd/app/src-tauri/` — Rust runtime and Tauri desktop shell.
- `cmd/app/src/core/` — browser bootstrap and Host UI runtime.
- `cmd/app/src/{util,widgets,css,fonts}/` — canonical Host-owned shared browser
  libraries and assets. No second editable `packages/` copy exists.
- Host build and validation files — Host-only checks and bundle production.

The Host must have **zero** example/station source, including in public Git
history. Generated files, external Project assets, assembled sibling artifacts,
build caches, and exports are not Host-owned source.

## Runtime vocabulary

- **Host**: native/browser shell providing runtime facilities and loading
  Project Units. Host-specific behavior remains thin.
- **Project**: external directory rooted at `gams.json`; `example.game1` owns an
  example, not a built-in Host Project. On macOS the native folder chooser
  selects an external Project for Finder launch; `GAMS_APP_CWD` explicitly
  selects one for Terminal or automation. The Host must not compile in a
  developer-specific Project path.
- **Project Unit**: plugin, View, UI Service, or theme loaded by the Host.
- **plugin**: WASM component called through the runtime/plugin manager;
  singleton is the target, instance is legacy migration work.
- **View**: browser-rendered Project Unit registered through plugin manager.
- **UI Service**: browser service used by Views and Host bootstrap.
- **theme**: CSS Project Unit selected by Project configuration.
- **local assembly**: explicit copying of independently built sibling artifacts
  into the example Project, performed by `example.game1` tooling, not the Host.

## Project saving

The Host owns native File → Save Project, the `project.save` command, ordered JS
`projectSave` hooks, and publication of current `runtime.config` to the active
`gams.json`. Keyboard bindings remain Project-owned through `gams.json` `ui.keys`.
Plugins/Views own persistent state and config updates; the Host does not capture
layout automatically. See [`docs/project-saving.md`](docs/project-saving.md).

## Boundaries and invariants

`make app-check` needs no sibling repositories. Host release builds never run
example setup, vendor Unit source, or include station Project artifacts or a
station ZIP. The filesystem plugin is required by bootstrap and downloaded from
a temporary Host-owned `plugin.fs` v0.1.1 release pin on cache miss; the Host does
not bundle it. All six shell UI Service URLs must be declared by the Project
under `ui.services`; missing required config or artifacts fail fast.

The current `gams.json` format and bootstrap order are pre-release contracts;
explicit bootstrap UI Service sources are now a breaking config requirement.
The agreed initial design for the migration to explicit prebuilt Unit sources and
local/shared `gams_modules` storage is in
[`docs/project-unit-installation.md`](docs/project-unit-installation.md); it is
partially implemented through native config exposure, local/shared storage,
direct-file HTTP downloads, JS filesystem-backed installation, native WASM
byte loading, and an initial ZIP extraction slice. See
[`docs/direct-file-downloads.md`](docs/direct-file-downloads.md) and
[`docs/zip-project-units.md`](docs/zip-project-units.md) for current scope and
testing; Git sources and the loading screen remain pending. ZIP extraction uses
staging and path containment; archive-level deduplication, CRC verification and
expanded-byte limits are deliberately deferred. The new ZIP browser bundle needs
redistribution review before publication. Verification of an
external Project belongs to the example repository. Host publication still
requires clean source/history, fresh Host-only NOTICE approval, and the release
checks in `LICENSING.md` and `VERIFICATION.md`.
