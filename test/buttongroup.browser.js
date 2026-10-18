// Run on test/fixtures/buttongroup.html with real Host CSS and an optional theme.
// No browser dependencies; failures throw, and successful checks remain inspectable.
export function checkButtonGroups() {
    const results = []
    const check = (condition, message) => {
        if (!condition) throw new Error(message)
        results.push(message)
    }
    const theme = new URLSearchParams(location.search).has("theme")
    const groups = [...document.querySelectorAll('[role="buttongroup"]')]
    check(groups.length === 8, "all eight group arrangements are present")
    for (const [index, group] of groups.entries()) {
        const controls = [...group.children]
        const first = controls[0].getBoundingClientRect()
        for (const control of controls) {
            const rect = control.getBoundingClientRect()
            const name = `C${index + 1} ${control.tagName}`
            check(Math.abs(rect.height - first.height) < 0.5, `${name}: equal height`)
            check(Math.abs(rect.top - first.top) < 0.5, `${name}: aligned top`)
            check(rect.height >= 23, `${name}: usable control height`)
            const style = getComputedStyle(control)
            if (control instanceof HTMLSelectElement) {
                check(parseFloat(style.marginLeft) === 0, `${name}: independent select border`)
                if (new URLSearchParams(location.search).has("theme")) {
                    check(style.backgroundImage !== "none", `${name}: dropdown arrow retained`)
                    check(style.backgroundRepeat === "no-repeat", `${name}: arrow does not tile`)
                    check(parseFloat(style.paddingRight) >= 32, `${name}: arrow space retained`)
                }
            }
            if (control.previousElementSibling instanceof HTMLButtonElement && control instanceof HTMLButtonElement) {
                check(parseFloat(style.marginLeft) === -1, `${name}: adjacent buttons stay joined`)
            }
        }
    }
    // Compare standalone/listbox sizing against controls outside the group, then
    // temporarily move the listboxes into a group to catch accidental broad rules.
    const standalone = document.querySelector("#standalone")
    if (theme) check(standalone.getBoundingClientRect().height === 21, "standalone The98 select remains 21px")
    const excluded = [document.querySelector("#listbox"), document.querySelector("#multiple")]
    for (const select of excluded) {
        const parent = select.parentNode
        const next = select.nextSibling
        const height = getComputedStyle(select).height
        try {
            groups[0].append(select)
            check(["auto", "0px"].includes(getComputedStyle(select).minHeight), `${select.id}: excluded from group minimum height`)
            if (theme) check(getComputedStyle(select).height === height, `${select.id}: fixed theme height unchanged`)
        } finally {
            parent.insertBefore(select, next)
        }
    }
    return { passed: results.length, results }
}
