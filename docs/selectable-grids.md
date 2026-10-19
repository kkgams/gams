---
title: "Selectable cell grids"
status: reference
---

# Selectable cell grids

Shared Host UI support for single-selection icon/record grids. This extends cell
selection without changing existing row-selection behavior. The canonical semantic
vocabulary and interaction rules live in the Host-owned
[GAMS View Development Guide](#/gams-view-development-guide?section=selectable-cell-grids),
under **Tables → Selectable cell grids**.

## Ownership

- `cmd/app/src/css/base.css`: generic interaction/focus, icon centering, disabled
  treatment and selected/hover appearance fallback for older themes.
- `/util/selectable-grid.js`: shared browser interaction helper. No runtime,
  storage, Project-specific state, image decoding or tooltip rendering.
- Independently released themes may override neutral selected/focus appearance.
- Explicit `.accent`, `.success`, `.warning`, `.danger` and `.info` classes on
  selectable cells consume the Host intent tokens in the final `intent` layer:
  soft background/foreground when unselected, filled when selected, and filled
  hover tokens for enabled unselected cells. Theme focus and disabled cues stay
  intact. Static cells (without `aria-selected`) are outside this fill contract.
- A View creates record cells, accessible names and service-owned tooltip calls,
  and handles activation. No View-specific selection CSS is needed.

## Helper

```js
import { bindSelectableGrid } from "/util/selectable-grid.js"

const controller = bindSelectableGrid(table, {
    activate(cell) {
        // Resolve this record, apply the domain action, update aria-selected.
        // Selection does not follow focus automatically.
    },
})
controller.refresh()
// After replacing records during activation:
controller.refresh({ focus: true })
// Before removing/rebuilding the table:
controller.destroy()
```

`table` must be an `HTMLTableElement` with `role="grid"` and an accessible name.
Interactive records are `td[role="gridcell"][aria-selected]` in the table's own
body rows. Static grid cells omit `aria-selected` and are ignored by the helper.
Nested tables are not included. Each record's `aria-selected` (and optional
`aria-disabled`) must be `true` or `false`. At most one selected record is allowed.
Interactive descendants are rejected, rather than creating competing Tab stops.

`refresh({ focus = false })` validates current cells and assigns one Tab stop:
retain a surviving focused enabled cell, otherwise the selected enabled cell,
otherwise the first enabled cell. With no enabled cells, the table is the Tab
stop. `focus: true` also restores actual DOM focus after a rerender; the caller
should use this only when focus was inside that grid, never steal input focus.

Arrows move among enabled interactive records, skipping static cells, without
wrapping. Up/Down choose the closest available interactive column in the next
nonempty enabled row (leftmost on a tie). Home/End use row edges; Ctrl/Meta
Home/End use grid edges. Enter/Space and click call `activate(cell)`. Key repeat
never repeatedly activates a cell. Tab/Shift+Tab are not intercepted. Disabled
records cannot activate and do not participate in roving focus. Navigation changes
focus only; the View's activation callback owns selection changes.

Install once per table, call `refresh()` after state/DOM changes, and destroy the
old controller before reinstallation. Click/keyboard events are delegated, so
replacing cell nodes does not require per-cell interaction listeners.

Name tips still go through `ui.tooltip.tip`, anchored to the cell. The helper
never creates floating UI or changes selected data itself.

## Compatibility and verification

Views importing the helper require a Host containing this source addition;
previous downloaded Host binaries do not acquire it automatically. Base CSS has
an accent-colored fallback when an older theme has no cell-selection selectors.
Updated the98 source supplies its classic row-selection blue for cells as well.
No release artifact, approval digest or existing Project Unit cache is modified
by this source change.

```sh
node --test test/selectable-grid.test.mjs
```

The pure navigation tests cover irregular/disabled rows, boundaries and Home/End.
For computed-style regression checks, serve the workspace root and open
`gams/test/fixtures/selectable-grid-intents.html`, then repeat with
`?theme=/theme.the98/src/themes/the98.css`. The fixture reports its assertions in
`window.gridIntentResults` and on the page. It checks all five intents in ordinary
and separate layouts, selected/disabled combinations, token foreground/background
pairs, neutral restoration, static surface exclusion and focus outlines. Hover
selectors are temporarily exercised through a test attribute and restored; also
check real pointer hover manually. No sibling theme is required for the base run.

Browser integration must also verify Tab stops, focus restoration, mouse/keyboard
activation, disabled guards, tooltip ownership and computed theme styles. The
Host's complete JS suite is `node --test test/*.test.mjs`; native checks remain
separate and do not prove an external Project's browser behavior.
