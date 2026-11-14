---
title: "Project Unit installation"
status: reference
---

# Project Unit installation

The native Host prepares prebuilt Project Units declared by the Project before
`runtime.ready` completes. The Host bundles no Project Units or example Project.
Official and third-party Units follow the same contract; there is no special
registry or `kkgams:` protocol. A repository or archive may publish multiple Units.

## Declare sources explicitly

| Config field | Source configuration |
| --- | --- |
| `plugins[]` | Local WASM path or `$file` expression resolving to one. |
| View/UI Service `url` | Local JS path or `$file` expression resolving to one. |
| Theme `url` | Local CSS path or `$file` expression resolving to one. |

```json
{
  "plugins": [
    { "$file": "https://github.com/kkgams/plugin.fs/releases/download/v0.2.0/plugin.fs.wasm" },
    "plugins/local-component.wasm"
  ],
  "ui": {
    "services": {
      "ui-context": {
        "url": {
          "$file": {
            "url": "https://github.com/kkgams/ui-service.context/releases/download/v0.2.0/ui-service.context-0.2.0.zip",
            "entry": "ui-plugins/context.js"
          }
        }
      }
    }
  }
}
```

This illustrates source syntax, not a complete Project UI. Keep published pins
and asset filenames when updating existing configurations. For an archive, put
the selected file in `entry`, not a legacy URL fragment. `$ref` includes JSON;
`$file` prepares a local resource path. See [[host-runtime|configuration resources]].

**Breaking change:** frontend loaders consume only already-local strings. Bare
HTTP, HTTPS and `file:` URL strings, including legacy `URL#entry` strings, fail
with an error directing the Project to use `$file`. Project-relative guest paths
remain valid; use `$file` to normalize native OS paths such as Windows drive paths. No frontend Unit resolver, download cycle or filesystem byte bootstrap runs.

The Project must explicitly declare `plugin.fs` or a compatible filesystem
provider. All configured WASM plugins load together once before the theme and
JS UI Services. No filename has special meaning and there is no pinned FS
fallback; a ZIP-contained filesystem component is valid after native resolution.
The provider supplies JS/theme reads and Project Save writes, not config reading,
downloads or extraction.

The six required shell service roles are `ui-context`, `ui-keys`, `ui-layout`,
`ui-toast`, `ui-popup` and `ui-tooltip`, configured under `ui.services`.
Missing/malformed sources and load failures are errors, not fallback triggers.
A Project may omit `ui.theme` or set it to `null` for Host base styling.

## Native preparation and storage

1. Read the selected Project config and recursively resolve all `$ref`/`$file`
   resources, including resources in included JSON documents.
2. Download missing resources, validate and fully extract ZIPs, then atomically
   publish completed cache entries. Reuse completed entries without network access.
3. Expose resolved `runtime.config` after `runtime.ready`. Load configured WASM
   components by local path, then read the theme and JS through the FS provider.

The default store is `<project>/gams_modules`. Set `GAMS_MODULES_DIR` to a
non-empty absolute directory for shared storage; an invalid override fails
rather than silently selecting local storage. Native code creates, canonicalizes
and preopens the selected store. `runtime.modulesDir` exposes the selected
directory; the `gams_modules/` guest alias maps to it even outside the Project.
Returned resource paths are Project-relative, `/`-separated WASI paths on every
platform, not native Windows cache paths. Local files stay at their original
accessible locations rather than being copied into the cache.

Cache identity is URL-based, excluding ZIP entry selectors. Multiple entries
share one archive download/extraction; different version URLs coexist.
Unchanged URLs do not refresh automatically, including local ZIP paths. This
is not a content-authenticated lockfile. Partial/unsafe archives are not
published; missing entries in completed archives fail rather than redownloading.
See [[direct-file-downloads|transport limits]] and
[[zip-project-units|ZIP validation, limits and lock recovery]].

## Runtime and product boundaries

- Native code owns config reads, transport, extraction and cache publication;
  JS Unit loaders only consume local paths. Native resolution snapshots feed
  [[project-loading|startup progress]] directly.
- `runtime.resolveFile`, `runtime.download` and `runtime.loadFromBytes` remain
  explicit low-level APIs, not configured Unit loaders.
- JS still uses Blob-based imports. Installation does not add relative JS
  imports or relative companion-asset URL support.
- [[project-saving|Project Save]] preserves/canonicalizes `$file` expressions
  and preserves unchanged `$ref` subtrees instead of persisting cache paths.
- Projects explicitly declare their Units and dependencies. No automatic
  transitive loading, source compilation, downloaded installation scripts,
  Git sources, ZIP-inside-ZIP extraction or automatic refresh is supported.
- Full archive structure, companion assets and distributed LICENSE/NOTICE files
  are preserved. Host and Unit third-party licensing obligations remain intact;
  installation does not grant new rights or authenticate publisher content.

## Verification

Regular Host checks require no sibling repositories:

```sh
nix develop --command make test
nix develop --command make validate-docs
```

For an explicitly supplied prebuilt FS component, the real static-server/native
smoke check remains available in [[direct-file-downloads|direct-file downloads]].
It tests low-level transport/byte loading and configured `$file` preparation
before plugin loading, followed by shared-store FS reads and cache reuse. External Project integration belongs to that Project. Native UI screen
rendering and Windows/Linux desktop smoke behavior remain unverified by these
checks.
