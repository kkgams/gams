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
        const x = overlay.left + 20, y = overlay.top + 10
        const hitRoot = name === 'light' ? document : root
        check(hitRoot.elementFromPoint(x, y).closest('table') === table, `${name}: table retains pointer input`)
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
    return { passed: results.length, results }
}
