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

## Existing Unit URL compatibility

Existing configured plugin, View, UI Service and theme sources still select an
archive file with a URL fragment:

```text
https://example.com/unit.zip#views/view.js
```

The compatibility adapter requires a `.zip` URL pathname (case-insensitive) and
an explicit archive-root-relative file selector, decoded once. It removes the
fragment and passes the URL and entry to native resolution. This legacy Unit
syntax is distinct from a `$ref` JSON Pointer.

ZIP filesystem bootstrap remains rejected by the adapter. The Host still
selects the sole configured source named `plugin.fs.wasm`, or its pinned v0.1.1
fallback when absent. Native extraction itself can run before that plugin;
the restriction is retained selection behavior, not an extraction dependency.
All six shell UI Services still require explicit Project-configured URLs; see
[[direct-file-downloads|direct-file downloads]]. Git sources remain unsupported.

## Native cache and extraction

The native resolver owns downloads, ZIP validation, extraction and cache
publication. JavaScript Unit loading is an adapter, not a second installer.
Cache identity uses the archive URL without the entry selector. Different
entries in one archive share the download and extracted package, including
requests from configuration resolution and Unit loading.

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
