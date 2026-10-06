import { runtime } from "/core/runtime.js"
import { initSaveMenu } from "/core/menu.js"
// import { openSqlVecConnection, sql } from "/core/sql.js"
import { init } from "/___/services.js"
import { projectUnits } from "/util/require.js"

// Default package folder; runtime.modulesDir supplies the native-selected path.
const GAMS_MODULES = "gams_modules"
// Temporary Host-owned bootstrap pin; all other Unit sources are Project-owned.
const FS_BOOTSTRAP_SOURCE = "https://github.com/kkgams/plugin.fs/releases/download/v0.1.1/plugin.fs.wasm"

app.innerHTML = ""

async function main() {
    console.time("runtime.ready")
    await runtime.ready
    console.timeEnd("runtime.ready")

    const config = runtime.config
    await projectUnits.bootstrapFilesystem(FS_BOOTSTRAP_SOURCE)

    console.time("addPlugins")
    const pluginPaths = await Promise.all(config.plugins.map(source => projectUnits.resolve(source)))
    await runtime.addPlugins(pluginPaths, true)
    console.timeEnd("addPlugins")

    const saveMenu = await initSaveMenu()
    console.time("init UI")
    await init(config)
    console.timeEnd("init UI")
    await saveMenu.enable()
    return saveMenu
}

const saveMenu = await main()

//Runtime debut
globalThis.runtime = runtime

;(() => {
    const id = "__fps_overlay__"
    document.getElementById(id)?.remove()

    const el = document.createElement("div")
    el.id = id
    Object.assign(el.style, {
        position: "fixed",
        top: "8px",
        left: "8px",
        zIndex: "2147483647",
        padding: "4px 8px",
        font: "12px monospace",
        color: "#0f0",
        background: "rgba(0,0,0,0.75)",
        borderRadius: "4px",
        pointerEvents: "none",
        userSelect: "none",
    })
    el.textContent = "FPS: --"
    document.documentElement.appendChild(el)

    let frames = 0
    let last = performance.now()

    function loop(now) {
        frames++
        if (now - last >= 500) {
            const fps = Math.round((frames * 1000) / (now - last))
            el.textContent = `FPS: ${fps}`
            frames = 0
            last = now
        }
        requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
})()
