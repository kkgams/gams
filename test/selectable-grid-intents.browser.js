// Run from fixtures/selectable-grid-intents.html, optionally with ?theme=URL.
// Uses actual CSSOM/computed styles, not a second implementation of the rules.
export function checkSelectableGridIntents() {
    const results = []
    const check = (condition, message) => {
        if (!condition) throw new Error(message)
        results.push(message)
    }
    const appearance = element => {
        const style = getComputedStyle(element)
        return [style.backgroundColor, style.color].join("|")
    }
    const expected = (element, background, foreground = "inherit") => {
        const probe = document.createElement("span")
        probe.style.background = `var(${background})`
        probe.style.color = foreground.startsWith("--") ? `var(${foreground})` : foreground
        element.append(probe)
        const value = appearance(probe)
        probe.remove()
        return value
    }
    const the98 = new URLSearchParams(location.search).get("theme")?.endsWith("/the98.css")
    const selectedAppearance = element => the98
        ? expected(element, "--dialog-blue", "white")
        : expected(element, "--intent-soft-bg", "--intent-soft-fg")

    // Exercise the real hover selectors without requiring pointer automation.
    // Restore them even on failure; keep disabled guards and declarations intact.
    const sheet = [...document.styleSheets].find(sheet => sheet.href?.endsWith("/css/base.css"))
    const base = [...sheet.cssRules].find(rule => rule.name === "base")
    const theme = [...sheet.cssRules].find(rule => rule.name === "theme")
    const selectedHover = [...base.cssRules].find(rule => rule.selectorText?.startsWith('[aria-selected="true"]') && rule.selectorText.includes(":hover"))
    const unselectedHover = [...theme.cssRules].find(rule => rule.selectorText?.includes('td[role="gridcell"]') && rule.selectorText.includes(":hover"))
    check(Boolean(selectedHover && unselectedHover), "selected and unselected hover rules exist in their expected layers")
    const hoverRules = [selectedHover, unselectedHover].map(rule => [rule, rule.selectorText])
    for (const [rule, selector] of hoverRules) rule.selectorText = selector.replace(":hover", "[data-test-hover]")
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
                        const resting = selected ? selectedAppearance(cell) : neutral
                        check(appearance(cell) === resting, `${name}: selected=${selected} disabled=${disabled} resting appearance`)
                        cell.dataset.testHover = ""
                        const hovered = disabled ? resting : selected
                            ? the98 ? resting : expected(cell, "--intent-hover-bg", "--intent-fg")
                            : expected(cell, "--surface-hover")
                        check(appearance(cell) === hovered, `${name}: selected=${selected} disabled=${disabled} hover appearance`)
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

                // Selection is global: ordinary table rows receive the same defaults.
                table.removeAttribute("role")
                cell.removeAttribute("aria-selected")
                const row = table.rows[0]
                row.className = intent
                row.setAttribute("aria-selected", "true")
                check(appearance(row) === selectedAppearance(row), `${name}: row selection respects theme overrides`)
            }
        }
        const button = document.createElement("button")
        button.style.transition = "none"
        button.textContent = "Selected action"
        button.setAttribute("aria-selected", "true")
        document.querySelector("main").append(button)
        for (const disabled of [false, true]) {
            button.disabled = disabled
            const resting = appearance(button)
            button.dataset.testHover = ""
            const hovered = disabled || the98 ? resting : expected(button, "--intent-hover-bg", "--intent-fg")
            check(appearance(button) === hovered, `selected button: native disabled=${disabled} hover appearance`)
            delete button.dataset.testHover
        }
        button.remove()
    } finally {
        for (const [rule, selector] of hoverRules) rule.selectorText = selector
    }
    return { passed: results.length, results }
}
