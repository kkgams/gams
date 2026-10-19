// Run against a Host preview exposing /css and /fonts, in a real browser.
// Independent of any View source; the shadow root uses canonical Host CSS.
export async function checkGameIconLigatures() {
    const css = await fetch('/css/base.css')
    if (!css.ok) throw new Error('Canonical Host CSS must be served')
    const catalogue = await fetch('/fonts/game-icons.json')
    if (!catalogue.ok) throw new Error('Canonical Game Icons catalogue must be served')
    const { icons } = await catalogue.json()
    const faces = await document.fonts.load('32px "Game Icons"')
    if (!faces.length || faces.some(face => face.status !== 'loaded')) throw new Error('Game Icons font must load')
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = await css.text()
    root.append(style)
    document.body.append(host)
    const results = []
    try {
        for (const name of ['person', 'skoll-headshot', 'hair-strands', 'lorc-trousers', 'bow-tie', 'sleeveless-jacket']) {
            const entry = icons.find(icon => icon.ligature === name)
            if (!entry) throw new Error(`Missing catalogue entry: ${name}`)
            const icon = document.createElement('i')
            icon.className = 'game-icons'
            icon.style.fontSize = '32px'
            icon.textContent = name
            const direct = icon.cloneNode()
            direct.textContent = String.fromCodePoint(entry.codepoint)
            root.append(icon, direct)
            const range = document.createRange()
            range.selectNodeContents(icon)
            const width = range.getBoundingClientRect().width
            range.selectNodeContents(direct)
            const expected = range.getBoundingClientRect().width
            if (expected <= 0 || Math.abs(width - expected) > 0.1) {
                throw new Error(`${name}: ligature width ${width}, direct glyph width ${expected}`)
            }
            results.push({ name, width, expected })
            icon.remove()
            direct.remove()
        }
        return { passed: results.length, results }
    } finally {
        host.remove()
    }
}
