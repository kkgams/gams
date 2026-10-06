function sourceLabel(source) {
  if (!/^https?:/i.test(source)) return source
  const url = new URL(source)
  const file = url.pathname.slice(url.pathname.lastIndexOf("/") + 1)
  return url.hash ? `${file} → ${decodeURIComponent(url.hash.slice(1))}` : file
}

function byteLabel(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function unitProgress(event) {
  switch (event.phase) {
    case "checking": return { text: "Checking cache", value: null, max: 1 }
    case "downloading": {
      const downloaded = byteLabel(event.downloaded)
      const known = event.total !== null && event.total > 0
      const text = known ? `Downloading ${downloaded} / ${byteLabel(event.total)}` : `Downloading ${downloaded}`
      return { text, value: known ? event.downloaded : null, max: known ? event.total : 1 }
    }
    case "extracting": return {
      text: `Extracting ${event.completed}/${event.total} · ${event.entry}`,
      value: event.completed, max: event.total,
    }
    case "saving": return { text: "Saving installation", value: null, max: 1 }
    case "loading": return { text: "Loading component", value: null, max: 1 }
    case "ready": return { text: event.cached ? "Ready · cached" : "Ready", value: 1, max: 1 }
    default: throw new Error(`Unknown startup progress phase: ${event.phase}`)
  }
}

function setProgress(element, value, max) {
  element.max = max
  if (value === null) element.removeAttribute("value")
  else element.value = value
}

// Host-owned and isolated from Project themes/services: it must work before any
// Unit is available, and remain visible if Project startup fails.
export function createStartupProgress(document, reload) {
  const host = document.createElement("div")
  host.id = "gams-startup"
  const root = host.attachShadow({ mode: "open" })
  root.innerHTML = `<link rel="stylesheet" href="/css/startup.css">
    <section aria-labelledby="startup-title">
      <header><p class="brand">GAMS</p><h1 id="startup-title">Opening Project</h1></header>
      <p id="phase" role="status" aria-live="polite">Reading Project configuration</p>
      <progress id="overall" max="4" value="0" aria-label="Project startup stages"></progress>
      <p id="count">0 Units prepared</p>
      <ul aria-label="Project Unit preparation"></ul>
      <p id="error" role="alert" hidden></p>
      <button type="button" hidden>Reload Project</button>
    </section>`
  document.body.appendChild(host)
  const phase = root.querySelector("#phase")
  const overall = root.querySelector("#overall")
  const count = root.querySelector("#count")
  const list = root.querySelector("ul")
  const rows = new Map()
  root.querySelector("button").addEventListener("click", reload)

  return {
    phase(message, completedStages) {
      phase.textContent = message
      overall.value = completedStages
    },
    update(event) {
      let row = rows.get(event.source)
      if (!row) {
        const element = document.createElement("li")
        element.innerHTML = '<p class="source"></p><p class="detail"></p><progress aria-label="Unit preparation"></progress>'
        const label = sourceLabel(event.source)
        element.querySelector(".source").textContent = label
        element.querySelector("progress").setAttribute("aria-label", `Preparing ${label}`)
        list.appendChild(element)
        row = { element, ready: false }
        rows.set(event.source, row)
      }
      const progress = unitProgress(event)
      row.element.querySelector(".detail").textContent = progress.text
      setProgress(row.element.querySelector("progress"), progress.value, progress.max)
      row.ready = event.phase === "ready"
      row.element.classList.toggle("ready", row.ready)
      const prepared = Array.from(rows.values()).filter(row => row.ready).length
      count.textContent = `${prepared} ${prepared === 1 ? "Unit" : "Units"} prepared`
    },
    fail(error) {
      host.setAttribute("data-failed", "")
      phase.textContent = "Project could not be opened"
      overall.hidden = true
      const message = root.querySelector("#error")
      message.textContent = error instanceof Error ? error.message : String(error)
      message.hidden = false
      root.querySelector("button").hidden = false
    },
    finish() { host.remove() },
  }
}
