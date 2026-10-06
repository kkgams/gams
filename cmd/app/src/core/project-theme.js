function unwrapRead(result) {
    if (result && Object.hasOwn(result, "err")) throw new Error(`theme read: ${result.err}`)
    if (!result || !Object.hasOwn(result, "ok")) throw new Error("theme read: expected WIT result object")
    const bytes = result.ok
    if (!(bytes instanceof Uint8Array) && (!Array.isArray(bytes) || !bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)))
        throw new Error("theme read: expected CSS bytes")
    return bytes
}

// Resolving and reading a Project theme requires the filesystem bootstrap, not
// other plugins or UI Services. Stylesheet load is part of startup completion.
export async function loadProjectTheme(config, { projectUnits, runtime, document, url = URL }) {
    if (!config || !config.ui || !config.ui.theme) throw new Error("gams config ui.theme.url is required")
    const source = config.ui.theme.url ?? config.ui.theme.path
    if (typeof source !== "string" || source.length === 0) throw new Error("gams config ui.theme.url is required")
    const link = document.getElementById("theme-stylesheet")
    if (!link || link.tagName !== "LINK" || link.getAttribute("rel") !== "stylesheet")
        throw new Error("Host theme stylesheet link is required")

    const path = await projectUnits.resolve(source)
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
