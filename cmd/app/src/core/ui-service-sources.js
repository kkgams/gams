import { validateLocalPath } from "./local-path.js"

// These roles are required by the Host shell; their sources belong to the Project.
export const BOOTSTRAP_UI_SERVICE_IDS = Object.freeze([
  "ui-context", "ui-keys", "ui-layout", "ui-toast", "ui-popup", "ui-tooltip",
])

export function getUiServiceSources(config) {
  if (!config.ui || typeof config.ui !== "object" || Array.isArray(config.ui))
    throw new Error("gams config ui must be an object")
  const services = config.ui.services
  if (!services || typeof services !== "object" || Array.isArray(services))
    throw new Error("gams config ui.services must be an object")
  return BOOTSTRAP_UI_SERVICE_IDS.map(id => {
    const entry = services[id]
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`gams config ui.services.${id}.url is required; use $file to prepare resource URLs`)
    return validateLocalPath(entry.url, `gams config ui.services.${id}.url`)
  })
}
