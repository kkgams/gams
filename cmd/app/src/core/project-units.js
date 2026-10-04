// Direct-file installation only. Archive/Git sources are deliberately deferred.
function unwrap(result, operation) {
  if (result && Object.hasOwn(result, "ok")) return result.ok
  throw new Error(`${operation}: ${result?.err ?? "invalid filesystem response"}`)
}

function remoteSource(source) {
  if (typeof source !== "string" || !source) throw new Error("Unit source must be a non-empty string")
  if (!/^https?:/i.test(source)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(source)) throw new Error(`Unsupported Unit protocol: ${source}`)
    return null
  }
  const url = new URL(source)
  if (url.hash || /\.(zip|tgz|tar|gz)$/i.test(url.pathname))
    throw new Error("Archive sources are not supported yet")
  if (url.username || url.password) throw new Error("Unit URLs must not contain credentials")
  return url
}

export function createProjectUnits(runtime) {
  const pending = new Map()

  async function describe(source) {
    const url = remoteSource(source)
    if (!url) return { path: source, remote: false }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href))
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
    const extension = /\.(wasm|js|css)$/i.exec(url.pathname)?.[1].toLowerCase() || "bin"
    return { path: `${runtime.modulesDir}/${key}.${extension}`, name: `${key}.${extension}`, url: url.href, remote: true }
  }

  async function persist(path, bytes) {
    // Never publish an incomplete file. A failed write leaves only an ignored tmp.
    const temporary = `${path}.${crypto.randomUUID()}.tmp`
    unwrap(await runtime.invoke("fs/fs::write-file", temporary, Array.from(bytes)), "save Unit")
    unwrap(await runtime.invoke("fs/fs::rename", temporary, path), "publish Unit")
  }

  async function installed(name) {
    const entries = unwrap(await runtime.invoke("fs/fs::list", runtime.modulesDir), "list installed Units")
    return entries.some(entry => entry.name === name && entry.type === "regular-file")
  }

  async function resolve(source, onProgress) {
    const unit = await describe(source)
    if (!unit.remote) return unit.path
    if (!pending.has(unit.url)) {
      const installation = (async () => {
        if (!await installed(unit.name)) {
          const bytes = await runtime.download(unit.url, onProgress)
          await persist(unit.path, bytes)
        }
        return unit.path
      })()
      pending.set(unit.url, installation)
      installation.catch(() => pending.delete(unit.url))
    }
    return await pending.get(unit.url)
  }

  async function bootstrapFilesystem(source, onProgress) {
    const unit = await describe(source)
    if (!unit.remote) {
      await runtime.addPlugins([unit.path])
      return unit.path
    }
    try {
      await runtime.addPlugins([unit.path])
      return unit.path
    } catch (error) {
      // Existing API returns string errors. Only a missing source is a cache miss.
      if (!String(error).includes("absolute component path not found:")) throw error
    }
    const bytes = await runtime.download(unit.url, onProgress)
    await runtime.loadFromBytes(bytes, unit.path)
    await persist(unit.path, bytes)
    return unit.path
  }

  return { resolve, bootstrapFilesystem }
}
