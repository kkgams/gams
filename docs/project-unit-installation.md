# Project Unit installation — initial design

Status: initial native configuration and modules-directory bootstrap implemented;
source installation and loading UI are not implemented. Source syntax remains
provisional.

## Scope

The Host installs and loads prebuilt Project Units declared directly in
`gams.json`. No separate dependency declaration, automatic dependency loading,
source compilation, or downloaded installation/build scripts. Project Units are
explicitly configured by the Project, except for a temporary hardcoded filesystem
bootstrap source constant in `app.js`.

This is a breaking Project Config migration. Compatibility with the old loading
contract is not required. The Host continues to own no example Project or
bundled Project Units.

Official `kkgams` Units use the same sources as third-party Units. There is no
`kkgams:` protocol or special official registry.

## Source references

Views and UI Services declare a source directly in `url`. Plugins use source
strings in the `plugins` array. Themes use `url` rather than the old `path`.

For an HTTPS ZIP source, the URL fragment selects the file to load, relative to
the archive root:

```json
{
  "plugins": [
    "https://example.com/units.zip#plugins/layout.wasm"
  ],
  "ui": {
    "theme": {
      "url": "https://example.com/units.zip#themes/the98.css"
    },
    "views": {
      "view-code": {
        "url": "https://example.com/units.zip#views/view-code.js"
      },
      "view-files": {
        "url": "https://example.com/units.zip#views/view-files.js"
      }
    }
  }
}
```

These URLs are illustrative, not existing releases.

- Strip the fragment before fetching an HTTPS archive.
- Require an explicit file selector for archives; do not guess an entry point.
- Direct-file sources need no archive selector.
- One archive may contain multiple Project Units. Fetch, verify, and install the
  same resolved archive once, even when several configured Units select files.
- Preserve archive structure and companion assets.
- Reject missing entries, absolute entry paths, and traversal outside the
  installed package. Validate archive members before extraction.

GitHub and general Git sources select both a revision and a prebuilt file using
structured fragment fields:

```text
github:owner/repo#ref=v1.0.0&entry=dist/views/view-code.js
git+https://host/owner/repo.git#ref=v1.0.0&entry=dist/views/view-code.js
```

Resolve revisions to exact commits. These sources select repository snapshots,
not GitHub Release assets. The selected snapshot must already contain prebuilt
artifacts; otherwise installation fails. Published Release assets use HTTPS
URLs, including releases from repositories in the `kkgams` organization.

Local prebuilt package sources (`file:`), live-development references (`link:`),
plain HTTP policy, fragment escaping/encoding, and supported archive formats
beyond ZIP still need precise specification. Existing path-based loading is not
promised compatibility.

## Installation storage

Native bootstrap selects and creates one of two installation directories:

- Project-local: `<project>/gams_modules` (default).
- Shared: a configured directory holding installed artifacts across Projects.

```sh
# Unset: <project>/gams_modules
# Set: use this directory instead (must be absolute and non-empty).
GAMS_MODULES_DIR=/absolute/path/to/shared/gams_modules
```

Rust creates and canonicalizes the selected directory and preopens it at its
absolute path for runtime/filesystem access. JS receives that path as
`runtime.modulesDir` alongside native-read `runtime.config` after
`await runtime.ready`. No implicit fallback and no separate mode variable.
CLI operations remain unchanged; native Project bootstrap is currently GUI-only.

Shared storage is not a global dependency declaration. Each Project declares its
own Units. In v1, key installed directories by a hash of the canonical source
URL (excluding an archive entry selector), not only Unit name. Different version
URLs coexist; selected entry files do not create separate copies of one archive.
A source URL is not an immutable content identity: changed bytes at the same URL
will not be detected or fetched automatically. Reproducible resolution and a
Project lockfile are deferred.

## Installation and runtime boundary

Proposed flow:

```text
configured source -> resolve installed file
                  -> if absent: download -> validate -> stage -> gams_modules
                  -> selected local file -> existing Unit loader
```

- No lockfile or explicit install command is required in the first iteration.
- Download missing sources as the Host needs them, and await installation before
  loading. Surface download progress and failures rather than failing silently.
- Reuse completed installations without network access. Offline loading works
  only for Units whose sources are already installed.
- Ignore the generated Project-local `gams_modules` directory.
- A completion marker written after successful validation distinguishes an
  installed source from a partial download. Stage outside the final directory
  and publish only completed installations; deduplicate concurrent requests.
- A missing selected file in a completed archive is an error, not a reason to
  repeatedly download the same archive.
- Preserve distributed LICENSE/NOTICE files. Without independently supplied
  integrity metadata, v1 cannot promise publisher authenticity or pinned bytes.
- Validate download/archive sizes, entry paths, and symlink behavior before
  installing. Shared storage must be safe against concurrent installation.

Refresh/update commands, manifest requirements, and conflict/Host-compatibility
policies require further design. Lockfiles and reproducible source resolution
are deferred, not prerequisites for v1.

### Reuse existing loaders

JS owns source parsing, download orchestration, ZIP validation/extraction,
progress, and cache persistence. Rust exposes native-read Project configuration,
a WASM component byte-loading command, and a narrow binary HTTP transport where
browser CORS prevents fetching. Use the JS resolver across existing loading paths:

