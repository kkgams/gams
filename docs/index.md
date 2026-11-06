---
title: GAMS documentation
status: reference
---

# GAMS

## An editor built around your game

GAMS is a workspace for building an editor that feels at home in your game.
The game is not a preset inside GAMS, and it does not need to become a GAMS
runtime application. Instead, you compose the editing tools around the game's
content, systems, and visual language.

The useful connection to a headless CMS is separation: content and game logic
can remain independent of the interface used to author them. GAMS adds a
composable editing workspace without prescribing one game engine, renderer,
or universal content model.

The goal is more than putting a different skin on a generic editor:

- **The game's language.** Editors should expose the game's own concepts,
  such as equipment, abilities, encounters, tracks, or districts.
- **The game's systems.** Views and plugins can provide authoring tools for
  the data and rules the game actually uses. Integration belongs to the
  Project; GAMS does not automatically share or embed a game's runtime.
- **The game's identity.** Themes and game-specific Views can bring the
  game's visual language into its tools. Maps, worlds, inventories, and
  logic editors should feel like parts of the same creative environment.

A Project selects independently maintained Units and supplies its own content
and configuration. The Host provides the shared runtime and workspace. Your
game keeps its identity; its editor grows around it.

## Using this documentation

This wiki serves the canonical Markdown in `gams/docs` directly. The sidebar
lists all pages; use the filter to find a topic.

## Host and Project Units

- [[host-runtime|Host runtime and configuration]]
- [[project-unit-installation|Project Unit installation]]
- [[direct-file-downloads|Direct-file downloads]]
- [[zip-project-units|ZIP Project Units]]
- [[project-loading|Startup progress]]
- [[project-saving|Project saving]]

## Shared UI

- [[gams-view-development-guide|GAMS View Development Guide]] — canonical, protected Core View UI vocabulary
- [[animation-preview|Animation previews]]
- [[selectable-grids|Selectable grids]]
- [[game-icons|Game Icons catalogue]] — icon previews and all 4,180 ligatures
- [[game-icons-build|Game Icons build and usage]]

## Desktop packages

| System | Architecture | `TARGET` | Release asset |
| --- | --- | --- | --- |
| macOS | Apple Silicon | `aarch64-apple-darwin` | `GAMS-macos-aarch64.zip` |
| Windows | x86_64 | `x86_64-pc-windows-msvc` | `GAMS-windows-x86_64.zip` |
| Linux | x86_64 | `x86_64-unknown-linux-gnu` | `GAMS-linux-x86_64.tar.gz` |

## Development

| Command | Description |
| --- | --- |
| `make run` | Run from source; use the macOS Project picker or set `GAMS_APP_CWD`. |
| `make open` | Run from source with this repository's root `gams.json` development preview. |
| `make test` | Run native Rust, JavaScript and Python tooling tests; does not create release packages. |
| `make build` | Compile the native release executable without an archive. |
| `make package` | Build the selected platform application and its archive/checksum through incremental file targets. |
| `make clean` | Remove declared generated output/caches; refuse tracked files and directory-symlink traversal. |
| `make docs` | Build the portable wiki under `build.nosync/docs/`. |
| `make serve-docs DOCS_PORT=8080` | Preview the prepared wiki; restart after source edits. |
| `make validate-docs` | Validate wiki content using pinned justgook/wiki v1.4.0. |
| `make promo` | Assemble promo and documentation under `build.nosync/site/`. |
| `make serve-promo PROMO_PORT=8081` | Preview promo; `/docs` points to the independent docs server. |

## Preview locally

From `gams/` with its development shell active:

```sh
make serve-docs
make serve-docs DOCS_PORT=3000
make validate-docs
```

Open <http://localhost:8080> (or the selected port). Make fetches the upstream
`justgook/wiki` **v1.4.0 Makefile**, then delegates to its `serve` target. That
Makefile installs the engine and chooses Bun, Node.js, or Python. This is the
same engine release used by `imprint-zero`; no custom preview script, content
mirror, npm installation, or Host build is involved. The prepared documentation tree and a byte-for-byte copy of the checked-in
Game Icons catalogue font are under `build.nosync/docs-source/`, loaded by
`custom.css` for the catalogue. Validation delegates to the
upstream `validate` target and requires Node.js 24.

The upstream Makefile and engine are cached at `build.nosync/wiki-v1.4.0.mk` and
`build.nosync/wiki-v1.4.0/`. Make prepares documentation and the catalogue font under build.nosync; restart
serve-docs after source edits to refresh that prepared content. Add new pages to `_sidebar.md` as part of authoring. Links to files outside
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
Host. `make promo` assembles promo at the Pages root and this wiki under
`/docs/`; see the [repository README](https://github.com/kkgams/gams#promo-and-documentation)
for publishing and independent local promo/docs previews.
