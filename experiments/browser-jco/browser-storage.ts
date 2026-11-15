export type TreeEntry = {
  dir?: Record<string, TreeEntry>;
  source?: Uint8Array | string;
  symlink?: string;
};

function failure(code: string, path: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function checkName(name: string): void {
  if (['__proto__', 'constructor', 'prototype'].includes(name)) {
    throw failure('EINVAL', name);
  }
}

/** Virtual slash-separated paths only; traversal above the virtual root is an error. */
export function normalizePath(path: string, base = '/'): string {
  if (typeof path !== 'string' || typeof base !== 'string' ||
      /[\0\\]/.test(path) || /[\0\\]/.test(base) || !base.startsWith('/')) {
    throw failure('EINVAL', String(path));
  }
  const parts: string[] = [];
  for (const part of (path.startsWith('/') ? path : `${base}/${path}`).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw failure('EPERM', path);
      parts.pop();
    } else {
      checkName(part);
      parts.push(part);
    }
  }
  return `/${parts.join('/')}`;
}

export function joinPath(base: string, path: string): string {
  return normalizePath(path, base);
}

function directory(): TreeEntry {
  return { dir: Object.create(null) };
}

function children(entry: TreeEntry, path: string): Record<string, TreeEntry> {
  if (entry.symlink !== undefined) throw failure('ENOTSUP', path);
  if (!entry.dir) throw failure('ENOTDIR', path);
  return entry.dir;
}

function fileBytes(entry: TreeEntry, path: string): Uint8Array {
  if (entry.symlink !== undefined) throw failure('ENOTSUP', path);
  if (entry.dir) throw failure('EISDIR', path);
  if (typeof entry.source === 'string') return new TextEncoder().encode(entry.source);
  if (!(entry.source instanceof Uint8Array)) throw failure('EINVAL', path);
  return entry.source;
}

/** One worker owns this mirror. Mutations are acknowledged durably only by flush(). */
export class BrowserStore {
  readonly root: TreeEntry;
  private readonly persist: () => Promise<void>;

  constructor(root: TreeEntry, persist: () => Promise<void> = async () => {}) {
    children(root, '/');
    this.root = root;
    this.persist = persist;
  }

  static async open(namespace = 'gams-browser-host-v1'): Promise<BrowserStore> {
    if (!namespace || namespace === '.' || namespace === '..' ||
        /[/\\\0]/.test(namespace)) throw failure('EINVAL', namespace);
    checkName(namespace);
    const origin = await navigator.storage.getDirectory();
    const handle = await origin.getDirectoryHandle(namespace, { create: true });
    const root = await loadTree(handle);
    return new BrowserStore(root, async () => {
      validateTree(root);
      await saveTree(handle, root);
    });
  }

  /** Returns the actual mutable entry, suitable for InMemoryFilesystemAdapter preopens. */
  entry(path: string): TreeEntry {
    const normalized = normalizePath(path);
    let current = this.root;
    for (const name of normalized.split('/').filter(Boolean)) {
      const dir = children(current, normalized);
      if (!Object.hasOwn(dir, name)) throw failure('ENOENT', normalized);
      current = dir[name];
    }
    return current;
  }

  async read(path: string): Promise<Uint8Array> {
    return fileBytes(this.entry(path), path).slice();
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (!(bytes instanceof Uint8Array)) throw failure('EINVAL', path);
    const [parentPath, name] = this.parent(path);
    this.makeDirectories(parentPath);
    const dir = children(this.entry(parentPath), parentPath);
    if (Object.hasOwn(dir, name)) {
      fileBytes(dir[name], path);
      // Descriptors retain the entry, not its source buffer. Never replace that entry.
      dir[name].source = bytes.slice();
    } else {
      dir[name] = { source: bytes.slice() };
    }
  }

  async mkdir(path: string): Promise<void> {
    this.makeDirectories(normalizePath(path));
  }

  async stat(path: string): Promise<'file' | 'directory'> {
    const entry = this.entry(path);
    if (entry.symlink !== undefined) throw failure('ENOTSUP', path);
    if (entry.dir) return 'directory';
    fileBytes(entry, path);
    return 'file';
  }