- JS Views and UI Services: `require(source)` resolves/downloads the source,
  then reads the installed JS and uses the existing JS import mechanism.
- WASM plugins: resolve/download source strings before the native component
  loader reads them; do not route WASM through the JS `require` function.
- CSS themes: resolve/download the source before the existing stylesheet loader
  reads it; do not route CSS through JS imports.

### JS-led startup and filesystem bootstrap

Use the main Tauri window for a Host-owned loading screen. One async startup
function awaits preparation of all configured sources before Project UI startup.
The screen requires no Project Unit or theme; show phase, completed source count,
current download bytes, and actionable errors/retry. Use indeterminate byte
progress when the total is unknown. Make UI initialization genuinely awaitable.

For v1, a hardcoded constant in `app.js` identifies the filesystem bootstrap
source; its exact release URL remains to be selected. Do not infer its identity
from arbitrary configured filenames. The bootstrap sequence is:

1. Fetch native-read `gams.json` through a Tauri command, wrapped as
   `runtime.config` after `runtime.ready`. Leave `globalThis.__TAURI__` unchanged.
2. Try loading the known filesystem bootstrap cached path with the existing
   component path loader. Only a missing installation triggers downloading;
   invalid components and other load failures must remain visible errors.
3. On a cache miss, fetch its prebuilt bytes into JS memory and load them through
   a new WASM byte-loading command. After filesystem access becomes available,
   persist the bootstrap package into the selected `gams_modules` store.
4. Inspect completed installations via the filesystem plugin; fetch and extract
   missing sources in JS and persist them through that plugin.
5. Load remaining WASM plugins and initialize JS UI Services, theme, and Views.
   Keep raw `runtime.config` distinct from resolved local loading paths.

Expose a universal `runtime.loadFromBytes(bytes, path)` API, not an FS-specific
command. `path` identifies the intended local source location for component
identity and cache integration; passing it does not itself write the source file.
Use ordinary WASM component compilation, never deserialization of downloaded
bytes as a trusted Wasmtime compiled cache.

For v1, assume every Project uses the filesystem plugin; do not add a no-FS mode
or validation for that assumption. First-run bootstrap loads FS from bytes, then
uses it to persist its own original WASM at the supplied path before any later
path-based reload. Other downloaded components are saved before loading through
the existing path API. Reuse the existing compiled-component cache where
applicable; no general memory-only reload framework is needed for v1.

The selected modules directory is already preopened by native bootstrap,
including shared storage. This follows the current runtime's directory access
permissions; finer-grained shared-store permissions are deferred.

### HTTP transport

Prefer native HTTP transport rather than disabling WebView security. Tauri's
HTTP plugin exposes a fetch-like JS API backed by Rust and not subject to browser
CORS, with URL scopes. Alternatively use a small custom `reqwest` command/channel.
Transport choice is not yet final; `reqwest`/the HTTP plugin is not currently a
direct Host dependency.

Downloads are binary, not text. Transport should check unsuccessful HTTP status,
retain TLS verification, bound time/bytes/redirects, and expose chunk progress to
JS. Restrict source requests and redirect policy deliberately rather than expose
an unrestricted generic proxy. Rust transports bytes; JS decides what to install.

Generic Git/SSH transport cannot be supplied by browser HTTP fetch alone. The
Git protocols remain a later slice requiring an explicit transport strategy.

## Current integration constraints

- `cmd/app/src/app.js` loads `plugins/fs.comp.wasm` before it can read `gams.json`.
  Native config exposure breaks this cycle; the hardcoded bootstrap source stays
  in JS temporarily, but supports first-run byte loading.
- `cmd/app/src/___/services.js` hardcodes six bootstrap UI Service paths. They
  must become explicit Project configuration rather than hidden dependencies.
- `cmd/app/src/util/require.js` reads JS through the filesystem plugin and imports
  Blob URLs. Installing files is not sufficient to support relative JS imports
  or companion asset URLs; loader behavior needs verification and design.
- `example.game1/scripts/install-releases.py` is a reference for pinned downloads,
  archive validation, and notice preservation, but its fixed 18-Unit mapping is
  example-owned, not a generic Host installer.
- Repositories and Project Units are different identities. For example,
  `view.catalog` publishes multiple Units; never assume one repository or archive
  equals one Unit.

## Implementation slices

0. Done: native config exposure, local/shared directory selection and preopen,
   `runtime.config`/`runtime.modulesDir`, and removal of frontend config file I/O.
1. Define source parsing and source-keyed storage with tests for selectors and
   unsafe paths; no lockfile.
2. Implement download-on-miss for HTTPS ZIP/direct-file sources, staging and
   completed-install reuse in Project-local storage.
3. Add WASM byte loading, binary HTTP transport, and the
   JS startup/loading screen; connect `require` and component/theme loaders to
   prepared sources. Migrate the external example Project separately.
4. Add safe concurrent package installation, including shared-store use.
5. Add GitHub/general Git prebuilt snapshot sources.
6. Revisit refresh behavior and optional lockfiles after the basic flow works.
