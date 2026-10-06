import { runtime, unwrap } from "/core/runtime.js"

// Host-owned native menu definition. Keep actions separate from View .save.
export const saveMenuItem = {
    id: "project.save",
    text: "Save Project",
}

export function createProjectSaveAction() {
    let inFlight = null
    async function save() {
        const { id } = unwrap(await runtime.call("ui.toast.progressStart", {
            message: "Saving Project…",
            progress: 0,
            position: "primary",
        }), "start Project Save progress")
        if (typeof id !== "string" || id.length === 0)
            throw new Error("Project Save progress toast requires an id")

        let result
        try {
            result = await runtime.projectSave(async progress => {
                unwrap(await runtime.call("ui.toast.progressUpdate", { id, ...progress }), "update Project Save progress")
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            unwrap(await runtime.call("ui.toast.progressError", {
                id, message: `Project save failed: ${message}`,
            }), "finish failed Project Save progress")
            // Already reported through the operation toast. Do not also produce
            // the global unhandled-rejection toast for this expected outcome.
            return { err: message }
        }
        unwrap(await runtime.call("ui.toast.progressSuccess", {
            id, message: "Project saved", duration: 3000,
        }), "finish Project Save progress")
        return result
    }
    return () => {
        if (!inFlight) inFlight = save().finally(() => { inFlight = null })
        return inFlight
    }
}

export async function initSaveMenu() {
    const { Menu, MenuItem, Submenu } = globalThis.__TAURI__.menu
    runtime.register({ id: "project", methods: { save: createProjectSaveAction() } })
    let enabled = false
    const requestSave = () => {
        if (enabled) void runtime.call("project.save")
    }

    const save = await MenuItem.new({
        ...saveMenuItem,
        enabled: false,
        action: requestSave,
    })
    // Retain the native Edit, Window, Help and macOS application menus.
    const menu = await Menu.default()
    const items = await menu.items()
    let file = null
    for (const item of items) {
        if (item.kind === "Submenu" && await item.text() === "File") {
            file = item
            break
        }
    }
    if (file) await file.prepend(save)
    else {
        file = await Submenu.new({ text: "File", items: [save] })
        await menu.insert(file, 1)
    }
    await menu.setAsAppMenu()

    // Shortcuts belong to gams.json ui.keys. No native accelerator or Host
    // key listener may override a Project's activeView.save/saveAs bindings.

    // Keep native resource handles alive for the lifetime of the Host UI.
    return {
        menu, file, save,
        async enable() {
            await save.setEnabled(true)
            enabled = true
        },
    }
}
