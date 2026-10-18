---
title: GAMS Host documentation
status: reference
---

# GAMS Host documentation

This wiki serves the canonical Markdown in `gams/docs` directly. The sidebar
lists all pages; use the filter to find a topic.

## Host and Project Units

- [[project-unit-installation|Project Unit installation]]
- [[direct-file-downloads|Direct-file downloads]]
- [[zip-project-units|ZIP Project Units]]
- [[project-loading|Startup progress]]
- [[project-saving|Project saving]]

## Shared UI

- [[gams-view-development-guide|GAMS View Development Guide]] — canonical, protected Core View UI vocabulary
- [[selectable-grids|Selectable grids]]
- [[game-icons|Game Icons catalogue]] — icon previews and all 4,180 ligatures
- [[game-icons-build|Game Icons build and usage]]

## Review records

- [[release-2-0-8-review|v2.0.8 local preparation]]
- [[release-2-0-7-review|v2.0.7 candidate review]]
- [[http-license-review|HTTP licensing review]]
- [[release-2-0-5-review|v2.0.5 release review]]
- [[release-2-0-6-review|v2.0.6 release review]]

These pages retain their own approval boundaries. The `reference` metadata
classifies documentation, not release acceptance or publication approval.
Release records keep their historical dotted filenames; the kebab-case symlink
aliases supply native wiki routes without moving or duplicating the records.
The engine validator warns about the historical filenames and their duplicate
routes; these warnings are expected, not suppressed.

## Preview locally

From `gams/` with its development shell active:

```sh
make serve-docs
make serve-docs PORT=3000
make validate-docs
```

Open <http://localhost:8080> (or the selected port). Make fetches the upstream
`justgook/wiki` **v1.4.0 Makefile**, then delegates to its `serve` target. That
Makefile installs the engine and chooses Bun, Node.js, or Python. This is the
same engine release used by `imprint-zero`; no custom preview script, content
mirror, npm installation, or Host build is involved. The only prepared docs
asset is a byte-for-byte copy of the checked-in Game Icons font under
`docs/assets/`, loaded by `custom.css` for the catalogue. Validation delegates to the
upstream `validate` target and requires Node.js 22 or newer.

The upstream Makefile and engine are cached at `build.nosync/wiki-v1.4.0.mk` and
`build.nosync/wiki-v1.4.0/`. Source changes are live: refresh the browser to see
edits. Add new pages to `_sidebar.md` as part of authoring. Links to files outside
`docs/` open their upstream repository sources rather than exposing the Host's
source tree or build caches through the wiki.

For local engine development:

```sh
make serve-docs WIKI_ENGINE=/path/to/wiki
```

A custom engine must already contain `scripts/serve.mjs`; it is never downloaded
over. `WIKI_MAKEFILE=/path/to/wiki/Makefile` also allows a local upstream Makefile.
`WIKI_VERSION` selects another release and a separate cache path. `make clean`
removes the default engine/Makefile caches. The server binds only to loopback
and stops with Ctrl-C. This target does not publish or bundle docs inside the
Host.
