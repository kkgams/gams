const CELL = 'td[role="gridcell"][aria-selected]'
const NAVIGATION_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"])

function assert(condition, message) {
    if (!condition) throw new Error(`selectable-grid: ${message}`)
}

// Rows contain cells or null (disabled positions). Static cells are excluded.
// Kept DOM-independent so irregular rows and disabled navigation are testable.
export function gridNavigationTarget(rows, current, key, wholeGrid = false) {
    const rowIndex = rows.findIndex((row) => row.includes(current))
    assert(current !== null && rowIndex >= 0, "current cell must belong to the grid")
    const row = rows[rowIndex], column = row.indexOf(current)
    const all = rows.flat().filter((cell) => cell !== null)
    if (key === "Home") return wholeGrid ? all[0] : row.find((cell) => cell !== null)
    if (key === "End") return (wholeGrid ? all : row.filter((cell) => cell !== null)).at(-1)
    if (key === "ArrowLeft" || key === "ArrowRight") {
        const step = key === "ArrowLeft" ? -1 : 1
        for (let i = column + step; i >= 0 && i < row.length; i += step) {
            if (row[i] !== null) return row[i]
        }
    } else if (key === "ArrowUp" || key === "ArrowDown") {
        const step = key === "ArrowUp" ? -1 : 1
        for (let i = rowIndex + step; i >= 0 && i < rows.length; i += step) {
            const available = rows[i].map((cell, index) => ({ cell, index })).filter(({ cell }) => cell !== null)
            available.sort((a, b) => Math.abs(a.index - column) - Math.abs(b.index - column))
            if (available.length) return available[0].cell
        }
    }
    return current
}

// Single-selection, manual-activation grid. Does not choose records or render UI.
export function bindSelectableGrid(grid, { activate }) {
    assert(grid instanceof HTMLTableElement && grid.getAttribute("role") === "grid", "table[role=grid] required")
    assert(grid.getAttribute("aria-label") || grid.getAttribute("aria-labelledby"), "grid needs an accessible name")
    assert(typeof activate === "function", "activate callback required")
    const cells = () => Array.from(grid.querySelectorAll(CELL)).filter((cell) => cell.closest('table') === grid)
    const enabled = (cell) => cell.getAttribute("aria-disabled") !== "true"
    const cellFor = (event) => {
        if (!(event.target instanceof Element)) return null
        const cell = event.target.closest(CELL)
        return cell && cell.closest('table') === grid ? cell : null
    }
    const tabstop = (target, focus) => {
        for (const cell of cells()) cell.tabIndex = cell === target ? 0 : -1
        if (target === null) grid.tabIndex = 0
        else grid.removeAttribute("tabindex")
        if (focus) (target === null ? grid : target).focus()
    }
    const refresh = ({ focus = false } = {}) => {
        const records = cells()
        assert(records.filter((cell) => cell.getAttribute("aria-selected") === "true").length <= 1, "only one selected cell is supported")
        for (const cell of records) {
            assert(["true", "false"].includes(cell.getAttribute("aria-selected")), "aria-selected must be true or false")
            assert(!cell.hasAttribute("aria-disabled") || ["true", "false"].includes(cell.getAttribute("aria-disabled")), "aria-disabled must be true or false")
            assert(cell.getAttribute("aria-label") || cell.getAttribute("aria-labelledby"), "selectable cell needs an accessible name")
            assert(!cell.querySelector('button, input, select, textarea, a[href], [contenteditable="true"], [tabindex]'), "selectable cells must not contain interactive descendants")
        }
        const available = records.filter(enabled)
        const active = grid.ownerDocument.activeElement
        const target = available.includes(active) ? active : available.find((cell) => cell.getAttribute("aria-selected") === "true") || available[0] || null
        tabstop(target, focus)
    }
    const onPointerDown = (event) => {
        const cell = cellFor(event)
        if (cell !== null && !enabled(cell)) event.preventDefault()
    }
    const onClick = (event) => {
        const cell = cellFor(event)
        if (cell === null) return
        event.preventDefault()
        if (!enabled(cell)) return
        tabstop(cell, true)
        activate(cell)
    }
    const onFocus = (event) => {
        const cell = cellFor(event)
        if (cell !== null && enabled(cell)) tabstop(cell, false)
    }
    const onKey = (event) => {
        const cell = cellFor(event)
        if (cell === null || !enabled(cell) || event.altKey) return
        const activation = event.key === "Enter" || event.key === " "
        if (!activation && !NAVIGATION_KEYS.has(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        if (activation) {
            if (!event.repeat) activate(cell)
            return
        }
        const rows = Array.from(grid.tBodies).flatMap((body) => Array.from(body.rows)).map((row) =>
            Array.from(row.cells).filter((entry) => entry.matches(CELL)).map((entry) => enabled(entry) ? entry : null),
        )
        tabstop(gridNavigationTarget(rows, cell, event.key, event.ctrlKey || event.metaKey), true)
    }
    grid.addEventListener("pointerdown", onPointerDown)
    grid.addEventListener("click", onClick)
    grid.addEventListener("focusin", onFocus)
    grid.addEventListener("keydown", onKey)
    refresh()
    return {
        refresh,
        destroy() {
            grid.removeEventListener("pointerdown", onPointerDown)
            grid.removeEventListener("click", onClick)
            grid.removeEventListener("focusin", onFocus)
            grid.removeEventListener("keydown", onKey)
        },
    }
}
