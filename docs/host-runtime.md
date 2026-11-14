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
`gams/host::project-init` use the selected filename too. Project-relative Unit
paths and `GAMS_APP_CWD` are unchanged; Project initialization never overwrites
an existing file.

## Resolving configuration resources

The native Host recursively resolves `$ref` and `$file` expressions before
publishing `runtime.config` or loading Project Units. The resolved top-level
value must be an object. Configuration resolution does not depend on `plugin.fs`.

```json
{
  "database": { "$ref": "config/database.json" },
  "ui": { "$ref": "config/ui.json#/desktop" },
  "databaseCopy": { "$ref": "#/database" },
  "presets": {
    "$ref": {
      "url": "https://example.com/content.zip",
      "entry": "presets.json",
      "pointer": "/presets"
    }
  },
  "assets": { "$file": { "url": "https://example.com/content.zip", "entry": "assets" } }
}
```

| Expression | Behavior |
| --- | --- |
| `$ref` string | Reads local or HTTPS JSON; an optional `#/pointer` selects a value. `#/database` refers to the containing JSON document; `#` selects its root. |
| `$ref` descriptor | `{ "url": "https://example.com/content.zip", "entry": "presets.json", "pointer": "/presets" }` reads JSON from an archive entry and selects the pointer. Omit `pointer` to select the JSON root. |
| `$file` string | Resolves a local or HTTPS resource to a local filesystem path. Local files remain in place. |
| `$file` descriptor | `{ "url": "https://example.com/content.zip", "entry": "assets" }` selects a file or directory. Omitting `entry` selects the extracted archive root. |
| Relative resources | Resolve relative to the containing JSON, including nested JSON documents and archive entries. Ordinary strings are not resource expressions; existing Project-relative Unit paths retain their meaning. |
| JSON Pointer | Slash-separated keys and array indexes; `~1` means `/`, `~0` means `~`. `/` selects an empty key. |
| Replacement | `$ref` can include any JSON value; expressions inside included values resolve recursively. `$file` produces a local path. |
| Siblings | A resource expression is the object's only property; there is no merge or override behavior. |
| Errors | Malformed expressions, missing resources or pointers, invalid JSON, circular references and unsafe archives fail loading. Reusing a reference is allowed. |

HTTPS and loopback-only HTTP transport policy is unchanged. Remote resources use
one native URL-keyed cache shared by configuration resolution and Unit loading;
ZIP entry selectors do not create separate archive copies. Full archives are
validated, extracted and atomically published before use, including before
filesystem-plugin bootstrap. Cached URLs are not automatically updated; no
refresh feature is introduced. Local ZIP sources use the same extraction cache.
ZIP-inside-ZIP extraction is not supported; a nested ZIP remains an ordinary file.
Direct-file downloads do not discover sibling imports; distribute files with
relative dependencies together in a ZIP.

Local `$file` targets must be within the Project, its selected modules directory,
or a directory symlink preopened from the Project root. Other local locations
are rejected rather than returning paths that plugins cannot access. Returned
paths are Project-relative WASI paths with `/` separators on every platform.
`gams_modules/` addresses the selected store even when `GAMS_MODULES_DIR` points
outside the Project; the Host maps that directory for both filesystem plugins
and native WASM loading. Units do not receive Windows-native cache paths.

[[project-saving|Project Save]] preserves unchanged `$ref` subtrees. An edited
referenced subtree is flattened into the main config without changing included
source files. References whose same-document dependencies changed are flattened
too, so reopening preserves the current values. `$file` expressions are preserved
or canonicalized, never replaced with serialized cache paths.

## Project bootstrap and Unit storage

After `await runtime.ready`, frontend code reads fully resolved configuration as
`runtime.config` and the selected cache/storage directory as `runtime.modulesDir`.
Native Project loading starts asynchronously through `runtime_project`, with its
`onProgress` channel installed before consumers await readiness. See
[[project-loading|Project startup progress]] for the runtime progress API.

Existing direct-file and `https://example.com/unit.zip#path/to/entry` Unit URLs
remain supported through a compatibility adapter to native resolution. JavaScript
Unit loaders no longer own downloading, ZIP extraction or cache publication.
The adapter still rejects ZIP filesystem bootstrap: the Host selects the sole
configured source named `plugin.fs.wasm`, or the pinned v0.1.1 fallback if absent.
Multiple matches and selected-source failures are errors, not fallback triggers.
This selection restriction is not a native extraction dependency.

GUI startup creates `<project>/gams_modules` by default. Set `GAMS_MODULES_DIR`
to a non-empty absolute directory path to select shared storage instead. The
selected directory is canonicalized and preopened for runtime/filesystem access;
there is no local fallback when the override is set. Local resource files stay
at their original locations rather than being copied into the cache. The
[[runtime-terminal|REPL]] does not require GUI bootstrap or an existing config.
Use [[runtime-commands|GAMS commands]] to initialize a Project and load plugins.

See [[direct-file-downloads|direct-file downloads]] and
[[zip-project-units|ZIP resources]] for transport and archive behavior. Git
sources remain unsupported. Third-party notices and original license texts
remain part of the Host distribution; see the repository NOTICE.

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
