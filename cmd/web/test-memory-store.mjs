function failure(code, path) { return Object.assign(new Error(`${code}: ${path}`), {code}); }
import {normalizePath} from "./browser-path.ts";

// In-memory fixture for compiler-cache and binding tests; never bundled.
function directory() {
  return { dir: Object.create(null) };
}

function children(entry, path) {
  if (entry.symlink !== undefined) throw failure('ENOTSUP', path);
  if (!entry.dir) throw failure('ENOTDIR', path);
  return entry.dir;
}

function fileBytes(entry, path) {
  if (entry.symlink !== undefined) throw failure('ENOTSUP', path);
  if (entry.dir) throw failure('EISDIR', path);
  if (typeof entry.source === 'string') return new TextEncoder().encode(entry.source);
  if (!(entry.source instanceof Uint8Array)) throw failure('EINVAL', path);
  return entry.source;
}

export class TestMemoryStore {

  constructor(root, persist = async () => {}) {
    children(root, '/');
    this.root = root;
    this.persist = persist;
  }

  entry(path) {
    const normalized = normalizePath(path);
    let current = this.root;
    for (const name of normalized.split('/').filter(Boolean)) {
      const dir = children(current, normalized);
      if (!Object.hasOwn(dir, name)) throw failure('ENOENT', normalized);
      current = dir[name];
    }
    return current;
  }

  async read(path) {
    return fileBytes(this.entry(path), path).slice();
  }

  async write(path, bytes) {
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

  async mkdir(path) {
    this.makeDirectories(normalizePath(path));
  }

  async stat(path) {
    const entry = this.entry(path);
    if (entry.symlink !== undefined) throw failure('ENOTSUP', path);
    if (entry.dir) return 'directory';
    fileBytes(entry, path);
    return 'file';
  }

  async list(path) {
    return Object.keys(children(this.entry(path), path)).sort();
  }

  /** Remove an entry, including its complete subtree when it is a directory. */
  async remove(path) {
    const [parentPath, name] = this.parent(path);
    const dir = children(this.entry(parentPath), parentPath);
    if (!Object.hasOwn(dir, name)) throw failure('ENOENT', path);
    delete dir[name];
  }

  async rename(from, to) {
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

  async flush() {
    await this.persist();
  }

  parent(path) {
    const normalized = normalizePath(path);
    if (normalized === '/') throw failure('EBUSY', path);
    const slash = normalized.lastIndexOf('/');
    return [normalized.slice(0, slash) || '/', normalized.slice(slash + 1)];
  }

  makeDirectories(path) {
    let current = this.root;
    for (const name of path.split('/').filter(Boolean)) {
      const dir = children(current, path);
      if (!Object.hasOwn(dir, name)) dir[name] = directory();
      current = dir[name];
      children(current, path);
    }
  }
}
