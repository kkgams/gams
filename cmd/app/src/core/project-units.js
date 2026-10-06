import { extractZip, validateZipPath } from "../util/zip.js"

// Direct files and ZIP packages; Git sources remain deferred.
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

export function createProjectUnits(runtime) {
  const pending = new Map()

  async function describe(source) {
    const url = remoteSource(source)
    if (!url) return { path: source, remote: false }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href))
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
    const extension = /\.(wasm|js|css)$/i.exec(url.pathname)?.[1].toLowerCase() || "bin"
    if (/\.zip$/i.test(url.pathname)) {
      const sourceKey = url.href
      const entry = decodeURIComponent(url.hash.slice(1))
      url.hash = ""
      return { path: `${runtime.modulesDir}/${key}/${entry}`, name: key, url: url.href, sourceKey, entry, remote: true }
    }
    return { path: `${runtime.modulesDir}/${key}.${extension}`, name: `${key}.${extension}`, url: url.href, sourceKey: url.href, remote: true }
  }

  async function persist(path, bytes) {
    // Never publish an incomplete file. A failed write leaves only an ignored tmp.
    const temporary = `${path}.${crypto.randomUUID()}.tmp`
    unwrap(await runtime.invoke("fs/fs::write-file", temporary, Array.from(bytes)), "save Unit")
    unwrap(await runtime.invoke("fs/fs::rename", temporary, path), "publish Unit")
  }

  async function persistArchive(unit, bytes) {
    const staging = `${runtime.modulesDir}/${unit.name}.${crypto.randomUUID()}.tmp`
    const directories = new Set()
    async function createDirectory(path) {
      if (directories.has(path)) return
      if (path) {
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
        await createDirectory(parent)
      }
      unwrap(await runtime.invoke("fs/fs::create-dir", path ? `${staging}/${path}` : staging), "create package directory")
      directories.add(path)
    }
    await extractZip(bytes, unit.entry, async (path, data) => {
      if (data === null) {
        await createDirectory(path)
      } else {
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
        await createDirectory(parent)
        unwrap(await runtime.invoke("fs/fs::write-file", `${staging}/${path}`, Array.from(data)), "save package entry")
      }
    })
    // Only a fully extracted directory gets the final name. Failed extraction
    // leaves an ignored staging directory, never a reusable installation.
    unwrap(await runtime.invoke("fs/fs::rename", staging, `${runtime.modulesDir}/${unit.name}`), "publish package")
  }

  async function installed(unit) {
    const entries = unwrap(await runtime.invoke("fs/fs::list", runtime.modulesDir), "list installed Units")
    const type = unit.entry ? "directory" : "regular-file"
    return entries.some(entry => entry.name === unit.name && entry.type === type)
  }

  async function resolve(source, onProgress) {
    const unit = await describe(source)
    if (!unit.remote) return unit.path
    if (!pending.has(unit.sourceKey)) {
      const installation = (async () => {
        if (!await installed(unit)) {
          const bytes = await runtime.download(unit.url, onProgress)
          if (unit.entry) await persistArchive(unit, bytes)
          else await persist(unit.path, bytes)
        }
        if (unit.entry) {
          const stat = unwrap(await runtime.invoke("fs/fs::stat", unit.path), `ZIP entry unavailable: ${unit.entry}`)
          if (stat.type !== "regular-file") throw new Error(`ZIP entry is not a file: ${unit.entry}`)
        }
        return unit.path
      })()
      pending.set(unit.sourceKey, installation)
      installation.catch(() => pending.delete(unit.sourceKey))
    }
    return await pending.get(unit.sourceKey)
  }

  async function bootstrapFilesystem(source, onProgress) {
    const unit = await describe(source)
    if (unit.entry) throw new Error("Filesystem bootstrap requires a local or direct-file source, not ZIP")
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
