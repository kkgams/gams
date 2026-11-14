type Check = { label: string; result: unknown };
type Instance = Record<string, unknown>;
type Entry = { name: string; type: string };
type Stat = { type: string; size: bigint; atime: bigint; mtime: bigint; ctime: bigint };
interface Filesystem {
  createDir(path: string): void;
  writeText(path: string, text: string): void;
  readText(path: string): string;
  writeFile(path: string, bytes: Uint8Array): void;
  readFile(path: string): Uint8Array;
  list(path: string): Entry[];
  stat(path: string): Stat;
  rename(source: string, target: string): void;
  removeFile(path: string): void;
  removeDir(path: string): void;
}

function requireCheck(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Plugin check failed: ${label}`);
}

function exported<T>(instance: Instance, name: string, methods: string[]): T {
  const value = instance[name];
  requireCheck(typeof value === 'object' && value !== null, `missing interface ${name}`);
  for (const method of methods) {
    requireCheck(typeof (value as Record<string, unknown>)[method] === 'function', `missing ${name}.${method}`);
  }
  return value as T;
}

// Jco throws WIT result errors; successful results are not tagged unions.
function expectError(label: string, operation: () => unknown, undoUnexpectedSuccess?: () => void): string {
  try {
    operation();
  } catch (error) {
    const payload = typeof error === 'string' ? error :
      error !== null && typeof error === 'object' && 'payload' in error ? error.payload : undefined;
    requireCheck(typeof payload === 'string' && payload.length > 0, `${label}: expected a WIT string error`);
    return payload;
  }
  if (undoUnexpectedSuccess) undoUnexpectedSuccess();
  throw new Error(`Plugin check failed: ${label}: expected an error`);
}

export function runRandomChecks(instance: Instance) {
  const seeded = exported<{
    setSeed(seed: bigint): void; getSeed(): bigint; getGeneration(): bigint;
  }>(instance, 'gams:random/seeded-random@1.0.0', ['setSeed', 'getSeed', 'getGeneration']);
  const random = exported<{
    getRandomBytes(length: bigint): Uint8Array; getRandomU64(): bigint;
  }>(instance, 'wasi:random/random@0.2.0', ['getRandomBytes', 'getRandomU64']);
  const checks: Check[] = [];
  seeded.setSeed(123n);
  requireCheck(seeded.getSeed() === 123n && seeded.getGeneration() === 0n, 'seed and initial generation');
  checks.push({ label: 'seed and initial generation', result: { seed: '123', generation: '0' } });
  const first = random.getRandomBytes(16n);
  requireCheck(first instanceof Uint8Array && first.length === 16, '16 random bytes');
  // Copy before another export can reuse canonical ABI memory.
  const bytes = Array.from(first);
  requireCheck(seeded.getGeneration() === 2n, 'generation after 16 bytes');
  checks.push({ label: '16 random bytes', result: { bytes, generation: '2' } });
  seeded.setSeed(123n);
  requireCheck(seeded.getSeed() === 123n && seeded.getGeneration() === 0n, 'reset seed and generation');
  const repeated = random.getRandomBytes(16n);
  requireCheck(repeated instanceof Uint8Array && repeated.length === 16 && bytes.every((byte, i) => byte === repeated[i]), 'seeded repeat');
  requireCheck(seeded.getGeneration() === 2n, 'generation after repeated 16 bytes');
  checks.push({ label: 'seeded repeat', result: { matches: true, generation: '2' } });
  const value = random.getRandomU64();
  requireCheck(typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn, 'random u64');
  requireCheck(seeded.getSeed() === 123n && seeded.getGeneration() === 3n, 'generation after u64');
  checks.push({ label: 'random u64', result: { value: value.toString(10), seed: '123', generation: '3' } });
  return { checks };
}

export function runFilesystemChecks(instance: Instance) {
  const fs = exported<Filesystem>(instance, 'gams:fs/fs@1.2.0', [
    'createDir', 'writeText', 'readText', 'writeFile', 'readFile', 'list', 'stat', 'rename', 'removeFile', 'removeDir',
  ]);
  const checks: Check[] = [];
  const directory = '/project/browser-jco-check';
  const snapshot = () => JSON.stringify(fs.list('/project').map(({ name, type }) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name)));
  const before = snapshot();
  requireCheck(!fs.list('/project').some(entry => entry.name === 'browser-jco-check'), 'check directory must not already exist');
  const files = new Set<string>();
  let created = false;
  try {
    fs.createDir(directory);
    created = true;
    requireCheck(fs.stat(directory).type === 'directory', 'create directory');
    checks.push({ label: 'create directory', result: directory });
    const textPath = `${directory}/text.txt`;
    const text = 'Hello, 世界! 🌍\n';
    fs.writeText(textPath, text);
    files.add(textPath);
    requireCheck(fs.readText(textPath) === text, 'UTF-8 text roundtrip');
    checks.push({ label: 'UTF-8 text roundtrip', result: text });
    const binaryPath = `${directory}/bytes.bin`;
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    fs.writeFile(binaryPath, bytes);
    files.add(binaryPath);
    const read = fs.readFile(binaryPath);
    requireCheck(read instanceof Uint8Array && read.length === bytes.length && bytes.every((byte, i) => byte === read[i]), 'binary roundtrip');
    checks.push({ label: 'binary roundtrip', result: Array.from(read) });
    const entries = fs.list(directory).slice().sort((a, b) => a.name.localeCompare(b.name));
    requireCheck(entries.length === 2 && entries[0].name === 'bytes.bin' && entries[1].name === 'text.txt' && entries.every(entry => entry.type === 'regular-file'), 'list files');
    checks.push({ label: 'list files', result: entries });
    const stat = fs.stat(textPath);
    requireCheck(stat.type === 'regular-file' && stat.size === BigInt(new TextEncoder().encode(text).length), 'stat UTF-8 byte size');
    for (const key of ['atime', 'mtime', 'ctime'] as const) requireCheck(typeof stat[key] === 'bigint' && stat[key] >= 0n, `stat ${key}`);
    checks.push({ label: 'stat UTF-8 byte size', result: {
      type: stat.type, size: stat.size.toString(10), atime: stat.atime.toString(10), mtime: stat.mtime.toString(10), ctime: stat.ctime.toString(10),
    } });
    const renamed = `${directory}/renamed.txt`;
    fs.rename(textPath, renamed);
    files.delete(textPath);
    files.add(renamed);
    requireCheck(fs.readText(renamed) === text, 'rename and read');
    checks.push({ label: 'rename and read', result: renamed });
    checks.push({ label: 'old rename path missing', result: expectError('old rename path missing', () => fs.readText(textPath)) });
    checks.push({ label: 'missing path', result: expectError('missing path', () => fs.readFile(`${directory}/missing.bin`)) });
    for (const [label, path] of [['deny traversal', '/project/../escape.txt'], ['deny outside preopen', '/outside/escape.txt']]) {
      checks.push({ label, result: expectError(label, () => fs.writeText(path, 'must not be written'), () => fs.removeFile(path)) });
    }
    for (const path of files) {
      fs.removeFile(path);
      files.delete(path);
      checks.push({ label: `remove file ${path}`, result: expectError('removed file missing', () => fs.readFile(path)) });
    }
    requireCheck(fs.list(directory).length === 0, 'directory empty after file removal');
    fs.removeDir(directory);
    created = false;
    checks.push({ label: 'remove directory', result: expectError('removed directory missing', () => fs.stat(directory)) });
  } finally {
    // Only this run's successfully created paths are owned by these checks.
    for (const path of files) fs.removeFile(path);
    if (created) fs.removeDir(directory);
  }
  requireCheck(snapshot() === before, 'project root unchanged');
  checks.push({ label: 'project root unchanged', result: true });
  return { checks };
}
