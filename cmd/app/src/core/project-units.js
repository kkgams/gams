import { validateZipPath } from "../util/zip.js"

function remoteSource(source) {
  if (typeof source !== "string" || !source) throw new Error("Unit source must be a non-empty string")
  if (!/^https?:/i.test(source)) {
    if (!/^[a-z]:[\\/]/i.test(source) && /^[a-z][a-z0-9+.-]*:/i.test(source)) throw new Error(`Unsupported Unit protocol: ${source}`)
    return null
  }
  const url = new URL(source)
  if (/\.(tgz|tar|gz)$/i.test(url.pathname))
    throw new Error("Unsupported archive type: only ZIP is supported")
  if (/\.zip$/i.test(url.pathname)) {
    if (!url.hash) throw new Error("ZIP sources require an explicit entry selector")
    validateZipPath(decodeURIComponent(url.hash.slice(1)))
  } else if (url.hash) {
    throw new Error("Entry selectors are only supported for ZIP sources")
  }
  if (url.username || url.password) throw new Error("Unit URLs must not contain credentials")
  return url
}

// Project convention: FS is the source whose entry basename is plugin.fs.wasm.
export function selectFilesystemSource(plugins, fallback) {
  if (!Array.isArray(plugins)) throw new Error("Project plugins must be an array")
  const matches = plugins.filter(source => {
    if (typeof source !== "string" || !source.trim()) throw new Error("Unit source must be a non-empty string")
    const url = remoteSource(source)
    const path = url ? (url.hash ? decodeURIComponent(url.hash.slice(1)) : decodeURIComponent(url.pathname)) : source
    return path.split(/[\\/]/).at(-1) === "plugin.fs.wasm"
  })
  if (matches.length > 1) throw new Error("Multiple filesystem sources named plugin.fs.wasm in Project plugins")
  if (matches.length === 0) return fallback
  const source = matches[0]
  const url = remoteSource(source)
  if (url && /\.zip$/i.test(url.pathname)) throw new Error("Filesystem bootstrap requires a local or direct-file source, not ZIP")
  return source
}

// Compatibility boundary for legacy Unit URL strings. Native resolution owns
// installation, caching and concurrent request deduplication for every caller.
function nativeSource(source) {
  const url = remoteSource(source)
  if (!url) return source
  if (!url.hash) return url.href
  const entry = decodeURIComponent(url.hash.slice(1))
  url.hash = ""
  return { url: url.href, entry }
}

export function createProjectUnits(runtime) {
  const listeners = new Set()
  const reported = new Map()
  let unsubscribeResolution = null
  const phases = {
    resolving: "checking",
    "checking-cache": "checking",
    downloading: "downloading",
    extracting: "extracting",
    ready: "ready",
    failed: "checking", // The rejected operation supplies startup's failure state.
  }

  function report(source, phase, details = {}) {
    for (const listener of listeners) listener({ ...details, source, phase })
  }

  function reportSnapshot(snapshot) {
    for (const event of snapshot.resources) {
      const signature = JSON.stringify(event)
      if (reported.get(event.resource) === signature) continue
      reported.set(event.resource, signature)
      const phase = phases[event.phase]
      if (!phase) throw new Error(`Unknown resolution phase: ${event.phase}`)
      const details = { cached: event.cached }
      if (event.unit === "bytes") Object.assign(details, { downloaded: event.completed, total: event.total })
      if (event.unit === "entries") Object.assign(details, { completed: event.completed, total: event.total })
      if (event.entry !== undefined) details.entry = event.entry
      if (event.error !== undefined) details.error = event.error
      report(event.resource, phase, details)
    }
  }

  function subscribeProgress(listener) {
    if (typeof listener !== "function") throw new Error("Progress listener must be a function")
    listeners.add(listener)
    if (!unsubscribeResolution) {
      reported.clear()
      unsubscribeResolution = runtime.subscribeResolutionProgress(reportSnapshot)
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size && unsubscribeResolution) {
        unsubscribeResolution()
        unsubscribeResolution = null
      }
    }
  }

  function byteProgress(onProgress) {
    let previous = null
    return snapshot => {
      const event = snapshot.resources.find(event => event.phase === "downloading" && event.unit === "bytes")
      if (!event) return
      const progress = { downloaded: event.completed, total: event.total }
      const signature = JSON.stringify(progress)
      if (signature === previous) return
      previous = signature
      onProgress(progress)
    }
  }

  async function resolve(source, onProgress = () => {}) {
    const selected = nativeSource(source)
    return await runtime.resolveFile(selected, byteProgress(onProgress))
  }

  async function bootstrapFilesystem(source, onProgress = () => {}) {
    const selected = nativeSource(source)
    if (typeof selected !== "string") throw new Error("Filesystem bootstrap requires a local or direct-file source, not ZIP")
    let cached = false
    let resource = selected
    const reportBytes = byteProgress(onProgress)
    const path = await runtime.resolveFile(selected, snapshot => {
      const event = snapshot.resources.find(event => event.phase === "ready")
      if (event) {
        cached = event.cached
        resource = event.resource
      }
      reportBytes(snapshot)
    })
    report(resource, "loading")
    await runtime.addPlugins([path])
    report(resource, "ready", { cached })
    return path
  }

  return { resolve, bootstrapFilesystem, subscribeProgress }
}
