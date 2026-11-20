import type { BrowserFilesystemAdapter, BrowserFilesystemDescriptor as Descriptor } from '@bytecodealliance/preview2-shim/filesystem';
import { inputStreamCreate, outputStreamCreate, ioErrorCreate } from '@bytecodealliance/preview2-shim/browser-io';
import { type DirectOpfsStore, type StorageEntry, type StorageStat } from './opfs-store.ts';
import { normalizePath } from './browser-path.ts';

const errors: Record<string,string> = { ENOENT:'no-entry', ENOTDIR:'not-directory', EISDIR:'is-directory', EEXIST:'exist', ENOTEMPTY:'not-empty', ENOTSUP:'unsupported', ENOSPC:'insufficient-space', EACCES:'access' };
function filesystem<T>(run: () => T): T {
  try { return run(); } catch (e) { if (e instanceof Error && 'code' in e) throw errors[String(e.code)] ?? 'io'; throw e; }
}
function stream<T>(run: () => T): T {
  try { return run(); } catch (e) { throw { tag:'last-operation-failed', val:ioErrorCreate(String(e)) }; }
}
function relative(root: string, path: string) {
  if (path.startsWith('/')) throw 'not-permitted';
  let suffix;
  try { suffix = normalizePath(path); } catch { throw 'not-permitted'; }
  return suffix === '/' ? root : normalizePath(`${root}/${suffix.slice(1)}`);
}
const unsupported = (): never => { throw 'unsupported'; };
const time = (ms: number) => ({ seconds: BigInt(Math.floor(ms / 1000)), nanoseconds: (ms % 1000) * 1_000_000 });
const type = (kind: string) => kind === 'directory' ? 'directory' as const : 'regular-file' as const;
function size(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw 'overflow';
  return Number(value);
}

export function directFilesystemAdapter(store: DirectOpfsStore): BrowserFilesystemAdapter<string> {
  let disposed = false;
  const names = new WeakMap<Descriptor, {path:string; live:() => void}>();
  function command<T = void>(op: string, path: string, n?: number, dest?: string) {
    if (disposed) throw 'bad-descriptor';
    return filesystem(() => store.command<T>(op, path, n, dest));
  }
  function stat(path: string) {
    const [kind, length, modified] = command<StorageStat>('stat', path);
    return { type:type(kind), size:BigInt(length), linkCount:1n, dataAccessTimestamp:time(0), dataModificationTimestamp:time(modified), statusChangeTimestamp:time(modified) };
  }
  function metadata(path: string) {
    const info = stat(path);
    return { upper:store.identity(path), lower:(info.dataModificationTimestamp.seconds << 32n) ^ BigInt(info.dataModificationTimestamp.nanoseconds) ^ info.size };
  }
  function descriptor(path: string, kind: ReturnType<typeof type>, flags: ReturnType<Descriptor['getFlags']>): Descriptor {
    const identity = store.identity(path);
    const live = () => { if (disposed || store.identity(path) !== identity) throw 'bad-descriptor'; };
    const directory = () => { live(); if (kind !== 'directory') throw 'bad-descriptor'; };
    const file = (access: 'read'|'write') => { live(); if (kind !== 'regular-file' || !flags[access]) throw 'bad-descriptor'; };
    const d: Descriptor = {
      getType: () => kind,
      getFlags: () => ({...flags}),
      read(length, offset) { file('read'); return filesystem(() => store.readAt(path, size(length), size(offset))); },
      write(bytes, offset) { file('write'); return BigInt(filesystem(() => store.writeAt(path, bytes, size(offset)))); },
      setSize(length) { file('write'); command('truncate', path, size(length)); },
      readViaStream(offset) {
        file('read');
        return inputStreamCreate({ blockingRead(length: bigint) {
          if (!length) return new Uint8Array();
          const [bytes] = stream(() => d.read(length, offset));
          if (!bytes.length) throw {tag:'closed'};
          offset += BigInt(bytes.length); return bytes;
        }});
      },
      writeViaStream(offset) {
        file('write');
        return outputStreamCreate({write(bytes: Uint8Array) { offset += stream(() => d.write(bytes, offset)); }});
      },
      appendViaStream() {
        file('write');
        return outputStreamCreate({write(bytes: Uint8Array) { stream(() => d.write(bytes, d.stat().size)); }});
      },
      stat() { live(); return stat(path); },
      statAt(_flags, child) { directory(); return stat(relative(path, child)); },
      readDirectory() {
        directory(); const entries = command<StorageEntry[]>('list', path)[Symbol.iterator]();
        return {readDirectoryEntry() { const step = entries.next(); if (!step.done) return {name:step.value[0], type:type(step.value[1])}; }};
      },
      openAt(_pathFlags, child, open, requested) {
        directory(); const target = relative(path, child);
        if (open.create && !open.directory) command(open.exclusive ? 'exclusive' : 'create', target);
        const {type: actual} = stat(target);
        if (open.directory && actual !== 'directory') throw 'not-directory';
        if ((open.truncate || requested.write) && actual === 'directory') throw 'is-directory';
        if (open.truncate && !requested.write) throw 'bad-descriptor';
        if (open.truncate) command('truncate', target, 0);
        return descriptor(target, actual, requested);
      },
      createDirectoryAt(child) { directory(); command('mkdir', relative(path, child)); },
      removeDirectoryAt(child) { directory(); const target = relative(path, child); if (target === path) throw 'not-permitted'; command('rmdir', target); },
      unlinkFileAt(child) { directory(); const target = relative(path, child); command('unlink', target); },
      renameAt(oldPath, target, newPath) {
        directory(); const destination = names.get(target);
        if (!destination || target.getType() !== 'directory') throw 'bad-descriptor';
        destination.live();
        const parent = destination.path;
        const old = relative(path, oldPath), next = relative(parent, newPath);
        if (old === path || next === parent) throw 'not-permitted';
        if (old !== next) command('rename', old, 0, next);
      },
      // Each mutating call flushes before returning. No dirty tree remains.
      sync:live, syncData:live, advise:live,
      linkAt:unsupported, readlinkAt:unsupported, symlinkAt:unsupported, setTimes:unsupported, setTimesAt:unsupported,
      isSameObject(other) { live(); const target = names.get(other); target?.live(); return target?.path === path; },
      metadataHash() { live(); return metadata(path); },
      metadataHashAt(_flags, child) { directory(); return metadata(relative(path, child)); },
    };
    names.set(d, {path, live});
    return d;
  }
  return { getRoot: path => descriptor(path, 'directory', {read:true}), dispose: () => { disposed = true; } };
}
