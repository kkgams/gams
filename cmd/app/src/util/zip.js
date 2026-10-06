import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "./vendor/zipjs/zip-native.js"

// Reject rather than rewrite paths: every name remains relative to the package.
export function validateZipPath(path) {
  if (typeof path !== "string" || !path || /[\\\x00]/.test(path) || /^[a-z]:/i.test(path))
    throw new Error(`Unsafe ZIP path: ${path}`)
  if (path.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`Unsafe ZIP path: ${path}`)
  return path
}

// The sink receives Uint8Array file bytes, or null for a directory. Validate the
// full member list and selected file before invoking it; never execute members.
export async function extractZip(bytes, selectedEntry, writeEntry) {
  validateZipPath(selectedEntry)
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    checkCrc32: false,
  })
  try {
    const entries = await reader.getEntries()
    for (const entry of entries) {
      validateZipPath(entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename)
      if (entry.symlink || entry.encrypted)
        throw new Error(`Unsupported ZIP entry: ${entry.filename} (symlink or encrypted)`)
    }
    if (!entries.some(entry => entry.filename === selectedEntry && !entry.directory))
      throw new Error(`ZIP entry not found: ${selectedEntry}`)
    for (const entry of entries) {
      const path = entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename
      const data = entry.directory ? null : await entry.getData(new Uint8ArrayWriter())
      await writeEntry(path, data)
    }
  } finally {
    await reader.close()
  }
}
