import { runtime, unwrap } from "/core/runtime.js"
import { createSaveMenu } from "./menu/native.js"

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
    runtime.register({ id: "project", methods: { save: createProjectSaveAction() } })
    return await createSaveMenu(saveMenuItem, () => void runtime.call("project.save"))
}
