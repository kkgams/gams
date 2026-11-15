import {
  createFilesystem, InMemoryFilesystemAdapter, OpfsFilesystemAdapter, loadOpfsCapability,
} from '@bytecodealliance/preview2-shim/filesystem';
import { protectOpfsDescriptor } from './opfs-paths';

export type FilesystemMode = 'memory' | 'opfs';
export interface CapabilityGrants {
  logging: boolean;
  filesystem: boolean;
  filesystemMode: FilesystemMode;
}
export interface CapabilitySession {
  imports: ReadonlyMap<string, unknown>;
  storage: 'none' | FilesystemMode;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
const OPFS_DIRECTORY = 'gams-browser-jco-experiment-v1';
// The shim schedules automatic flushes with `void this.flush()`. Observe their
// errors to avoid unhandled rejections, but retain them for the next checkpoint:
// no operation may report persistence success after an unnoticed write failure.
class CheckedOpfsAdapter extends OpfsFilesystemAdapter {
  private failure: unknown;
  getRoot(capability: Parameters<OpfsFilesystemAdapter['getRoot']>[0]) {
    return protectOpfsDescriptor(super.getRoot(capability));
  }
  flush(): Promise<void> {
    const pending = super.flush();
    void pending.catch(error => { this.failure = error; });
    return pending;
  }
  async checkpoint(): Promise<void> {
    await this.flush();
    if (this.failure !== undefined) throw this.failure;
  }
}

// Never use the shim's global preopens: those also belong to the compiler.
export async function createCapabilitySession(grants: CapabilityGrants, log: (value: number) => void): Promise<CapabilitySession> {
  if (grants.filesystemMode !== 'memory' && grants.filesystemMode !== 'opfs') {
    throw new Error(`Unknown filesystem mode: ${grants.filesystemMode}`);
  }
  const imports = new Map<string, unknown>();
  if (grants.logging) imports.set('gams:experiment/logging', { log });
  if (!grants.filesystem) return { imports, storage: 'none', flush: async () => {}, dispose: async () => {} };

  let filesystem;
  let flush: () => Promise<void>;
  let dispose: () => Promise<void>;
  if (grants.filesystemMode === 'memory') {
    filesystem = createFilesystem({ adapter: new InMemoryFilesystemAdapter(), preopens: { '/project': { dir: {} } } });
    flush = async () => {};
    dispose = async () => { await filesystem.dispose(); };
  } else {
    if (typeof navigator.storage.getDirectory !== 'function') throw new Error('OPFS is not available in this browser/context.');
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(OPFS_DIRECTORY, { create: true });
    const capability = await loadOpfsCapability(directory);
    const adapter = new CheckedOpfsAdapter();
    filesystem = createFilesystem({ adapter, preopens: { '/project': capability } });
    flush = () => adapter.checkpoint();
    dispose = async () => {
      // On failure keep the session alive. Only an explicit force stop
      // may discard it; ordinary reset must not claim the data was saved.
      await adapter.checkpoint();
      await filesystem.dispose();
    };
  }
  // Jco 1.42 emits unversioned keys; the binary uses 0.2.6. Its type-only
  // wall-clock import is erased, so no clock or other WASI capability is granted.
  imports.set('wasi:filesystem/types', filesystem.types);
  imports.set('wasi:filesystem/preopens', filesystem.preopens);
  return { imports, storage: grants.filesystemMode, flush, dispose };
}
