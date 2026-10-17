---
title: "Game Icons font"
status: reference
---

# Game Icons font

The Host provides a checked-in, monochrome ligature font built from
[game-icons.net](https://game-icons.net/). The [full catalogue](#/game-icons)
contains all 4,180 icons from the pinned source (excluding repository badges),
with preview, exact ligature, contributor, and license.

```html
<i class="game-icons" aria-hidden="true">crystal-ball</i>
```

Bare `<i>` still uses Material Symbols Rounded. Give icon-only controls an
accessible label on the control. Names are case-sensitive and retain hyphens.
Both variants of duplicated upstream basenames use contributor prefixes, e.g.
`lorc-tesla-coil` and `caro-asercion-tesla-coil`; consult the catalogue rather than guessing names.
Private-use codepoints are included in `cmd/app/src/fonts/game-icons.json`, but
names are the recommended interface: codepoint assignments may change on a
source update. Core Views may use this markup under the
[GAMS View Development Guide's icon rules](#/gams-view-development-guide?section=icons).
Existing Views and widget APIs are not automatically migrated to this font.

## Build

From `gams/`, with the documented development shell active:

```sh
make cmd/app/src/fonts/game-icons.woff2
make game-icons-check
```

The font is tracked with its generated JSON manifest, provenance, contributor
notices and Markdown catalogue. The file target has **no prerequisites**:
when it exists, Make does nothing, even if `build.nosync` is empty. Normal Host
builds do not run npm, pip, or download icons. `make clean` removes caches,
not the checked-in font. The repository's default Make goal is unchanged.

To deliberately regenerate after changing scripts or the upstream pin:

```sh
rm cmd/app/src/fonts/game-icons.woff2
make cmd/app/src/fonts/game-icons.woff2
```

The recipe recursively builds intermediate file targets under
`build.nosync/game-icons/`: immutable-revision archive download, extracted source,
prepared SVGs, locked npm tooling, pinned Python tooling, then generated outputs.
Archive checksum verification is intentionally omitted. Interrupted stages do
not receive completion stamps. The final font is installed last, after its
companion files. Cached intermediate targets still use ordinary dependency
tracking. A new source pin invalidates preparation and generation.

Build prerequisites: Make, bash, curl, tar, Node/npm, and Python with venv/pip.
The npm tree is pinned in `scripts/game-icons/package-lock.json`; Python packages
are pinned in `requirements.txt`. They are installed only under `build.nosync`.
The shell must permit HTTPS downloads on the first generation/check setup.

## Conversion and verification

Preparation accepts only the pinned upstream SVG structure: a 512×512 square
background followed by one white compound foreground path. It removes only that
verified background, preserving foreground winding and cutouts. Unexpected SVGs,
unknown contributors, invalid names, collisions, or private-use range overflow
are errors. The upstream `badges/` directory is excluded, as it is in the
upstream colorization script.

svgtofont generates the outlines and character mappings. Its underlying svg2ttf
writer overflows 16-bit GSUB offsets with the entire collection; merely enabling
`addLigatures` gives a font whose names do not shape. `finish.py` replaces that
table using FontTools extension lookups and longest-first ligature rules, then
encodes WOFF2. HarfBuzz verifies **every** full name resolves to its intended
private-use glyph, catching prefix collisions such as `fire`/`fire-shield`.
The check runs during generation and with `make game-icons-check`.
Font timestamps are fixed for reproducible output.

The wiki catalogue renders the actual WOFF2 through name ligatures, not SVG
images. `make serve-docs` and `make validate-docs` copy the canonical Host font
to ignored `docs/assets/game-icons.woff2`; `docs/custom.css` loads those exact
bytes. No second font build or remote image requests are needed. `make clean`
removes the generated docs copy, not the checked-in Host font. Plain GitHub
Markdown cannot load this CSS/font and shows the ligature text instead.

## Attribution and release status

Icons made by the authors credited in the catalogue and upstream contributor
notice. Most are CC BY 3.0; Viscious Speed, Zeromancer, and the two Various artists
icons are CC0. The latter exceptions are documented on the individual upstream
[infinity](https://game-icons.net/1x1/various-artists/infinity.html) and
[salmon](https://game-icons.net/1x1/various-artists/salmon.html) pages (the salmon
page additionally credits the Swedish Road Administration's original design).
The upstream contributor list omits Various artists; preserve these additional
credits too. Background removal and font/ligature conversion are modifications,
not unmodified upstream font downloads. Preserve:

- `cmd/app/src/fonts/GAME-ICONS-PROVENANCE.md`
- `cmd/app/src/fonts/game-icons.json` (per-icon attribution)
- `cmd/app/src/fonts/licenses/game-icons.contributors.txt`
- `cmd/app/src/fonts/licenses/game-icons.CC-BY-3.0.txt`
- `cmd/app/src/fonts/licenses/game-icons.CC0-1.0.txt`

Full legal texts were obtained from
https://creativecommons.org/licenses/by/3.0/legalcode.txt and
https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt.

**Release review pending:** the new font is outside all previously approved
NOTICE evidence. The [v2.0.7 preparation](#/release-2-0-7-review) refreshes the
candidate NOTICE and 57-input manifest within its recorded boundary. Exact
owner approval is still required before candidate distribution; consistency
checks passing do not satisfy that approval gate. Readable release packaging
includes the generated font metadata and provenance under `FONT-LICENSES/`,
in addition to the license texts; the ZIP checker enforces their exact bytes. No release or publication is authorized by this implementation.
