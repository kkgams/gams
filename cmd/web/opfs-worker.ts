// This worker owns OPFS handles. The Runtime worker waits only on its reply.
import { normalizePath } from './browser-path.ts';

const namespace = 'gams-browser-host-v1';
let root: FileSystemDirectoryHandle;
let reply: Int32Array;
let data: Uint8Array;
let release: (() => void) | undefined;
const encoder = new TextEncoder();
const errors = ['ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'ENOTEMPTY', 'ENOTSUP', 'EIO', 'ENOSPC', 'EACCES'];
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
async function dir(parts: string[], create = false) {
  let handle = root;
  for (const part of parts) handle = await handle.getDirectoryHandle(part, { create });
  return handle;
}
async function lookup(parent: FileSystemDirectoryHandle, name: string) {
  try { return await parent.getFileHandle(name); }
  catch (e) {
    if ((e as DOMException).name !== 'TypeMismatchError') throw e;
    return await parent.getDirectoryHandle(name);
  }
}
// OPFS does not provide directory rename in Chromium. For a Host-owned Unit
// cache only, publish files first and the completion marker last.
async function copyEntry(source: FileSystemHandle, target: FileSystemDirectoryHandle, name: string) {
  if (source.kind === 'file') {
    const file = await (source as FileSystemFileHandle).getFile();
    const output = await target.getFileHandle(name, {create:true});
    await file.stream().pipeTo(await output.createWritable());
  } else {
    const output = await target.getDirectoryHandle(name, {create:true});
    for await (const [key, child] of (source as FileSystemDirectoryHandle).entries()) await copyEntry(child, output, key);
  }
}
async function serve(op: string, path: string, at: number, size: number, dest: string): Promise<unknown> {
  const parts = normalizePath(path).split('/').filter(Boolean);
  if (op === 'close') { release?.(); return null; }
  if (op === 'mkdirp') { await dir(parts, true); return null; }
  const name = parts.pop();
  const parent = await dir(parts);
  if (op === 'create' || op === 'exclusive') {
    if (!name) fail('EISDIR');
    if (op === 'exclusive') {
      try { await lookup(parent, name); fail('EEXIST'); }
      catch (e) { if ((e as DOMException).name !== 'NotFoundError') throw e; }
    }
    await parent.getFileHandle(name, { create: true }); return null;
  }
  if (op === 'mkdir') {
    if (!name) fail('EEXIST');
    try { await lookup(parent, name); fail('EEXIST'); }
    catch (e) { if ((e as DOMException).name !== 'NotFoundError') throw e; }
    await parent.getDirectoryHandle(name, { create: true }); return null;
  }
  const handle = name ? await lookup(parent, name) : root;
  if (op === 'stat') return handle.kind === 'directory' ? ['directory', 0, 0] :
    await (handle as FileSystemFileHandle).getFile().then(file => ['file', file.size, file.lastModified]);
  if (op === 'list') {
    if (handle.kind !== 'directory') fail('ENOTDIR');
    const entries = [];
    for await (const [key, entry] of (handle as FileSystemDirectoryHandle).entries()) entries.push([key, entry.kind]);
    return entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  }
  if (op === 'remove' || op === 'unlink' || op === 'rmdir') {
    if (!name) fail('EACCES');
    if (op === 'unlink' && handle.kind !== 'file') fail('EISDIR');
    if (op === 'rmdir' && handle.kind !== 'directory') fail('ENOTDIR');
    await parent.removeEntry(name, { recursive: op === 'remove' }); return null;
  }
  if (op === 'publish') {
    if (!name || handle.kind !== 'directory') fail('ENOTDIR');
    const target = normalizePath(dest).split('/').filter(Boolean);
    const newName = target.pop(); if (!newName) fail('EISDIR');
    const targetParent = await dir(target);
    try { await lookup(targetParent, newName); fail('EEXIST'); }
    catch (e) { if ((e as DOMException).name !== 'NotFoundError') throw e; }
    const source = handle as FileSystemDirectoryHandle;
    const marker = await source.getFileHandle('.gams-resource.json');
    const output = await targetParent.getDirectoryHandle(newName, {create:true});
    try {
      for await (const [key, child] of source.entries()) if (key !== marker.name) await copyEntry(child, output, key);
      await copyEntry(marker, output, marker.name);
      await parent.removeEntry(name, {recursive:true});
    } catch (e) { await targetParent.removeEntry(newName, {recursive:true}); throw e; }
    return null;
  }
  if (op === 'rename') {
    if (!name || handle.kind !== 'file') fail('ENOTSUP');
    const target = normalizePath(dest).split('/').filter(Boolean);
    const newName = target.pop(); if (!newName) fail('EISDIR');
    const targetParent = await dir(target);
    const file = handle as FileSystemFileHandle & { move?: (parent: FileSystemDirectoryHandle, name: string) => Promise<void> };
    if (!file.move) fail('ENOTSUP');
    await file.move(targetParent, newName); return null;
  }
  if (handle.kind !== 'file') fail('EISDIR');
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(size) || size < 0) fail('EIO');
  const file = await (handle as FileSystemFileHandle).createSyncAccessHandle();
  try {
    if (op === 'read' && size <= data.length) {
      const count = file.read(data.subarray(0, size), { at });
      Atomics.store(reply, 2, at + count >= file.getSize() ? 1 : 0);
      return count;
    }
    if (op === 'write' && size <= data.length) {
      const count = file.write(data.subarray(0, size), { at }); file.flush(); return count;
    }
    if (op === 'truncate') { file.truncate(size); file.flush(); return null; }
    fail('ENOTSUP');
  } finally { file.close(); }
}

self.onmessage = async ({ data: message }) => {
  if (message.buffer) {
    try {
      if (!crossOriginIsolated || !navigator.locks) throw new Error('Direct OPFS requires cross-origin isolation and Web Locks.');
      const storage = await navigator.storage.getDirectory();
      await navigator.locks.request(namespace, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another GAMS session is using browser storage. Close it before opening this Project.');
        root = await storage.getDirectoryHandle(namespace, { create: true });
        reply = new Int32Array(message.buffer, 0, 4);
        data = new Uint8Array(message.buffer, 16);
        await new Promise<void>(resolve => { release = resolve; postMessage({ ready: true }); });
      });
      postMessage({ closed: true });
    } catch (e) { postMessage({ error: String(e) }); }
    return;
  }
  let length = 0;
  let error = 0;
  try {
    const value = await serve(message.op, message.path, message.at, message.size, message.dest);
    if (message.op === 'read') length = value as number;
    else {
      const encoded = encoder.encode(JSON.stringify(value));
      if (encoded.length > data.length) fail('ENOSPC');
      data.set(encoded); length = encoded.length;
    }
  } catch (e) {
    const err = e as {name?: string; code?: string};
    const code = err.code && typeof err.code === 'string' ? err.code :
      ({ NotFoundError: 'ENOENT', TypeMismatchError: 'ENOTDIR', InvalidModificationError: 'ENOTEMPTY',
        QuotaExceededError: 'ENOSPC', NotAllowedError: 'EACCES' } as Record<string, string>)[err.name ?? ''];
    error = (errors.includes(code ?? '') ? errors.indexOf(code!) : errors.indexOf('EIO')) + 1;
  } finally {
    Atomics.store(reply, 1, length); Atomics.store(reply, 3, error);
    Atomics.store(reply, 0, 1); Atomics.notify(reply, 0);
  }
};
