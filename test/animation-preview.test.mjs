import test from "node:test"
import assert from "node:assert/strict"
import { setTimeout as nativeSetTimeout, clearTimeout as nativeClearTimeout } from "node:timers"
import { MessageChannel as NativeMessageChannel } from "node:worker_threads"

// Minimal DOM boundary: exercise the real widget API without a browser/canvas.
globalThis.HTMLElement = class extends EventTarget {
    isConnected = false
}
globalThis.HTMLCanvasElement = class {}
globalThis.CustomEvent = class extends Event {
    constructor(type, options) {
        super(type, options)
        this.detail = options?.detail
    }
}
globalThis.customElements = { get() {}, define() {} }
const { WidgetAnimationPreview } = await import("../cmd/app/src/widgets/animation-preview.js")

function clock() {
    const timers = new Map()
    let id = 0
    const channels = []
    globalThis.MessageChannel = class {
        constructor() {
            this.port1 = { onmessage: null, closed: false, close() { this.closed = true } }
            this.port2 = {
                closed: false,
                close() { this.closed = true },
                postMessage: () => {
                    timers.set(++id, { callback: () => this.port1.onmessage({ data: null }), delay: 0 })
                },
            }
            channels.push(this)
        }
    }
    globalThis.window = {
        setTimeout(callback, delay) {
            timers.set(++id, { callback, delay })
            return id
        },
        clearTimeout(id) { timers.delete(id) },
    }
    return {
        timers,
        channels,
        assertClosed() {
            for (const channel of channels) {
                assert.equal(channel.port1.closed, true)
                assert.equal(channel.port2.closed, true)
            }
        },
        async tick(delay = 0) {
            const entry = [...timers].find(([, timer]) => timer.delay === delay)
            assert.ok(entry, `expected a timer with delay ${delay}`)
            timers.delete(entry[0])
            entry[1].callback()
            await Promise.resolve()
        },
        async finish(promise) {
            let done = false
            promise.finally(() => { done = true }).catch(() => {})
            while (!done) {
                await new Promise((resolve) => setImmediate(resolve))
                if (!done) await this.tick()
            }
            return promise
        },
    }
}

function clip(channel = 1, width = 1, frames = 1) {
    return {
        width, height: 1, direction: "forward", repeat: 0,
        frames: Array.from({ length: frames }, () => ({
            durationMs: 20,
            pixels: { width, height: 1, data: Array(width * 4).fill(channel) },
        })),
    }
}

test("async ingestion yields macrotasks in bounded chunks and publishes once", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    const old = clip(1)
    widget.clip = old
    let changes = 0
    widget.addEventListener("framechange", () => changes++)
    const next = clip(2, 32769)
    let reads = 0
    const data = next.frames[0].pixels.data
    next.frames[0].pixels.data = new Proxy(data, {
        get(target, key) {
            if (/^\d+$/.test(String(key))) reads++
            return Reflect.get(target, key)
        },
    })
    const pending = widget.setClipAsync(next)
    await Promise.resolve()
    assert.ok(reads > 0 && reads <= 65536, `first chunk read ${reads} channels`)
    assert.deepEqual(widget.clip, old)
    assert.equal(changes, 0)
    await time.tick()
    assert.ok(reads <= 131072)
    assert.deepEqual(widget.clip, old)
    assert.equal(await time.finish(pending), true)
    assert.equal(widget.clip.frames[0].pixels.data.at(-1), 2)
    assert.equal(changes, 1)
    assert.equal(time.channels.length, 1)
    time.assertClosed()
})

test("real MessageChannel tasks yield without a whole-clip clone", async (t) => {
    globalThis.window = { setTimeout: nativeSetTimeout, clearTimeout: nativeClearTimeout }
    const channels = []
    globalThis.MessageChannel = class extends NativeMessageChannel {
        constructor() {
            super()
            channels.push(this)
        }
    }
    t.after(() => {
        for (const channel of channels) {
            channel.port1.close()
            channel.port2.close()
        }
    })
    const widget = new WidgetAnimationPreview()
    widget.clip = clip(1)
    const clone = globalThis.structuredClone
    let guard
    try {
        globalThis.structuredClone = () => { throw new Error("whole-clip clone during async ingestion") }
        const pending = widget.setClipAsync(clip(2, 32769))
        let committed = false
        pending.then(() => { committed = true })
        await Promise.resolve()
        assert.equal(committed, false, "ingestion must yield a task, not only microtasks")
        const timeout = new Promise((_, reject) => {
            guard = nativeSetTimeout(() => reject(new Error("MessageChannel ingestion timed out")), 2000)
        })
        assert.equal(await Promise.race([pending, timeout]), true)
        assert.equal(channels.length, 1)
    } finally {
        nativeClearTimeout(guard)
        globalThis.structuredClone = clone
    }
    assert.equal(widget.clip.frames[0].pixels.data[0], 2)
})

test("sync replacements, including null and invalid assignments, invalidate pending ingestion", async () => {
    for (const replacement of [clip(3), null, { invalid: true }]) {
        const time = clock()
        const widget = new WidgetAnimationPreview()
        widget.clip = clip(1)
        const pending = widget.setClipAsync(clip(2, 32769))
        if (replacement?.invalid) {
            assert.throws(() => { widget.clip = replacement }, /must contain only/)
        } else {
            widget.clip = replacement
        }
        assert.equal(await time.finish(pending), false)
        assert.deepEqual(widget.clip, replacement?.invalid ? clip(1) : replacement)
        time.assertClosed()
    }
})

