import type { BrowserFilesystemAdapter, BrowserFilesystemDescriptor } from '@bytecodealliance/preview2-shim/filesystem';
import type { TreeEntry } from './browser-storage.ts';

/** Keep the pinned in-memory shim's stream reads closed at and beyond EOF. */
export function projectFilesystemAdapter(base: BrowserFilesystemAdapter<TreeEntry>): BrowserFilesystemAdapter<TreeEntry> {
  const decorated = new WeakSet<BrowserFilesystemDescriptor>();
  function descriptor(value: BrowserFilesystemDescriptor): BrowserFilesystemDescriptor {
    if (decorated.has(value)) return value;
    decorated.add(value);
    const read = value.readViaStream.bind(value);
    const open = value.openAt.bind(value);
    // preview2-shim 0.31.1 tests offset === size, so offset > size loops on empty reads.
    // Its streams snapshot the source; starting at that snapshot's EOF must close too.
    value.readViaStream = offset => {
      const size = value.stat().size;
      return read(offset > size ? size : offset);
    };
    value.openAt = (...args) => descriptor(open(...args));
    return value;
  }
  // Decorate actual descriptors, not proxies: cross-descriptor rename/link keep their brands.
  return { getRoot: capability => descriptor(base.getRoot(capability)), dispose: () => base.dispose?.() };
}
