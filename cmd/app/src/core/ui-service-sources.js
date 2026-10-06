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
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.url !== "string" || !entry.url.trim())
      throw new Error(`gams config ui.services.${id}.url is required`)
    return entry.url
  })
}
