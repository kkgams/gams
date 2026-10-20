(() => {
  const originalError = console.error.bind(console)

  function format(value) {
    if (value instanceof Error) return value.stack || value.message
    if (typeof value === "string") return value
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      // Circular objects and BigInt are valid console arguments, but not JSON.
      return String(value)
    }
  }

  function forward(level, args) {
    globalThis.__TAURI__.core.invoke("runtime_console", {
      level,
      message: args.map(format).join(" "),
    }).catch(error => originalError("Console forwarding failed", error))
  }

  for (const level of ["log", "info", "debug", "warn", "error"]) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      original(...args)
      forward(level, args)
    }
  }

  addEventListener("error", event => {
    forward("error", [event.error ?? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`])
  })
  addEventListener("unhandledrejection", event => {
    forward("error", ["Unhandled promise rejection:", event.reason])
  })
})()
