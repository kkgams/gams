// Real CSS layout checks for fixtures/canvas-table.html; no copied layout rules.
export async function checkCanvasTableOverlap() {
    const results = []
    const check = (condition, message) => {
        if (!condition) throw Error(message)
        results.push(message)
    }
    const near = (a, b) => Math.abs(a - b) < 1
    for (const name of ['light', 'shadow']) {
        const root = name === 'light' ? document.querySelector('#light') : document.querySelector('canvas-table-fixture').shadowRoot
        const form = root.querySelector('form'), canvas = root.querySelector('canvas'), table = root.querySelector('table')
        const surface = form.getBoundingClientRect(), viewport = canvas.getBoundingClientRect(), overlay = table.getBoundingClientRect()
        check(getComputedStyle(form).display === 'grid', `${name}: composite form uses a grid`)
        check(near(surface.top, viewport.top) && near(viewport.top, overlay.top), `${name}: canvas and table overlap at the viewport origin`)
        check(near(viewport.width, form.clientWidth) && near(viewport.height, form.clientHeight), `${name}: canvas fills the bounded viewport`)
        check(Number(getComputedStyle(table).zIndex) > Number(getComputedStyle(canvas).zIndex), `${name}: table is above the canvas`)
        check(overlay.height > surface.height && form.scrollHeight > form.clientHeight, `${name}: oversized table remains scrollable`)
        const hitRoot = name === 'light' ? document : root
        const hit = element => {
            const rect = element.getBoundingClientRect()
            return hitRoot.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        }
        check(getComputedStyle(table).pointerEvents === 'none', `${name}: table ignores pointer input`)
        for (const selected of ['true', 'false']) {
            const cell = table.querySelector(`[aria-selected="${selected}"]`)
            check(getComputedStyle(cell).pointerEvents === 'auto' && cell.contains(hit(cell)), `${name}: aria-selected=${selected} cells and descendants receive input`)
            cell.setAttribute('aria-disabled', 'true')
            check(getComputedStyle(cell).pointerEvents === 'auto', `${name}: disabled cells keep input routing for existing guards`)
            cell.removeAttribute('aria-disabled')
        }
        const staticCell = table.rows[0].cells[1]
        staticCell.style.backgroundColor = 'rgb(255, 0, 0)'
        check(hit(staticCell) === canvas && getComputedStyle(staticCell.firstElementChild).pointerEvents === 'none', `${name}: static cells and descendants pass through to canvas`)
        check(getComputedStyle(staticCell).backgroundColor === 'rgb(255, 0, 0)', `${name}: pointer pass-through does not alter cell painting`)
        staticCell.style.removeProperty('background-color')
        form.scrollTop = 64
        await new Promise(requestAnimationFrame)
        const scrolled = canvas.getBoundingClientRect()
        check(near(scrolled.top, viewport.top) && near(scrolled.height, viewport.height), `${name}: canvas stays viewport-sized while table scrolls`)
        check(table.getBoundingClientRect().top < overlay.top - 60, `${name}: table scrolls above stationary canvas`)
        const aside = root.querySelector('aside').getBoundingClientRect(), footer = root.querySelector('footer').getBoundingClientRect()
        check(aside.left >= surface.right - 1 && footer.top >= surface.bottom - 1, `${name}: aside and footer remain outside the stack`)
        form.scrollTop = 0
        const container = document.querySelector(`#${name}`)
        container.style.width = '480px'
        container.style.height = '240px'
        await new Promise(requestAnimationFrame)
        const resized = canvas.getBoundingClientRect()
        check(near(resized.width, form.clientWidth) && near(resized.height, form.clientHeight) && resized.width < viewport.width && resized.height < viewport.height, `${name}: viewport follows Area resizing without table-driven expansion`)
        container.style.removeProperty('width')
        container.style.removeProperty('height')
        await new Promise(requestAnimationFrame)
    }
    const ordinary = document.querySelector('#nonadjacent > form')
    check(getComputedStyle(ordinary).display === 'flex', 'nonadjacent canvas and table preserve ordinary form layout')
    check(getComputedStyle(ordinary.querySelector('table')).pointerEvents === 'auto', 'ordinary tables retain pointer input')
    return { passed: results.length, results }
}
