export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const mix = (a, b, t) => a + (b - a) * t
export const smooth = (value) => {
    const t = clamp(value)
    return t * t * (3 - 2 * t)
}

// A shorter braking tail than exponential easing, with an exact endpoint.
export const easeOutScroll = (value) => {
    const t = clamp(value)
    return 1 - (1 - t) ** 3
}

export function rulerGeometry(scroll, height, documentHeight, padding = 60) {
    const range = Math.max(0, documentHeight - height)
    const progress = range ? clamp(scroll / range) : 0
    const track = Math.max(1, height - padding * 2)
    return {
        progress,
        // The scale is document-height, not a static 0–100 minimap.
        offset: padding - progress * Math.max(0, documentHeight - track),
        indicator: padding + progress * track,
        thumb: Math.min(track, (track * height) / Math.max(1, documentHeight)),
        range,
        track,
    }
}

// Four continuous poses: future stack → vertical → active → past stack.
function labelMotion({ index, count, top, nextTop, width, height, textWidth }) {
    const compact = width < 700
    const small = compact ? 11 : 14
    const large = compact ? 20 : 34
    const edge = compact ? 42 : 56
    const topY = 76 + index * 20
    const bottomY = height - 28 - (count - 1 - index) * 20
    const activeY = topY + 24
    // Clear space before the next label's staggered letters reach the heading.
    const shrinkLead = 100
    const verticalY = clamp(top + 120, activeY + 65, height - 165)
    const future = { x: width - edge - (textWidth * small) / 34 / 2, y: bottomY, angle: 0, size: small, opacity: 0.45 }
    const vertical = {
        x: width - (compact ? 16 : 29),
        y: verticalY,
        angle: -90,
        size: compact ? 14 : 18,
        opacity: 0.55,
    }
    const active = { x: width - edge - (textWidth * large) / 34 / 2, y: activeY, angle: 0, size: large, opacity: 1 }
    const past = { ...future, y: topY }
    return {
        poses: [future, vertical, active, past],
        progress: [
            clamp((height - 140 - top) / 200),
            clamp((activeY + 220 - top) / 220),
            clamp((activeY + 170 + shrinkLead - nextTop) / 170),
        ],
    }
}

const interpolate = (a, b, t) => Object.fromEntries(Object.keys(a).map((key) => [key, mix(a[key], b[key], t)]))
const cubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

// Preserve the word-level path for the first title's hero transfer.
export function labelPose(options) {
    const { poses, progress } = labelMotion(options)
    return poses
        .slice(1)
        .reduce(
            (pose, next, index) =>
                interpolate(
                    pose,
                    next,
                    options.reduced ? Math.round(smooth(progress[index])) : smooth(progress[index]),
                ),
            poses[0],
        )
}

export function positionedLetters(pose, widths) {
    let cursor = -widths.reduce((sum, width) => sum + width, 0) / 2
    const radians = (pose.angle * Math.PI) / 180
    return widths.map((width) => {
        const offset = ((cursor + width / 2) * pose.size) / 34
        cursor += width
        return { ...pose, x: pose.x + offset * Math.cos(radians), y: pose.y + offset * Math.sin(radians) }
    })
}

/** Reversible hero-to-sidebar flight; later top-stack shrinking stays synchronized. */
export function heroLetterPoses(options, widths, scroll) {
    const destination = positionedLetters(labelPose(options), widths)
    if (options.reduced || scroll >= options.height * 0.5) return destination
    const origin = positionedLetters(
        {
            // The overlay is fixed, so convert the document position to viewport space.
            x: options.width / 2,
            y: options.height * 0.36 - scroll,
            size: Math.min(110, options.width / 9),
            angle: 0,
            opacity: 1,
        },
        widths,
    )
    const progress = clamp(scroll / (options.height * 0.5))
    const stagger = 0.16
    const total = 1 + (widths.length - 1) * stagger
    return destination.map((pose, index) => {
        const t = cubic(clamp(progress * total - (widths.length - 1 - index) * stagger))
        const result = interpolate(origin[index], pose, t)
        result.x -= 2 * (1 - t) * t * 28
        return result
    })
}

/** Letter motion: reverse stagger .16, cubic easing, inward 28px arc. */
export function letterPoses(options, widths) {
    const { poses, progress } = labelMotion(options)
    const endpoints = poses.map((pose) => positionedLetters(pose, widths))
    return widths.map((_, index) => {
        let pose = endpoints[0][index]
        for (let stage = 0; stage < progress.length; stage++) {
            // Stagger only the flips; the top heading shrinks as one rigid word.
            const stagger = options.reduced || stage === 2 ? 0 : 0.16
            const total = 1 + (widths.length - 1) * stagger
            const order = widths.length - 1 - index
            const t = options.reduced
                ? Math.round(progress[stage])
                : cubic(clamp(progress[stage] * total - order * stagger))
            pose = interpolate(pose, endpoints[stage + 1][index], t)
            // Quadratic Bezier control point is 28px inward from the midpoint.
            if (!options.reduced && stage < 2) pose.x -= 2 * (1 - t) * t * 28
        }
        return pose
    })
}