test("new async requests win over older requests, even when the newer request is invalid", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    const old = widget.setClipAsync(clip(1, 32769))
    const latest = widget.setClipAsync(clip(2, 16385))
    assert.equal(await time.finish(old), false)
    assert.equal(await time.finish(latest), true)
    assert.equal(widget.clip.frames[0].pixels.data[0], 2)
    const pending = widget.setClipAsync(clip(3, 32769))
    await assert.rejects(widget.setClipAsync({}), /must contain only/)
    assert.equal(await time.finish(pending), false)
    assert.equal(widget.clip.frames[0].pixels.data[0], 2)
    time.assertClosed()
})

test("caller cancellation retains the previous clip and checks again before commit", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    widget.clip = clip(1)
    let active = true
    const pending = widget.setClipAsync(clip(2, 32769), () => active)
    active = false
    assert.equal(await time.finish(pending), false)
    assert.deepEqual(widget.clip, clip(1))
    let checks = 0
    assert.equal(await widget.setClipAsync(clip(3), () => ++checks === 1), false)
    assert.deepEqual(widget.clip, clip(1))
    await assert.rejects(widget.setClipAsync(clip(3), true), /isCurrent must be a function/)
    time.assertClosed()
})

test("small clips never allocate a channel and predicate errors close yielded channels", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    assert.equal(await widget.setClipAsync(clip(1)), true)
    assert.equal(await widget.setClipAsync(null), true)
    await assert.rejects(widget.setClipAsync({}), /must contain only/)
    assert.equal(time.channels.length, 0)
    widget.clip = clip(1)
    let checks = 0
    const pending = widget.setClipAsync(clip(2, 32769), () => {
        if (++checks > 1) throw new Error("predicate failed")
        return true
    })
    const rejected = assert.rejects(pending, /predicate failed/)
    await time.finish(rejected)
    assert.deepEqual(widget.clip, clip(1))
    assert.equal(time.channels.length, 1)
    time.assertClosed()
})

test("predicate reentrancy cannot overwrite a synchronous replacement", async () => {
    clock()
    const widget = new WidgetAnimationPreview()
    assert.equal(await widget.setClipAsync(clip(2), () => {
        widget.clip = clip(3)
        return true
    }), false)
    assert.deepEqual(widget.clip, clip(3))
})

test("invalid pixels reject without publishing partially prepared frames", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    widget.clip = clip(1)
    let changes = 0
    widget.addEventListener("framechange", () => changes++)
    const invalid = clip(2, 16385, 2)
    invalid.frames[1].pixels.data[65539] = 256
    const pending = widget.setClipAsync(invalid)
    const rejected = assert.rejects(pending, /frames\[1\]\.pixels\.data\[65539\] must be an unsigned byte/)
    await time.finish(rejected)
    assert.deepEqual(widget.clip, clip(1))
    assert.equal(changes, 0)
    time.assertClosed()
})

test("both ingestion APIs enforce the same exact schema and plain RGBA arrays", async () => {
    clock()
    const invalids = [
        { ...clip(), extra: true },
        { ...clip(), direction: "unknown" },
        { ...clip(), repeat: -1 },
        { ...clip(), width: 0 },
        { ...clip(), frames: [] },
    ]
    for (const mutate of [
        (c) => { c.frames[0].extra = true },
        (c) => { c.frames[0].durationMs = Infinity },
        (c) => { c.frames[0].pixels.width = 2 },
        (c) => { c.frames[0].pixels.extra = true },
        (c) => { c.frames[0].pixels.data = new Uint8Array(4) },
        (c) => { c.frames[0].pixels.data.pop() },
        (c) => { c.frames[0].pixels.data[0] = 1.5 },
        (c) => { delete c.frames[0].pixels.data[0] },
    ]) {
        const value = clip()
        mutate(value)
        invalids.push(value)
    }
    for (const invalid of invalids) {
        const widget = new WidgetAnimationPreview()
        assert.throws(() => { widget.clip = invalid })
        await assert.rejects(widget.setClipAsync(invalid))
        assert.equal(widget.clip, null)
    }
})

test("async ingestion adopts independent arrays; getter and synchronous setter remain copies", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    const input = clip(2, 16385)
    assert.equal(await time.finish(widget.setClipAsync(input)), true)
    input.frames[0].pixels.data[0] = 99
    input.frames[0].durationMs = 99
    const output = widget.clip
    assert.equal(output.frames[0].pixels.data[0], 2)
    assert.equal(output.frames[0].durationMs, 20)
    output.frames[0].pixels.data[0] = 88
    assert.equal(widget.clip.frames[0].pixels.data[0], 2)
    const sync = clip(3)
    widget.clip = sync
    sync.frames[0].pixels.data[0] = 77
    assert.deepEqual(widget.clip, clip(3))
    assert.equal(await widget.setClipAsync(null), true)
    assert.equal(widget.clip, null)
})

test("old playback continues while preparing and disconnect alone does not cancel ingestion", async () => {
    const time = clock()
    const widget = new WidgetAnimationPreview()
    widget.isConnected = true
    widget.clip = clip(1, 1, 2)
    widget.playing = true
    const pending = widget.setClipAsync(clip(2, 32769))
    await time.tick(20)
    assert.equal(widget.frameIndex, 1)
    assert.equal(widget.playing, true)
    assert.equal(widget.clip.frames[0].pixels.data[0], 1)
    widget.isConnected = false
    widget.disconnectedCallback()
    assert.equal(await time.finish(pending), true)
    assert.equal(widget.clip.frames[0].pixels.data[0], 2)
    assert.equal(widget.playing, true)
    assert.equal(widget.frameIndex, 0)
    assert.equal(time.timers.size, 0)
})
