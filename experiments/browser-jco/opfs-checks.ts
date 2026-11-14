type Instance = Record<string, unknown>;
type Action = 'write' | 'read' | 'rename' | 'delete' | 'absent';
type State = 'original' | 'renamed' | 'absent';
interface Filesystem {
  createDir(path: string): void;
  writeText(path: string, text: string): void;
  readText(path: string): string;
  writeFile(path: string, bytes: Uint8Array): void;
  readFile(path: string): Uint8Array;
  list(path: string): { name: string; type: string }[];
  stat(path: string): { type: string; size: bigint };
  rename(source: string, target: string): void;
  removeFile(path: string): void;
  removeDir(path: string): void;
}

const DIRECTORY = '/project/opfs-persistence-check';
const TEXT = 'Hello, persistent 世界! 🌍\n';
const BYTES = [0, 1, 127, 128, 254, 255] as const;
const ORIGINAL = 'text.txt';
const RENAMED = 'saved.txt';
const BINARY = 'bytes.bin';

function requireCheck(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Persistence check failed: ${label}`);
}

// Only the exact WIT no-entry string is absence, never a trap or adapter error.
function expectAbsent(operation: () => unknown, label: string): void {
  try {
    operation();
  } catch (error) {
    const payload = typeof error === 'string' ? error :
      error !== null && typeof error === 'object' && 'payload' in error ? error.payload : undefined;
    requireCheck(payload === 'no-entry', `${label}: expected WIT no-entry`);
    return;
  }
  throw new Error(`Persistence check failed: ${label}: expected WIT no-entry`);
}

export function runPersistenceCheck(instance: Instance, action: Action) {
  requireCheck(['write', 'read', 'rename', 'delete', 'absent'].includes(action), 'unknown action');
  const value = instance['gams:fs/fs@1.2.0'];
  requireCheck(typeof value === 'object' && value !== null, 'missing interface gams:fs/fs@1.2.0');
  for (const method of ['createDir', 'writeText', 'readText', 'writeFile', 'readFile', 'list', 'stat', 'rename', 'removeFile', 'removeDir']) {
    requireCheck(typeof (value as Record<string, unknown>)[method] === 'function', `missing gams:fs/fs@1.2.0.${method}`);
  }
  const fs = value as Filesystem;
  const path = (name: string) => `${DIRECTORY}/${name}`;
  const report = (state: State) => ({
    check: 'opfs-persistence', action, state, directory: DIRECTORY,
    files: state === 'absent' ? [] : [BINARY, state === 'original' ? ORIGINAL : RENAMED],
  });
  const validate = (): 'original' | 'renamed' => {
    requireCheck(fs.stat(DIRECTORY).type === 'directory', 'fixture directory');
    const entries = fs.list(DIRECTORY).slice().sort((a, b) => a.name.localeCompare(b.name));
    requireCheck(entries.length === 2 && entries.every(entry => entry.type === 'regular-file') &&
      entries[0].name === BINARY && [ORIGINAL, RENAMED].includes(entries[1].name), 'exact fixture layout');
    const name = entries[1].name;
    requireCheck(fs.readText(path(name)) === TEXT, 'UTF-8 fixture contents');
    const textStat = fs.stat(path(name));
    requireCheck(textStat.type === 'regular-file' && textStat.size === BigInt(new TextEncoder().encode(TEXT).length), 'UTF-8 fixture byte size');
    const bytes = fs.readFile(path(BINARY));
    requireCheck(bytes instanceof Uint8Array && bytes.length === BYTES.length && BYTES.every((byte, i) => byte === bytes[i]), 'binary fixture contents');
    const binaryStat = fs.stat(path(BINARY));
    requireCheck(binaryStat.type === 'regular-file' && binaryStat.size === BigInt(BYTES.length), 'binary fixture byte size');
    return name === ORIGINAL ? 'original' : 'renamed';
  };

  if (action === 'absent') {
    expectAbsent(() => fs.stat(DIRECTORY), 'fixture directory absent');
    return report('absent');
  }
  if (action === 'write') {
    requireCheck(!fs.list('/project').some(entry => entry.name === 'opfs-persistence-check'), 'fixture directory must not already exist');
    expectAbsent(() => fs.stat(DIRECTORY), 'fixture directory must not already exist');
    fs.createDir(DIRECTORY);
    fs.writeText(path(ORIGINAL), TEXT);
    fs.writeFile(path(BINARY), new Uint8Array(BYTES));
    return report(validate());
  }

  const state = validate();
  if (action === 'read') return report(state);
  if (action === 'rename') {
    requireCheck(state === 'original', 'rename requires original fixture');
    fs.rename(path(ORIGINAL), path(RENAMED));
    expectAbsent(() => fs.stat(path(ORIGINAL)), 'old text path absent');
    requireCheck(validate() === 'renamed', 'renamed fixture');
    return report('renamed');
  }

  // Validation above refuses unknown files or modified contents before any deletion.
  fs.removeFile(path(state === 'original' ? ORIGINAL : RENAMED));
  fs.removeFile(path(BINARY));
  requireCheck(fs.list(DIRECTORY).length === 0, 'fixture directory empty');
  fs.removeDir(DIRECTORY);
  expectAbsent(() => fs.stat(DIRECTORY), 'deleted fixture directory absent');
  return report('absent');
}
