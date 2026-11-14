---
title: "ZIP resources and Project Units"
status: reference
---

# ZIP resources and Project Units

The native Host resolves ZIP resources for configuration and Project Units.
`$ref` reads JSON from a selected entry; `$file` resolves an entry file or
directory, or the archive root when `entry` is omitted:

```json
{
  "presets": {
    "$ref": {
      "url": "https://example.com/content.zip",
      "entry": "presets.json",
      "pointer": "/presets"
    }
  },
  "assets": { "$file": { "url": "https://example.com/content.zip", "entry": "assets" } },
  "packageRoot": { "$file": { "url": "https://example.com/content.zip" } }
}
```

Relative resources in included JSON resolve relative to that document, including
its containing archive entry. Configuration resolution completes before Units
consume `runtime.config`; it does not require `plugin.fs`.

## Configuring a Unit from an archive

Use a `$file` descriptor at the plugin source or View/UI Service/theme `url`:

```json
{
  "ui": {
    "views": {
      "view-files": {
        "url": {
          "$file": {
            "url": "https://github.com/kkgams/view.files/releases/download/v1.0.0/view.files-1.0.0.zip",
            "entry": "views/view-files.js"
          }
        }
      }
    }
  }
}
```

This is a source example, not a complete Project. Keep the published tag and
asset name when converting a legacy source; move its archive-root-relative
selector into `entry`. Bare `URL#entry` Unit strings are no longer accepted.
After native resolution, frontend loaders consume only the resulting local
string paths; they do not resolve URLs themselves.

A filesystem WASM component can also be selected from a ZIP with `$file`.
All configured plugins load together once before JS services or the theme.
The Project must explicitly include `plugin.fs` or a compatible provider;
there is no filename-based FS selection or pinned fallback. Native extraction
and config reading do not depend on that provider. All six shell UI Services
still require explicit Project-configured sources; see
[[direct-file-downloads|direct-file downloads]]. Git sources remain unsupported.

## Native cache and extraction

The native resolver owns downloads, ZIP validation, extraction and cache
publication. There is no frontend Unit installer or resolution adapter.
Cache identity uses the archive URL without the entry selector. Different
entries in one archive share the download and extracted package, including
all references encountered during configuration resolution.

The whole archive is extracted before any selected resource is returned,
preserving nested paths, binary companion assets, empty directories and
LICENSE/NOTICE files. Extraction never executes archive members or installation
scripts. Native safe-ZIP validation rejects unsafe members and selectors,
including paths escaping the extraction root. Failed validation or extraction
must not publish a partial package: staging is atomically published only after
full extraction succeeds. A missing selected entry is an error, not a reason to
redownload a completed installation. CRC errors, symlinks, encrypted members,
special files and conflicting/case-colliding paths are rejected. Limits are
64 MiB compressed, 64 MiB per expanded member, 256 MiB expanded in total, and
10,000 members.

Installations use per-source lock files and temporary staging. A crash may leave
a lock or staging directory; an existing lock fails explicitly rather than
starting another writer. Recovery must wait until no process is installing that
source. There is no automatic stale-lock recovery or cache garbage collection.

Completed cache entries can be reused offline. HTTPS and loopback-only HTTP
transport policy is unchanged. The URL cache does not authenticate publisher
content or detect changed bytes at an unchanged URL. There is no automatic
update or refresh feature. Local ZIP files use the same URL-keyed installation
policy; changing bytes at the same local path does not refresh an extracted copy.
ZIP-inside-ZIP extraction is unsupported.

## Loader and save boundaries

Extraction does not change Blob-based JS imports or add relative module imports
or companion asset URLs. Installed Views can continue using Host-owned absolute
imports such as `/util` and `/widgets`.

Resolved cache paths are runtime values, not portable Project configuration.
[[project-saving|Project Save]] preserves or canonicalizes `$file` expressions
and preserves unchanged `$ref` subtrees; edited referenced subtrees are flattened
into the main config without changing included source files.

See [[host-runtime|Host runtime and configuration]] for expression rules and
[[project-loading|Project startup progress]] for native resolution progress.
Existing third-party ZIP bundle notices and license texts remain under
`cmd/app/src/util/vendor/zipjs/` and in Host distributions under
`BUNDLE-LICENSES/zipjs/`; preserve their attribution and terms.
