import { runtime } from "/core/runtime.js"
import { initSaveMenu } from "/core/menu.js"
// import { openSqlVecConnection, sql } from "/core/sql.js"
import { init, prepareTheme } from "/___/services.js"
import { projectUnits } from "/util/require.js"
import { createStartupProgress } from "/core/startup-progress.js"

// Default package folder; runtime.modulesDir supplies the native-selected path.
const GAMS_MODULES = "gams_modules"
// Temporary Host-owned bootstrap pin; all other Unit sources are Project-owned.
const FS_BOOTSTRAP_SOURCE = "https://github.com/kkgams/plugin.fs/releases/download/v0.1.1/plugin.fs.wasm"

app.innerHTML = ""
const loading = createStartupProgress(document, () => location.reload())
const unsubscribeProgress = projectUnits.subscribeProgress((event) => loading.update(event))

async function main() {
    console.time("runtime.ready")
    await runtime.ready
    console.timeEnd("runtime.ready")

    const config = runtime.config
    loading.phase("Preparing filesystem", 1)
    await projectUnits.bootstrapFilesystem(FS_BOOTSTRAP_SOURCE)

    loading.phase("Preparing theme and plugins", 2)
    const themeReady = prepareTheme(config)
    await Promise.all([themeReady, loadPlugins(config)])

    const saveMenu = await initSaveMenu()
    loading.phase("Loading Project interface", 3)
    console.time("init UI")
    await init(config, themeReady)
    console.timeEnd("init UI")
    await saveMenu.enable()
    return saveMenu
}

async function loadPlugins(config) {
    console.time("addPlugins")
    const pluginPaths = await Promise.all(config.plugins.map((source) => projectUnits.resolve(source)))
    await runtime.addPlugins(pluginPaths, true)
    console.timeEnd("addPlugins")
}

const saveMenu = await main().then(
    (menu) => {
        unsubscribeProgress()
        loading.finish()
        return menu
    },
    (error) => {
        unsubscribeProgress()
        loading.fail(error)
        console.error("[project.open] Startup failed", error)
        return null
    },
)

if (saveMenu) {
    globalThis.runtime = runtime
    startFpsOverlay()
}

function startFpsOverlay() {
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
}
