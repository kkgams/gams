// Native $file preparation owns resource acquisition before runtime.ready.
export function validateLocalPath(path, label = "Unit source") {
    if (typeof path !== "string" || !path.trim() || /^[a-z][a-z0-9+.-]*:/i.test(path.trimStart()))
        throw new Error(`${label} must be a non-empty local path; use $file to prepare resource URLs`)
    return path
}
