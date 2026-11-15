export interface TranspiledComponent {
  files: Array<[string, Uint8Array]>;
  imports: string[];
  exports: Array<[string, string]>;
}

export function assertComponent(bytes: Uint8Array): void {
  const header = [0, 97, 115, 109, 13, 0, 1, 0];
  if (!header.every((value, index) => bytes[index] === value)) {
    throw new Error('Expected a Component Model binary, not a core Wasm module.');
  }
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Component input limit: 16 MiB.');
}

// Instantiate generated modules from worker-owned bytes, never generated HTTP paths.
export async function instantiateComponent(
  output: TranspiledComponent,
  allowed: ReadonlyMap<string, unknown>,
): Promise<Record<string, unknown>> {
  const imports = Object.create(null);
  for (const name of output.imports) {
    if (!allowed.has(name)) throw new Error(`Missing or denied WIT import: ${name}`);
    imports[name] = allowed.get(name);
  }
  const files = new Map(output.files);
  const js = files.get('component.js');
  if (!js) throw new Error('Jco did not produce component.js.');
  const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
  try {
    const bindings = await import(url);
    if (typeof bindings.instantiate !== 'function') throw new Error('Missing async instantiate export.');
    return await bindings.instantiate(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes || !path.endsWith('.wasm')) throw new Error(`Unknown generated core module: ${path}`);
      return WebAssembly.compile(bytes);
    }, imports);
  } finally {
    URL.revokeObjectURL(url);
  }
}
