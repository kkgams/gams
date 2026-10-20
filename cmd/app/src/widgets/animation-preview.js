const DIRECTIONS = new Set(["forward", "reverse", "ping-pong", "ping-pong-reverse"])

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function requireObject(value, label) {
    assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`)
    return value
}

function requireExactKeys(value, keys, label) {
    const actual = Object.keys(value)
    assert(
        actual.length === keys.length && keys.every((key) => actual.includes(key)),
        `${label} must contain only ${keys.join(", ")}`,
    )
}

function validatePixelsHeader(pixels, width, height, label) {
    requireObject(pixels, label)
    requireExactKeys(pixels, ["width", "height", "data"], label)
    assert(Number.isInteger(pixels.width) && pixels.width === width, `${label}.width must match clip width`)
    assert(Number.isInteger(pixels.height) && pixels.height === height, `${label}.height must match clip height`)
    assert(Array.isArray(pixels.data), `${label}.data must be an array`)
    assert(pixels.data.length === width * height * 4, `${label}.data length must match RGBA dimensions`)
}

function validateChannel(channel, index, label) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        throw new Error(`${label}.data[${index}] must be an unsigned byte`)
    }
}

function validateClipHeader(clip) {
    requireObject(clip, "widget-animation-preview clip")
    requireExactKeys(clip, ["width", "height", "direction", "repeat", "frames"], "widget-animation-preview clip")
    assert(
        Number.isInteger(clip.width) && clip.width > 0,
        "widget-animation-preview clip.width must be a positive integer",
    )
    assert(
        Number.isInteger(clip.height) && clip.height > 0,
        "widget-animation-preview clip.height must be a positive integer",
    )
    assert(DIRECTIONS.has(clip.direction), `widget-animation-preview clip.direction ${clip.direction} is not supported`)
    assert(
        Number.isInteger(clip.repeat) && clip.repeat >= 0,
        "widget-animation-preview clip.repeat must be a non-negative integer",
    )
    assert(
        Array.isArray(clip.frames) && clip.frames.length > 0,
        "widget-animation-preview clip.frames must be a non-empty array",
    )
}

function validateFrame(frame, width, height, index) {
    const label = `widget-animation-preview clip.frames[${index}]`
    requireObject(frame, label)
    requireExactKeys(frame, ["durationMs", "pixels"], label)
    assert(
        Number.isFinite(frame.durationMs) && frame.durationMs > 0,
        `${label}.durationMs must be positive and finite`,
    )
    validatePixelsHeader(frame.pixels, width, height, `${label}.pixels`)
    return `${label}.pixels`
}

function validateClip(clip) {
    validateClipHeader(clip)
    for (let index = 0; index < clip.frames.length; index++) {
        const frame = clip.frames[index]
        const label = validateFrame(frame, clip.width, clip.height, index)
        for (let channel = 0; channel < frame.pixels.data.length; channel++) {
            validateChannel(frame.pixels.data[channel], channel, label)
        }
    }
}

function playbackOrder(frameCount, direction) {
    const forward = Array.from({ length: frameCount }, (_, index) => index)
    if (direction === "forward") return forward
    if (direction === "reverse") return [...forward].reverse()
    if (direction === "ping-pong") return forward.concat(forward.slice(1, -1).reverse())
    if (direction === "ping-pong-reverse") return [...forward].reverse().concat(forward.slice(1, -1))
    throw new Error(`widget-animation-preview direction ${direction} is not supported`)
}

export class WidgetAnimationPreview extends HTMLElement {
    constructor() {
        super()
        this.canvasElement = null
        this._clip = null
        this._clipRequest = 0
        this._playing = false
        this._playbackRate = 1
        this._frameIndex = 0
        this._order = []
        this._orderIndex = 0
        this._completedCycles = 0
        this._timer = 0
    }

    connectedCallback() {
        if (!this.dataset.ready) {
            this.dataset.ready = "1"
            this.innerHTML = '<canvas data-element="animation-preview" aria-label="Animation preview"></canvas>'
            this.canvasElement = this.querySelector('[data-element="animation-preview"]')
            assert(this.canvasElement instanceof HTMLCanvasElement, "widget-animation-preview canvas is required")
        }
        this.renderFrame()
        if (this._playing) this.scheduleNextFrame()
    }

    disconnectedCallback() {
        this.clearTimer()
    }

    get clip() {
        return this._clip === null ? null : structuredClone(this._clip)
    }

    set clip(value) {
        ++this._clipRequest
        this.clearTimer()
        if (value !== null) validateClip(value)
        this.commitClip(value === null ? null : structuredClone(value))
    }

    async setClipAsync(value, isCurrent = () => true) {
        const request = ++this._clipRequest
        assert(typeof isCurrent === "function", "widget-animation-preview isCurrent must be a function")
        // Check again after the caller predicate: it may synchronously replace the clip.
        const current = () => request === this._clipRequest && isCurrent() && request === this._clipRequest
        if (!current()) return false
        if (value === null) {
            this.commitClip(null)
            return true
        }
        validateClipHeader(value)
        const prepared = {
            width: value.width, height: value.height,
            direction: value.direction, repeat: value.repeat, frames: [],
        }
        const frameCount = value.frames.length
        let channel = null
        const yieldTask = () => new Promise((resolve) => {
            if (channel === null) channel = new MessageChannel()
            channel.port1.onmessage = resolve
            channel.port2.postMessage(null)
        })
        try {
            let remaining = 65536
            for (let index = 0; index < frameCount; index++) {
                const frame = value.frames[index]
                const label = validateFrame(frame, prepared.width, prepared.height, index)
                const source = frame.pixels.data
                const data = new Array(prepared.width * prepared.height * 4)
                prepared.frames.push({
                    durationMs: frame.durationMs,
                    pixels: { width: prepared.width, height: prepared.height, data },
                })
                for (let offset = 0; offset < data.length;) {
                    const end = Math.min(offset + remaining, data.length)
                    for (; offset < end; offset++) {
                        const channel = source[offset]
                        validateChannel(channel, offset, label)
                        data[offset] = channel
                        remaining--
                    }
                    if (remaining === 0) {
                        await yieldTask()
                        if (!current()) return false
                        remaining = 65536
                    }
                }
            }
            if (!current()) return false
            this.commitClip(prepared)
            return true
        } finally {
            if (channel !== null) {
                channel.port1.close()
                channel.port2.close()
            }
        }
    }

    commitClip(clip) {
        this.clearTimer()
        this._clip = clip
        if (clip === null) {
            this._playing = false
            this._frameIndex = 0
            this._order = []
            this._orderIndex = 0
            this._completedCycles = 0
            this.renderFrame()
            return
        }
        this._order = playbackOrder(clip.frames.length, clip.direction)
        this._orderIndex = 0
        this._frameIndex = this._order[0]
        this._completedCycles = 0
        this.renderFrame()
        this.publishFrameChange()
        if (this._playing && this.isConnected) this.scheduleNextFrame()
    }

    get playing() {
        return this._playing
    }

    set playing(value) {
        assert(typeof value === "boolean", "widget-animation-preview playing must be a boolean")
        if (value) assert(this._clip, "widget-animation-preview requires a clip before playback")
        if (this._playing === value) return
        this._playing = value
        this.clearTimer()
        if (this._playing && this.isConnected) this.scheduleNextFrame()
    }

    get playbackRate() {
        return this._playbackRate
    }

    set playbackRate(value) {
        assert(Number.isFinite(value) && value > 0, "widget-animation-preview playbackRate must be positive and finite")
        this._playbackRate = value
        if (this._playing && this.isConnected) {
            this.clearTimer()
            this.scheduleNextFrame()
        }
    }

    get frameIndex() {
        return this._frameIndex
    }

    set frameIndex(value) {
        assert(this._clip, "widget-animation-preview requires a clip before seeking")
        assert(
            Number.isInteger(value) && value >= 0 && value < this._clip.frames.length,
            "widget-animation-preview frameIndex is out of range",
        )
        this._frameIndex = value
        this._orderIndex = this._order.indexOf(value)
        assert(this._orderIndex >= 0, `widget-animation-preview playback order is missing frame ${value}`)
        this._completedCycles = 0
        this.renderFrame()
        this.publishFrameChange()
        if (this._playing && this.isConnected) {
            this.clearTimer()
            this.scheduleNextFrame()
        }
    }

    clearTimer() {
        if (!this._timer) return
        window.clearTimeout(this._timer)
        this._timer = 0
    }

    scheduleNextFrame() {
        assert(this._clip, "widget-animation-preview playback requires a clip")
        assert(this._timer === 0, "widget-animation-preview playback timer must not already be scheduled")
        const frame = this._clip.frames[this._frameIndex]
        assert(frame, `widget-animation-preview frame ${this._frameIndex} is required`)
        const delay = Math.max(16, frame.durationMs / this._playbackRate)
        this._timer = window.setTimeout(() => {
            this._timer = 0
            this.advanceFrame()
        }, delay)
    }

    advanceFrame() {
        assert(this._clip && this._playing, "widget-animation-preview can only advance during playback")
        const nextOrderIndex = this._orderIndex + 1
        if (nextOrderIndex >= this._order.length) {
            this._completedCycles += 1
            if (this._clip.repeat > 0 && this._completedCycles >= this._clip.repeat) {
                this._playing = false
                this.dispatchEvent(new CustomEvent("ended", { bubbles: true }))
                return
            }
            this._orderIndex = 0
        } else {
            this._orderIndex = nextOrderIndex
        }
        this._frameIndex = this._order[this._orderIndex]
        this.renderFrame()
        this.publishFrameChange()
        this.scheduleNextFrame()
    }

    renderFrame() {
        if (!(this.canvasElement instanceof HTMLCanvasElement)) return
        if (this._clip === null) {
            this.canvasElement.width = 1
            this.canvasElement.height = 1
            const context = this.canvasElement.getContext("2d")
            assert(context, "widget-animation-preview canvas requires a 2d context")
            context.clearRect(0, 0, 1, 1)
            return
        }
        const frame = this._clip.frames[this._frameIndex]
        assert(frame, `widget-animation-preview frame ${this._frameIndex} is required`)
        this.canvasElement.width = this._clip.width
        this.canvasElement.height = this._clip.height
        const context = this.canvasElement.getContext("2d")
        assert(context, "widget-animation-preview canvas requires a 2d context")
        context.imageSmoothingEnabled = false
        const data = new Uint8ClampedArray(frame.pixels.data)
        context.putImageData(new ImageData(data, this._clip.width, this._clip.height), 0, 0)
    }

    publishFrameChange() {
        this.dispatchEvent(
            new CustomEvent("framechange", {
                bubbles: true,
                detail: { frameIndex: this._frameIndex },
            }),
        )
    }
}

if (!customElements.get("widget-animation-preview")) {
    customElements.define("widget-animation-preview", WidgetAnimationPreview)
}
