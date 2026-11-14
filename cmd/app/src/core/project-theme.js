import { validateLocalPath } from "./local-path.js"

function unwrapRead(result) {
    if (result && Object.hasOwn(result, "err")) throw new Error(`theme read: ${result.err}`)
    if (!result || !Object.hasOwn(result, "ok")) throw new Error("theme read: expected WIT result object")
    const bytes = result.ok
    if (!(bytes instanceof Uint8Array) && (!Array.isArray(bytes) || !bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)))
        throw new Error("theme read: expected CSS bytes")
    return bytes
}

// Native preparation supplies the local path; configured plugins provide FS.
// Stylesheet load is part of startup completion.
export async function loadProjectTheme(config, { runtime, document, url = URL }) {
    if (!config || !config.ui || typeof config.ui !== "object" || Array.isArray(config.ui))
        throw new Error("gams config ui must be an object")
    const link = document.getElementById("theme-stylesheet")
    if (!link || link.tagName !== "LINK" || link.getAttribute("rel") !== "stylesheet")
        throw new Error("Host theme stylesheet link is required")
    // An absent/null theme means base styling, not a missing required Unit.
    if (config.ui.theme == null) {
        link.removeAttribute("href")
        return { path: null, href: null }
    }
    const source = config.ui.theme.url ?? config.ui.theme.path
    const path = validateLocalPath(source, "gams config ui.theme.url")
    const bytes = unwrapRead(await runtime.invoke("fs/fs::read-file", path))
    const href = url.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "text/css" }))
    const previousHref = link.getAttribute("href")
    try {
        await new Promise((resolve, reject) => {
            function cleanup() {
                link.removeEventListener("load", loaded)
                link.removeEventListener("error", failed)
            }
            function loaded() { cleanup(); resolve() }
            function failed() { cleanup(); reject(new Error(`Project theme stylesheet could not be loaded: ${source}`)) }
            link.addEventListener("load", loaded)
            link.addEventListener("error", failed)
            link.setAttribute("href", href)
        })
    } catch (error) {
        // Resource cleanup, not recovery: propagate failure to the startup UI.
        if (previousHref === null) link.removeAttribute("href")
        else link.setAttribute("href", previousHref)
        url.revokeObjectURL(href)
        throw error
    }
    return { path, href }
}