  async list(path: string): Promise<string[]> {
    return Object.keys(children(this.entry(path), path)).sort();
  }

  /** Remove an entry, including its complete subtree when it is a directory. */
  async remove(path: string): Promise<void> {
    const [parentPath, name] = this.parent(path);
    const dir = children(this.entry(parentPath), parentPath);
    if (!Object.hasOwn(dir, name)) throw failure('ENOENT', path);
    delete dir[name];
  }

  async rename(from: string, to: string): Promise<void> {
    const sourcePath = normalizePath(from);
    const targetPath = normalizePath(to);
    const [sourceParent, sourceName] = this.parent(sourcePath);
    const [targetParent, targetName] = this.parent(targetPath);
    const source = this.entry(sourcePath);
    const sourceDir = children(this.entry(sourceParent), sourceParent);
    const targetDir = children(this.entry(targetParent), targetParent);
    if (sourcePath === targetPath) return;
    if (targetPath.startsWith(`${sourcePath}/`)) throw failure('EINVAL', to);
    if (Object.hasOwn(targetDir, targetName)) {
      const target = targetDir[targetName];
      if (!!source.dir !== !!target.dir) throw failure(source.dir ? 'ENOTDIR' : 'EISDIR', to);
      if (target.dir && Object.keys(target.dir).length) throw failure('ENOTEMPTY', to);
    }
    targetDir[targetName] = source;
    delete sourceDir[sourceName];
  }

  async flush(): Promise<void> {
    await this.persist();
  }

  private parent(path: string): [string, string] {
    const normalized = normalizePath(path);
    if (normalized === '/') throw failure('EBUSY', path);
    const slash = normalized.lastIndexOf('/');
    return [normalized.slice(0, slash) || '/', normalized.slice(slash + 1)];
  }

  private makeDirectories(path: string): void {
    let current = this.root;
    for (const name of path.split('/').filter(Boolean)) {
      const dir = children(current, path);
      if (!Object.hasOwn(dir, name)) dir[name] = directory();
      current = dir[name];
      children(current, path);
    }
  }
}

// The backend owns only this namespace. No locks, timers, or global shim state.
async function loadTree(handle: FileSystemDirectoryHandle): Promise<TreeEntry> {
  const root = directory();
  for await (const [name, child] of handle.entries()) {
    checkName(name);
    root.dir![name] = child.kind === 'directory'
      ? await loadTree(child)
      : { source: new Uint8Array(await (await child.getFile()).arrayBuffer()) };
  }
  return root;
}

function validateTree(entry: TreeEntry, ancestors = new Set<TreeEntry>()): void {
  if (ancestors.has(entry)) throw failure('EINVAL', 'cyclic storage tree');
  if (entry.symlink !== undefined) throw failure('ENOTSUP', 'OPFS symlink');
  if (!entry.dir) {
    fileBytes(entry, 'storage tree');
    return;
  }
  ancestors.add(entry);
  for (const [name, child] of Object.entries(entry.dir)) {
    checkName(name);
    if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
      throw failure('EINVAL', name);
    }
    validateTree(child, ancestors);
  }
  ancestors.delete(entry);
}

async function saveTree(handle: FileSystemDirectoryHandle, entry: TreeEntry): Promise<void> {
  const dir = children(entry, 'OPFS directory');
  for await (const [name, child] of handle.entries()) {
    const expected = Object.hasOwn(dir, name) ? dir[name] : undefined;
    if (!expected || child.kind !== (expected.dir ? 'directory' : 'file')) {
      await handle.removeEntry(name, { recursive: true });
    }
  }
  for (const [name, child] of Object.entries(dir)) {
    if (child.dir) {
      await saveTree(await handle.getDirectoryHandle(name, { create: true }), child);
    } else {
      const file = await handle.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(fileBytes(child, name));
        await writable.close();
      } catch (error) {
        // Abort releases a failed writer; never conceal the original write/close failure.
        try { await writable.abort(); } catch { /* The stream may already be closed. */ }
        throw error;
      }
    }
  }
}
