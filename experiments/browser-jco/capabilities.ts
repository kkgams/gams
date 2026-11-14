import { createFilesystem, InMemoryFilesystemAdapter } from '@bytecodealliance/preview2-shim/filesystem';

export interface CapabilityGrants {
  logging: boolean;
  filesystem: boolean;
}

// Never use the shim's global preopens: those also belong to the compiler.
export function createCapabilityImports(grants: CapabilityGrants, log: (value: number) => void) {
  const imports = new Map<string, unknown>();
  if (grants.logging) imports.set('gams:experiment/logging', { log });
  if (grants.filesystem) {
    const filesystem = createFilesystem({
      adapter: new InMemoryFilesystemAdapter(),
      preopens: { '/project': { dir: {} } },
    });
    // Jco 1.42 emits unversioned keys for these WASI imports. The tested
    // component's binary uses 0.2.6; its type-only wall-clock import is erased.
    imports.set('wasi:filesystem/types', filesystem.types);
    imports.set('wasi:filesystem/preopens', filesystem.preopens);
  }
  return imports;
}
