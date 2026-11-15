export async function createSaveMenu(item, requestSave) {
    const { Menu, MenuItem, Submenu } = globalThis.__TAURI__.menu
    let enabled = false
    const saveWhenEnabled = () => {
        if (enabled) requestSave()
    }

    const save = await MenuItem.new({
        ...item,
        enabled: false,
        action: saveWhenEnabled,
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
