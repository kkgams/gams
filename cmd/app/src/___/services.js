import { require, projectUnits } from "/util/require.js"
import { runtime } from "/core/runtime.js"
import { getUiServiceSources } from "/core/ui-service-sources.js"
import { restoreViewSourceState } from "/util/view-source-state.js"
import { loadProjectTheme } from "/core/project-theme.js"

let currentThemeStylesheetObjectUrl = ""

function doInit(config) {
    return Promise.all(getUiServiceSources(config).map(source => require(source)))
    .then(async ([{ createUiContext }, { createUiKeys }]) => {
        runtime.register(createUiContext())
        runtime.register(createUiKeys(config))

        const viewRegistry = createConfiguredViewRegistry(config)
        runtime.register({
            id: "ui.views",
            methods: {
                config(tag) {
                    const entry = config.ui.views[String(tag || "")]
                    if (!entry) throw new Error(`Unknown view '${tag}'`)
                    return entry.config || null
                },
                async create(tag, props = {}) {
                    const viewTag = String(tag || "")
                    const entry = viewRegistry.get(viewTag)
                    if (!entry) throw new Error(`Unknown view '${viewTag}'`)
                    if (!props || typeof props !== "object" || Array.isArray(props))
                        throw new Error("ui.views.create props must be an object")
                    const element = await entry.create({ tag: viewTag, attrs: {}, innerHTML: "" })
                    Object.assign(element, props)
                    return element
                },
            },
        })

        const layout = document.querySelector("ui-layout")
        layout.setViewRegistry(viewRegistry)

        const toast = document.querySelector("toast-manager")
        runtime.register({ id: "ui.toast", methods: toast.api })
        const popup = document.querySelector("popup-manager")
        runtime.register({ id: "ui.popup", methods: popup.api })
        popup.setViewRegistry(viewRegistry)
        const tooltip = document.querySelector("tooltip-manager")
        runtime.register({ id: "ui.tooltip", methods: tooltip.api })

        window.onerror = function (_message, _source, _lineno, _colno, error) {
            runtime.call("ui.toast.error", errorParse(error))
            return false // prevents default logging (optional)
        }

        window.addEventListener("unhandledrejection", (e) => {
            runtime.call("ui.toast.error", errorParse(e))
        })
        await layout.load(config.ui.services["ui-layout"].config.layout)
    })
}

export async function init(config, themeReady = prepareTheme(config)) {
    const fragment = new DocumentFragment()
    fragment.appendChild(document.createElement("ui-layout"))
    fragment.appendChild(document.createElement("popup-manager"))
    fragment.appendChild(document.createElement("tooltip-manager"))
    fragment.appendChild(document.createElement("toast-manager"))

    document.body.appendChild(fragment)
    await themeReady
    await doInit(config)
}

function errorParse(error) {
    const e = error.reason || error
    console.trace(e)
    return `${e.plugin ? "[" + e.plugin + "]: " : ""}${e.message || e}`
}

function createConfiguredViewRegistry(config) {
    const entries = config.ui.views
    if (!entries || typeof entries !== "object" || Array.isArray(entries))
        throw new Error("gams config ui.views is required")
    return new Map(
        Object.entries(entries).map(([tag, viewConfig]) => {
            if (!viewConfig || typeof viewConfig !== "object" || Array.isArray(viewConfig))
                throw new Error(`gams config ui.views.${tag} must be an object`)
            return [
                tag,
                {
                    label: viewConfig.label || tag,
                    group: viewConfig.group || "",
                    internal: viewConfig.internal === true,
                    async load() {
                        if (customElements.get(tag)) return
                        if (typeof viewConfig.url !== "string" || viewConfig.url.length === 0)
                            throw new Error(`gams config ui.views.${tag}.url is required`)
                        await require(viewConfig.url)
                        if (!customElements.get(tag))
                            throw new Error(`view '${tag}' did not register custom element '${tag}'`)
                    },

                    async create(options = {}) {
                        await this.load()
                        const el = document.createElement(tag)
                        // el.runtime = runtime
                        el.viewConfig = viewConfig
                        if (viewConfig.config !== undefined) el.config = viewConfig.config
                        const explicitAttributes = options.attrs || {}
                        restoreViewSourceState(el, explicitAttributes)
                        if (
                            viewConfig.defaultSource !== undefined &&
                            !Object.hasOwn(explicitAttributes, "data-source") &&
                            !el.hasAttribute("data-source")
                        )
                            el.setAttribute("data-source", viewConfig.defaultSource)
                        return el
                    },
                },
            ]
        }),
    )
}

export async function prepareTheme(config) {
    const { path: themePath, href: themeHref } = await loadProjectTheme(config, { projectUnits, runtime, document })
    const previousUrl = currentThemeStylesheetObjectUrl
    currentThemeStylesheetObjectUrl = themeHref

    window.__currentThemePath = themePath
    window.__currentThemeStylesheetHref = themeHref

    document.querySelectorAll("view-area, view-popup").forEach((el) => {
        const shadowLink = el.shadowRoot?.querySelector("link[data-theme-stylesheet]")
        if (shadowLink) shadowLink.setAttribute("href", themeHref)
    })

    if (previousUrl) URL.revokeObjectURL(previousUrl)
}
