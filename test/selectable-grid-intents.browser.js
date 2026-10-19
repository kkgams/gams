// Run from fixtures/selectable-grid-intents.html, optionally with ?theme=URL.
// Uses actual CSSOM/computed styles, not a second implementation of the rules.
export function checkSelectableGridIntents() {
    const results = []
    const check = (condition, message) => {
        if (!condition) throw new Error(message)
        results.push(message)
    }
    const appearance = cell => {
        const style = getComputedStyle(cell)
        return [style.backgroundColor, style.color].join("|")
    }
    const expected = (cell, background, foreground) => {
        const probe = document.createElement("span")
        probe.style.background = `var(${background})`
        probe.style.color = `var(${foreground})`
        cell.append(probe)
        const value = appearance(probe)
        probe.remove()
        return value
    }
    // Exercise the real hover selector without requiring pointer automation.
    // Only replace the pseudo-class during these synchronous checks; restore it
    // even on failure. Disabled guards and the actual declarations stay intact.
    const base = [...document.styleSheets].find(sheet => sheet.href?.endsWith("/css/base.css"))
    const intent = [...base.cssRules].find(rule => rule.name === "intent")
    const hover = [...intent.cssRules].find(rule => rule.selectorText?.includes('td[role="gridcell"]') && rule.selectorText.includes(":hover"))
    const selector = hover.selectorText
    hover.selectorText = selector.replace(":hover", "[data-test-hover]")
    try {
        for (const separate of [false, true]) {
            for (const intent of ["accent", "success", "warning", "danger", "info"]) {
                const table = document.createElement("table")
                table.setAttribute("role", "grid")
                table.setAttribute("aria-label", `${intent} ${separate ? "separate" : "ordinary"}`)
                if (separate) table.dataset.layout = "separate"
                table.innerHTML = '<tbody><tr><td role="gridcell" aria-label="Record" aria-selected="false" tabindex="0">Record</td><td role="gridcell">Static</td></tr></tbody>'
                document.querySelector("main").append(table)
                const cell = table.rows[0].cells[0]
                const staticCell = table.rows[0].cells[1]
                const name = table.getAttribute("aria-label")
                const neutral = appearance(cell)
                const staticBackground = getComputedStyle(staticCell).backgroundColor
                staticCell.className = intent
                check(getComputedStyle(staticCell).backgroundColor === staticBackground, `${name}: static surface untouched`)
                staticCell.className = ""
                cell.className = intent
                for (const disabled of [false, true]) {
                    cell.setAttribute("aria-disabled", String(disabled))
                    for (const selected of [false, true]) {
                        cell.setAttribute("aria-selected", String(selected))
                        const tokens = selected ? ["--intent-bg", "--intent-fg"] : ["--intent-soft-bg", "--intent-soft-fg"]
                        check(appearance(cell) === expected(cell, ...tokens), `${name}: selected=${selected} disabled=${disabled} token pair`)
                        cell.dataset.testHover = ""
                        const hoverTokens = !selected && !disabled ? ["--intent-hover-bg", "--intent-fg"] : tokens
                        check(appearance(cell) === expected(cell, ...hoverTokens), `${name}: selected=${selected} disabled=${disabled} hover token pair`)
                        delete cell.dataset.testHover
                        const opacity = getComputedStyle(cell).opacity
                        const cursor = getComputedStyle(cell).cursor
                        cell.className = ""
                        check(opacity === getComputedStyle(cell).opacity, `${name}: disabled opacity preserved`)
                        check(cursor === getComputedStyle(cell).cursor, `${name}: disabled cursor preserved`)
                        cell.className = intent
                    }
                }
                cell.setAttribute("aria-disabled", "false")
                cell.setAttribute("aria-selected", "false")
                cell.focus()
                check(cell.matches(":focus-visible"), `${name}: keyboard focus visible`)
                const focus = getComputedStyle(cell)
                check(focus.outlineStyle !== "none" && parseFloat(focus.outlineWidth) > 0, `${name}: focus outline retained`)
                cell.className = ""
                check(appearance(cell) === neutral, `${name}: removing intent restores neutral appearance`)
            }
        }
    } finally {
        hover.selectorText = selector
    }
    return { passed: results.length, results }
}
