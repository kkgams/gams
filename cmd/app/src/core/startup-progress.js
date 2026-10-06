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
        case "checking":
            return { text: "Checking cache", value: null, max: 1 }
        case "downloading": {
            const downloaded = byteLabel(event.downloaded)
            const known = event.total !== null && event.total > 0
            const text = known ? `Downloading ${downloaded} / ${byteLabel(event.total)}` : `Downloading ${downloaded}`
            return { text, value: known ? Math.min(1, event.downloaded / event.total) : null, max: 1 }
        }
        case "extracting":
            return {
                text: `Extracting ${event.completed}/${event.total} · ${event.entry}`,
                value: event.total > 0 ? Math.min(1, event.completed / event.total) : null,
                max: 1,
            }
        case "saving":
            return { text: "Saving installation", value: null, max: 1 }
        case "loading":
            return { text: "Loading component", value: null, max: 1 }
        case "ready":
            return { text: event.cached ? "Ready · cached" : "Ready", value: 1, max: 1 }
        default:
            throw new Error(`Unknown startup progress phase: ${event.phase}`)
    }
}

function setProgress(element, value, max) {
    element.max = max
    if (value === null) element.removeAttribute("value")
    else element.value = value
}

// Host-owned startup envelope, with the guide's card/form/progress vocabulary.
// Light DOM uses base fallbacks first and adopts the configured Project theme
// automatically. It does not depend on UI Services that are still being loaded.
export function createStartupProgress(document, reload) {
    const host = document.createElement("div")
    host.id = "gams-startup"
    host.setAttribute("role", "region")
    host.setAttribute("aria-labelledby", "startup-title")
    host.innerHTML = `<article><blockquote>
      <header id="startup-title">GAMS — Opening Project</header>
      <output id="phase" role="status" aria-live="polite">Reading Project configuration</output>
      <progress id="overall" class="info" max="1" value="0" aria-label="Project startup stages"></progress>
      <form data-element="unit-queue" aria-label="Project Unit preparation"></form>
      <footer>
        <output id="count">0 Units prepared</output>
        <output id="error" class="danger" role="alert" hidden></output>
        <button type="button" class="accent" hidden>Reload Project</button>
      </footer>
    </blockquote></article>`
    document.body.appendChild(host)
    const phase = host.querySelector("#phase")
    const overall = host.querySelector("#overall")
    const count = host.querySelector("#count")
    const list = host.querySelector("form")
    const rows = new Map()
    host.querySelector("button").addEventListener("click", reload)
    let failed = false

    return {
        phase(message, completedStages) {
            phase.textContent = message
            overall.value = completedStages / 4
        },
        update(event) {
            if (failed) return // Keep the failure snapshot even if other work settles later.
            let row = rows.get(event.source)
            if (!row) {
                const element = document.createElement("fieldset")
                element.innerHTML =
                    '<legend></legend><output></output><progress class="info" max="1" aria-label="Unit preparation"></progress>'
                const label = sourceLabel(event.source)
                element.querySelector("legend").textContent = label
                element.querySelector("progress").setAttribute("aria-label", `Preparing ${label}`)
                list.appendChild(element)
                row = { element, ready: false }
                rows.set(event.source, row)
            }
            const progress = unitProgress(event)
            const detail = row.element.querySelector("output")
            detail.textContent = progress.text
            const bar = row.element.querySelector("progress")
            setProgress(bar, progress.value, progress.max)
            row.ready = event.phase === "ready"
            bar.hidden = row.ready
            detail.classList.toggle("success", row.ready)
            const prepared = Array.from(rows.values()).filter((row) => row.ready).length
            count.textContent = `${prepared} ${prepared === 1 ? "Unit" : "Units"} prepared · ${rows.size - prepared} active`
        },
        fail(error) {
            failed = true
            phase.textContent = "Project could not be opened"
            phase.classList.add("danger")
            for (const row of rows.values()) {
                row.element.querySelector("progress").hidden = true
                if (!row.ready) {
                    const detail = row.element.querySelector("output")
                    detail.textContent = `Interrupted · ${detail.textContent}`
                    detail.classList.add("warning")
                }
            }
            const prepared = Array.from(rows.values()).filter((row) => row.ready).length
            count.textContent = `${prepared} ${prepared === 1 ? "Unit" : "Units"} prepared · ${rows.size - prepared} interrupted`
            overall.hidden = true
            const message = host.querySelector("#error")
            message.textContent = error instanceof Error ? error.message : String(error)
            message.hidden = false
            host.querySelector("button").hidden = false
        },
        finish() {
            host.remove()
        },
    }
}
