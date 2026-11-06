---
title: Host runtime and configuration
status: reference
---

# Host runtime and configuration

## Selecting a Project config

Set `GAMS_CONFIG` to a filename within the Project directory, for example:

```sh
GAMS_CONFIG=gams.dev.json make run GAMS_APP_CWD=/path/to/project
```

When unset, it defaults to `gams.json`. Empty values and paths are rejected.
The selected file must contain a JSON object; missing or invalid files fail
without falling back to another config. The folder picker, Project Save, and
CLI `init` use the selected filename too. Project-relative Unit paths and
`GAMS_APP_CWD` are unchanged; `init` never overwrites an existing file.

## Project bootstrap and Unit storage

After `await runtime.ready`, frontend code can read native-loaded `gams.json`
as `runtime.config` and the selected Unit storage path as `runtime.modulesDir`.
Configuration reading does not depend on the filesystem plugin. Direct-file
HTTPS (and loopback HTTP test) sources can be downloaded and installed via
`require` and configured WASM/theme loading. The development ZIP slice also
supports `https://example.com/unit.zip#path/to/entry`, extracting packages through
the filesystem plugin. A Host-owned startup screen reports per-Unit downloads,
ZIP extraction, cache reuse and initialization, with visible errors and reload;
see `project-loading.md`. Git sources are not implemented.
FS bootstrap uses the configured `plugin.fs.wasm` local/direct-file source,
or the pinned v0.1.1 fallback if absent; it does not accept ZIP sources. See `direct-file-downloads.md` for APIs and the local-server smoke
test, and `zip-project-units.md` for ZIP scope, deferred safeguards and tests.
Third-party browser bundle notices and original license texts are included in
the Host distribution; see the repository NOTICE.

GUI startup creates `<project>/gams_modules` by default. Set `GAMS_MODULES_DIR`
to a non-empty absolute directory path to select shared storage instead. The
selected directory is canonicalized and preopened for runtime/filesystem access;
there is no local fallback when the override is set. CLI commands, including
`init`, do not require this GUI bootstrap or an existing config.

See `project-unit-installation.md` for the remaining installation design.

## Host UI URL contract

The Host continues to expose these existing URL roots as owned files:

- `/core` from `cmd/app/src/core`
- `/util`, `/widgets`, `/css`, and `/fonts` from real directories under
  `cmd/app/src`

Those served directories are the canonical, Host-owned editable sources. There
is no duplicate `packages/` tree. They are internal shared Host UI API, not
separately extracted helper repositories. Selectable cell grids use the shared
`/util/selectable-grid.js` helper and semantic CSS; see
[[selectable-grids|selectable grids]] for interaction and compatibility.

The current `gams.json` shape and bootstrap ordering are pre-release contracts.
Git-source installation remains unsupported. See the installation design
for the implemented source forms and remaining work.
