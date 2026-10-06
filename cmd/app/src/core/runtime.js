const invokeCommand = globalThis.__TAURI__.core.invoke
let tauriListen = null

async function listenEvent(event, callback) {
  if (tauriListen) return await tauriListen(event, callback)

  if (!globalThis.__TAURI__?.event?.listen) {
    throw new Error(
      "Tauri event API is unavailable; cmd/app requires app.withGlobalTauri = true",
    )
  }

  tauriListen = globalThis.__TAURI__.event.listen
  return await tauriListen(event, callback)
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} must be a non-empty string`)
}

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
}

export class Runtime {
  #callViewListenerReady = null
  #mainPlugins = new Map()
  #projectConfig = null
  #modulesDir = null
  #projectSaveInFlight = null

  constructor() {
    this.#callViewListenerReady = this.#initialize()
  }

  async #initialize() {
    const project = await invokeCommand("runtime_project", {})
    this.setProjectConfig(project.config)
    assertString(project.modulesDir, "runtime modules directory")
    this.#modulesDir = project.modulesDir
    await this.#setupCallViewBridge()
  }

  get ready() {
    return this.#callViewListenerReady
  }

  async #setupCallViewBridge() {
    await listenEvent("gams-runtime-call-view", async (event) => {
      const payload = event.payload
      try {
        if (!payload || typeof payload !== "object")
          throw new Error("call-view payload must be an object")
        assertString(payload.id, "call-view payload id")
        assertString(payload.target, "call-view payload target")
        assertString(payload.args, "call-view payload args")
        const ok = await this.#callView(payload.target, payload.args)
        await invokeCommand("runtime_call_view_response", {
          id: payload.id,
          ok,
          err: null,
        })
      } catch (error) {
        const id =
          payload &&
          typeof payload === "object" &&
          typeof payload.id === "string"
            ? payload.id
            : ""
        if (!id) throw error
        await invokeCommand("runtime_call_view_response", {
          id,
          ok: null,
          err: error instanceof Error ? error.message : String(error),
        })
      }
    })
    await invokeCommand("runtime_call_view_ready", {})
  }

  async invoke(target, ...args) {
    assertString(target, "runtime.invoke target")
    assertArray(args, "runtime.invoke args")
    return await invokeCommand("runtime_invoke", { target, args })
  }

  async addPlugins(paths, reload = false) {
    assertArray(paths, "runtime.addPlugins paths")
    if (typeof reload !== "boolean")
      throw new Error("runtime.addPlugins reload must be a boolean")
    for (const path of paths) assertString(path, "runtime.addPlugins path")
    const handles = await invokeCommand("runtime_add_plugins", {
      paths,
      reload,
    })
    assertArray(handles, "runtime.addPlugins result")
    for (const handle of handles) {
      assertString(handle.handle, "component handle")
      assertString(handle.path, "component path")
      assertArray(handle.imports, "component imports")
      assertArray(handle.exports, "component exports")
    }
    return handles
  }

  async download(url, onProgress = () => {}) {
    assertString(url, "runtime.download URL")
    const progress = new globalThis.__TAURI__.core.Channel()
    progress.onmessage = onProgress
    const bytes = await invokeCommand("runtime_download", { url, onProgress: progress })
    return new Uint8Array(bytes)
  }

  async loadFromBytes(bytes, path) {
    assertString(path, "runtime.loadFromBytes path")
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
    if (!(bytes instanceof Uint8Array))
      throw new Error("runtime.loadFromBytes requires a Uint8Array or ArrayBuffer")
    return await invokeCommand("runtime_load_from_bytes", {
      bytes: Array.from(bytes),
      path,
    })
  }

  async #callView(target, args) {
    assertString(target, "runtime.callView target")
    assertString(args, "runtime.callView args")

    const parsedArgs = JSON.parse(args)
    assertArray(parsedArgs, "runtime.callView args JSON")
    return JSON.stringify(await this.call(target, ...parsedArgs))
  }

  setProjectConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new Error("runtime project config must be an object")
    this.#projectConfig = config
  }

  get config() {
    if (!this.#projectConfig) throw new Error("runtime project config is not loaded")
    return this.#projectConfig
  }

  get projectConfig() {
    return this.config
  }

  get modulesDir() {
    if (!this.#modulesDir) throw new Error("runtime modules directory is not loaded")
    return this.#modulesDir
  }

  async diagnostics() {
    return await invokeCommand("runtime_diagnostics", {})
  }

  async releaseResource(resource) {
    if (!resource || typeof resource !== "object")
      throw new Error("runtime.releaseResource resource must be an object")
    assertString(
      resource.$resource,
      "runtime.releaseResource resource.$resource",
    )
    assertString(resource.id, "runtime.releaseResource resource.id")
    await invokeCommand("runtime_release_resource", { resource })
  }

  async clearCompiledComponentCache() {
    await invokeCommand("runtime_clear_compiled_component_cache", {})
  }

  // Concurrent callers share one save. Hooks present at the start run in
  // registration order; each may update config before it is serialized.
  projectSave(onProgress = () => {}) {
    if (typeof onProgress !== "function") throw new Error("projectSave progress callback must be a function")
    if (this.#projectSaveInFlight) return this.#projectSaveInFlight
    this.#projectSaveInFlight = this.#saveProject(onProgress).catch(error => {
      console.error("[project.save] Save failed", error)
      throw error
    }).finally(() => {
      this.#projectSaveInFlight = null
    })
    return this.#projectSaveInFlight
  }

  async #saveProject(onProgress) {
    await this.ready
    const participants = [...this.#mainPlugins.values()].filter(
      plugin => plugin.methods && Object.hasOwn(plugin.methods, "projectSave"),
    )
    const total = participants.length + 2
    let completed = 0
    const report = async message => {
      console.log(`[project.save] ${message}`)
      await onProgress({ message, progress: completed / total })
    }
    await report(`Saving Project (${participants.length} hooks)`)
    for (const plugin of participants) {
      await report(`Saving ${plugin.id}`)
      const result = await plugin.methods.projectSave()
      if (result && typeof result === "object" && Object.hasOwn(result, "err"))
        throw new Error(`${plugin.id}.projectSave: ${result.err}`)
      completed++
    }

    await report("Writing gams.json")
    const text = `${JSON.stringify(this.config, null, 2)}\n`
    const temporary = `.gams.json.${crypto.randomUUID()}.tmp`
    unwrap(await this.invoke("fs/fs::write-text", temporary, text), "write Project config")
    completed++
    await report("Publishing gams.json")
    unwrap(await this.invoke("fs/fs::rename", temporary, "gams.json"), "publish Project config")
    completed++
    await report("Project saved")
    return { ok: true }
  }

  register(plugin) {
    if (!plugin?.id) throw new Error("main-thread plugin requires id")
    if (plugin.methods && Object.hasOwn(plugin.methods, "projectSave") &&
        typeof plugin.methods.projectSave !== "function")
      throw new Error(`${plugin.id}.projectSave must be a function`)
    this.#mainPlugins.set(plugin.id, plugin)
  }

  async unregister(pluginId) {
    if (!pluginId) throw new Error("main-thread plugin unregister requires id")
    this.#mainPlugins.delete(pluginId)
  }

  async call(target, ...args) {
    const parts = target.split(".")
    if (parts.length < 2) {
      throw Error(`${target} mutst be in form of "plugin.method"`)
    }
    const method = parts.pop()
    const pluginId = parts.join(".")

    console.log("runtime.call", pluginId, method, args)
    const plugin = this.#mainPlugins.get(pluginId)

    if (!plugin) {
      throw new Error(`Unknown main-thread plugin '${pluginId}'`)
    }

    if (typeof plugin.call === "function") {
      return await plugin.call(method, input, this.createMainContext(plugin.id))
    }

    const fn = plugin.methods?.[method]
    if (typeof fn !== "function") {
      throw new Error(
        `Main-thread plugin '${plugin.id}' does not implement method '${method}'`,
      )
    }

    return await fn.apply(null, args)
  }
}

export const runtime = new Runtime()

export function unwrap(result, label = "unknown") {
  if (result && Object.prototype.hasOwnProperty.call(result, "ok"))
    return result.ok
  if (result && Object.prototype.hasOwnProperty.call(result, "err"))
    throw new Error(`${label}: ${result.err}`)
  throw new Error(`${label}: expected WIT result object`)
}
