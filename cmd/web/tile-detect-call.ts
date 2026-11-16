// Exact gams:tile-detect/tile-detect@1.0.0 input schemas, not inferred Jco metadata.
type Input = (value: unknown) => unknown;
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
function uint32(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4294967295) throw new Error('Expected tile-detect u32');
  return value;
}
function hash(value: unknown): bigint {
  if (!(typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value)))) throw new Error('Expected lossless tile hash u64');
  const integer = BigInt(value);
  if (integer < 0n || integer > 18446744073709551615n) throw new Error('Expected tile hash u64 in range');
  return integer;
}
function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (!Array.isArray(value)) throw new Error('Expected tile-detect byte list');
  return Uint8Array.from(value, byte => {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('Expected tile-detect integer byte in range 0..255');
    return byte;
  });
}
function ids(value: unknown): Uint32Array {
  if (value instanceof Uint32Array) return value;
  if (!Array.isArray(value)) throw new Error('Expected tile-detect u32 list');
  return Uint32Array.from(value, uint32);
}
function list(item: Input): Input {
  return value => {
    if (!Array.isArray(value)) throw new Error('Expected tile-detect list');
    return Array.from(value, item);
  };
}
function record(fields: Record<string, Input>): Input {
  return value => {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected tile-detect record');
    return Object.fromEntries(Object.entries(fields).map(([key, convert]) => {
      if (!Object.hasOwn(value, key)) throw new Error(`Missing tile-detect record field: ${key}`);
      return [camel(key), convert(value[key])];
    }));
  };
}
const tilebank = list(record({ id: uint32, 'source-index': uint32, hash }));
const tilemap = record({ width: uint32, height: uint32, 'tile-w': uint32, 'tile-h': uint32, data: ids });
const calls = new Map<string, Input[]>([
  ['detect-size', [bytes, uint32, uint32]],
  ['extract', [record({ 'source-data': bytes, 'tile-w': uint32, 'tile-h': uint32, tolerance: uint32, 'skip-nth-pixel': uint32 })]],
  ['export-tileset', [record({ tilebank, 'source-data': bytes, 'source-cols': uint32, 'tile-w': uint32, 'tile-h': uint32 })]],
  ['to-tilemap', [record({ tilebank, tilemap })]],
]);
export function prepareTileDetectCall(method: string, args: unknown[]): unknown[] {
  const inputs = calls.get(method);
  if (!inputs) throw new Error(`Unsupported tile-detect method: ${method}`);
  if (!Array.isArray(args) || args.length !== inputs.length) throw new Error(`tile-detect ${method} requires ${inputs.length} arguments`);
  return inputs.map((convert, index) => convert(args[index]));
}
