const CALLS = new Map<string, { name: string; arity: number }>([
  ['fs/fs::read-file', { name: 'readFile', arity: 1 }],
  ['fs/fs::read-text', { name: 'readText', arity: 1 }],
  ['fs/fs::write-file', { name: 'writeFile', arity: 2 }],
  ['fs/fs::write-text', { name: 'writeText', arity: 2 }],
  ['fs/fs::list', { name: 'list', arity: 1 }],
  ['fs/fs::stat', { name: 'stat', arity: 1 }],
  ['fs/fs::create-dir', { name: 'createDir', arity: 1 }],
  ['fs/fs::remove-file', { name: 'removeFile', arity: 1 }],
  ['fs/fs::remove-dir', { name: 'removeDir', arity: 1 }],
  ['fs/fs::rename', { name: 'rename', arity: 2 }],
]);

export function projectPath(value: unknown): string {
  if (typeof value !== 'string' || value === '' || /[\\\0]/.test(value)) {
    throw new Error('Expected a nonempty Project path without backslashes or NUL');
  }
  if (value === '.' || value === '/') return '/project';
  const relative = value.startsWith('/') ? value.slice(1) : value;
  if (relative.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Project path contains an empty, dot or parent segment');
  }
  // Even a leading slash denotes a Project path, never a backend absolute path.
  return `/project/${relative}`;
}

function fileBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (!Array.isArray(value)) throw new Error('Expected a byte array');
  for (const byte of value) {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error('Expected integer bytes in the range 0..255');
    }
  }
  return Uint8Array.from(value);
}

export function prepareFilesystemCall(target: string, args: unknown[]): { name: string; values: unknown[] } {
  const call = CALLS.get(target);
  if (!call) throw new Error(`Unsupported filesystem target: ${target}`);
  if (!Array.isArray(args) || args.length !== call.arity) {
    throw new Error(`${target} requires ${call.arity} arguments`);
  }
  const values: unknown[] = [projectPath(args[0])];
  if (call.name === 'rename') values.push(projectPath(args[1]));
  if (call.name === 'writeFile') values.push(fileBytes(args[1]));
  if (call.name === 'writeText') {
    if (typeof args[1] !== 'string') throw new Error('write-text requires a string');
    values.push(args[1]);
  }
  return { name: call.name, values };
}

// Convert only the WIT payload; the worker owns the Runtime response envelope.
export function filesystemHostValue(value: unknown, uint32Lists = false): unknown {
  const ancestors = new Set<object>();
  function convert(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Nonfinite filesystem result');
      return value;
    }
    if (typeof value === 'bigint') {
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value) : value.toString();
    }
    if (value instanceof Uint8Array || (uint32Lists && value instanceof Uint32Array)) return Array.from(value);
    if (typeof value !== 'object') throw new Error('Unsupported filesystem result');
    if (ancestors.has(value)) throw new Error('Cyclic filesystem result');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      throw new Error('Expected a filesystem result record');
    }
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Unsupported symbol result keys');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return Array.from(value, convert);
      return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, convert(field)]));
    } finally {
      ancestors.delete(value);
    }
  }
  return convert(value);
}
