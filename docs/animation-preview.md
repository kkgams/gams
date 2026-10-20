---
title: "Animation preview widget"
status: reference
---

# Animation preview widget

Import `/widgets/animation-preview.js` to register `widget-animation-preview`.
This Host-owned widget renders pixel frames without built-in controls. Views own
selection, clip preparation and playback controls; the semantic element contract
remains in the protected [GAMS View Development Guide](#/gams-view-development-guide).

## Clip contract

`preview.clip = value` synchronously validates and independently copies a clip;
`preview.clip` returns an independent copy. Assigning `null` clears the preview
and stops playback. Existing synchronous consumers, including small icon previews,
do not need to change.

A non-null clip has exactly these keys:

```js
{
    width: 1,                 // positive integer
    height: 1,                // positive integer
    direction: "forward",     // forward, reverse, ping-pong, ping-pong-reverse
    repeat: 0,                // non-negative integer; zero loops indefinitely
    frames: [{                // non-empty array
        durationMs: 100,      // positive finite number
        pixels: {
            width: 1,        // must match clip width
            height: 1,       // must match clip height
            data: [255, 0, 0, 255], // plain array; width * height * 4 unsigned bytes
        },
    }],
}
```

Frame and pixel objects also accept only the shown keys. Typed pixel arrays,
missing channels, non-integer channels and values outside 0–255 are invalid.

## Asynchronous ingestion

For large clips, use `await preview.setClipAsync(value, isCurrent = () => true)`.
It resolves to `true` after committing the complete clip, or `false` when
superseded/cancelled. Invalid input rejects; an explicitly supplied `isCurrent`
must be a function. `null` is supported with the same clearing behavior.

```js
const committed = await preview.setClipAsync(clip, () =>
    this.previewRequest === request && this.isConnected
)
if (!committed) return
// Update controls for the newly committed preview.
```

Validation and independent RGBA copying run in chunks of at most 65,536 channels,
with `MessageChannel` task yields between chunks, including across frame boundaries.
These are event-loop tasks, not microtasks or nested timers subject to background
WebView timer clamping. Each yielding invocation lazily creates one channel and
closes both ports on success, cancellation or error; clips that never exhaust the
chunk budget allocate no channel. No whole-clip clone or second synchronous validation runs at commit. Keep the
input unchanged until the promise settles; preparation is not a snapshot of
concurrent caller mutations. The currently committed clip continues rendering
and playing while preparation runs. Only a complete successful clip is published,
with a single initial `framechange`; failures/cancellation publish nothing.

Every new async request or ordinary `.clip` assignment (including `null` or an
invalid assignment) invalidates earlier pending work. The widget checks its request
token and the caller predicate after each yield and immediately before commit.
A false predicate cancels that request; predicate exceptions reject it. Cancellation
does not clear or stop the previously committed clip.

Disconnecting the element stops its playback timer but does **not** itself cancel
preparation: retained widgets can move between containers. Views needing connected
selection ownership should include their request identity and `isConnected` in
`isCurrent`, as above. A committed clip preserves the current `playing` state
unless it is `null`; connected playback resumes from the new clip's first frame.

The sibling `view.character` consumer uses this additive API for its main
character preview; its small icon previews retain `.clip`. That View revision
requires an updated Host widget module. Other synchronous View consumers do not
need migration.

## Playback and events

- `playing`: boolean, requires a clip when enabling playback.
- `playbackRate`: positive finite number, default `1`.
- `frameIndex`: readable/writable frame index within the current clip.
- `framechange`: bubbling event with `detail.frameIndex` after commit, seek or
  playback advance.
- `ended`: bubbling event when finite repetition completes.

## Verification

```sh
node --test test/animation-preview.test.mjs
node --test test/*.test.mjs
```

The widget tests use a minimal DOM boundary, controlled MessageChannel tasks and
a real Node MessageChannel integration check with a timer guard. They cover chunk
bounds/yields, lazy channel allocation and port cleanup, atomic publication,
sync/async supersession, caller cancellation, invalid schemas/pixels, independent
copies and continued playback.
They do not measure native WKWebView timing or canvas rendering performance.
