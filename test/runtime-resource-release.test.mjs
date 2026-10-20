import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../cmd/app/src-tauri/src/lib.rs', import.meta.url), 'utf8')

test('resource-release IPC does not wait for the Wasmtime mutex on the native UI thread', () => {
    const command = /#\[tauri::command\]\s+((?:async )?fn runtime_release_resource\([\s\S]*?)(?=\n#\[tauri::command\])/.exec(source)?.[1]
    assert(command, 'resource release command must exist')
    assert(command.startsWith('async fn '), 'release must dispatch asynchronously instead of blocking the native UI thread')
    assert(command.includes('let runtime = runtime.inner().clone()'))
    assert.match(command, /spawn_blocking\(move \|\| runtime\.release_resource\(resource\)\)/)
    assert.match(command, /\.await/)
})
