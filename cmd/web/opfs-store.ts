import type { Store } from './browser-project.ts';
import { normalizePath } from './browser-path.ts';

const capacity = 256 * 1024;
const errors = ['ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'ENOTEMPTY', 'ENOTSUP', 'EIO', 'ENOSPC', 'EACCES'];
export type StorageStat = ['file' | 'directory', number, number];
export type StorageEntry = [string, 'file' | 'directory'];
const decoder = new TextDecoder();

/** Bounded synchronous transport inside the Runtime worker, never the UI. */
export class DirectOpfsStore implements Store {
  private readonly buffer = new SharedArrayBuffer(capacity + 16);
  private readonly reply = new Int32Array(this.buffer, 0, 4);
  private readonly data = new Uint8Array(this.buffer, 16);
  private failed = false;
  private readonly identities = new Map<string, bigint>();
  private nextIdentity = 1n;

  identity(path: string) {
    if (!this.identities.has(path)) this.identities.set(path, this.nextIdentity++);
    return this.identities.get(path)!;
  }

  private invalidate(path: string) {
    for (const key of this.identities.keys()) if (key === path || key.startsWith(`${path}/`)) this.identities.delete(key);
  }
  readonly metrics = { reads: 0, readBytes: 0, writes: 0, writeBytes: 0 };
  private readonly worker: Worker;
  private readonly root: FileSystemDirectoryHandle;
  private constructor(worker: Worker, root: FileSystemDirectoryHandle) { this.worker = worker; this.root = root; }

  static async open() {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw new Error('Direct OPFS requires cross-origin isolation.');
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle('gams-browser-host-v1', {create:true});
    const worker = new Worker('/vendor/opfs-worker.js', {type: 'module'});
    const store = new DirectOpfsStore(worker, root);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('OPFS worker startup timed out.')), 10_000);
        worker.onmessage = ({data}) => { clearTimeout(timer); if (data.ready) resolve(); else reject(new Error(data.error)); };
        worker.onerror = () => { clearTimeout(timer); reject(new Error('OPFS worker startup failed.')); };
        worker.postMessage({ buffer: store.buffer });
      });
      worker.onmessage = null;
      return store;
    } catch (e) { worker.terminate(); throw e; }
  }

  private message(op: string, path: string, at = 0, size = 0, dest?: string) {
    if (this.failed) throw Object.assign(new Error('OPFS session is stopped.'), {code: 'EIO'});
    Atomics.store(this.reply, 0, 0);
    this.worker.postMessage({ op, path: normalizePath(path), at, size, dest });
    if (Atomics.wait(this.reply, 0, 0, 15_000) === 'timed-out') {
      this.failed = true; this.worker.terminate();
      throw Object.assign(new Error(`OPFS ${op} timed out; reopen the Project.`), {code: 'EIO'});
    }
    const error = Atomics.load(this.reply, 3);
    if (error) { const code = errors[error - 1]; throw Object.assign(new Error(`${code}: ${path}`), {code}); }
    return Atomics.load(this.reply, 1);
  }

  command<T = void>(op: string, path: string, size = 0, dest?: string): T {
    const value = JSON.parse(decoder.decode(this.data.slice(0, this.message(op, path, 0, size, dest))));
    if (op === 'unlink' || op === 'rmdir' || op === 'rename' || op === 'publish') this.invalidate(normalizePath(path));
    if (dest !== undefined) this.invalidate(normalizePath(dest));
    return value;
  }
  readAt(path: string, length: number, offset: number): [Uint8Array, boolean] {
    const size = this.message('read', path, offset, Math.min(length, capacity));
    this.metrics.reads++; this.metrics.readBytes += size;
    return [this.data.slice(0, size), Atomics.load(this.reply, 2) === 1];
  }
  writeAt(path: string, bytes: Uint8Array, offset: number) {
    let written = 0;
    while (written < bytes.length) {
      const chunk = bytes.subarray(written, written + capacity);
      this.data.set(chunk);
      const length = this.message('write', path, offset + written, chunk.length);
      const size = JSON.parse(decoder.decode(this.data.slice(0, length)));
      if (!Number.isSafeInteger(size) || size <= 0 || size > chunk.length) throw Object.assign(new Error('Short OPFS write'), {code: 'EIO'});
      this.metrics.writes++; this.metrics.writeBytes += size; written += size;
    }
    return written;
  }
  private async directory(path: string, create = false) {
    let dir = this.root;
    for (const part of normalizePath(path).split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, {create});
    return dir;
  }
  private async parent(path: string, create = false): Promise<[FileSystemDirectoryHandle,string]> {
    const parts = normalizePath(path).split('/');
    const name = parts.pop()!;
    if (!name) throw Object.assign(new Error(`Invalid file path: ${path}`), {code:'EISDIR'});
    return [await this.directory(parts.join('/') || '/', create), name];
  }
  private async host<T>(path: string, run: () => Promise<T>): Promise<T> {
    if (this.failed) throw Object.assign(new Error('OPFS session is stopped.'), {code:'EIO'});
    try { return await run(); }
    catch (e) {
      if (e instanceof DOMException) {
        const code = e.name === 'NotFoundError' ? 'ENOENT' : e.name === 'TypeMismatchError' ? 'ENOTDIR' : 'EIO';
        throw Object.assign(new Error(`${code}: ${path}`, {cause:e}), {code});
      }
      throw e;
    }
  }
  async read(path: string) { return this.host(path, async () => {
    const [parent, name] = await this.parent(path);
    return new Uint8Array(await (await (await parent.getFileHandle(name)).getFile()).arrayBuffer());
  }); }
  async write(path: string, bytes: Uint8Array) { return this.host(path, async () => {
    const [parent, name] = await this.parent(path, true);
    const stream = await (await parent.getFileHandle(name, {create:true})).createWritable();
    try { await stream.write(bytes); await stream.close(); }
    catch (e) { await stream.abort(); throw e; }
  }); }
  async mkdir(path: string) { return this.host(path, async () => { await this.directory(path, true); }); }
  async stat(path: string): Promise<'file' | 'directory'> { return this.host(path, async () => {
    if (normalizePath(path) === '/') return 'directory';
    const [parent, name] = await this.parent(path);
    try { await parent.getFileHandle(name); return 'file'; }
    catch (e) { if (!(e instanceof DOMException) || e.name !== 'TypeMismatchError') throw e; }
    await parent.getDirectoryHandle(name); return 'directory';
  }); }
  async list(path: string) { return this.host(path, async () => {
    const names = [];
    for await (const name of (await this.directory(path)).keys()) names.push(name);
    return names.sort();
  }); }
  async remove(path: string) { return this.host(path, async () => {
    const [parent, name] = await this.parent(path); await parent.removeEntry(name, {recursive:true}); this.invalidate(normalizePath(path));
  }); }
  async rename(from: string, to: string) { this.command('rename', from, 0, to); }
  async publishResource(from: string, to: string) { this.command('publish', from, 0, to); }
  async flush() { /* Mutating operations are persisted at the filesystem worker before reply. */ }
  async close() {
    if (this.failed) return;
    try { this.command('close', '/'); } finally { this.failed = true; this.worker.terminate(); }
  }
}
