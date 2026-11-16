// Exact gams:image/image@1.0.0 subset; resource ownership belongs to the manager.
type Input = (value: unknown) => unknown;

function integer(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected image ${name} in range ${min}..${max}`);
  }
  return value;
}
const u32: Input = value => integer(value, 0, 4294967295, 'u32');
const s32: Input = value => integer(value, -2147483648, 2147483647, 's32');
const u8: Input = value => integer(value, 0, 255, 'u8');

function record(value: unknown, fields: string[], convert: Input): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Expected image record');
  }
  return Object.fromEntries(fields.map(field => {
    if (!Object.hasOwn(value, field)) throw new Error(`Missing image record field: ${field}`);
    return [field, convert((value as Record<string, unknown>)[field])];
  }));
}

const calls = new Map([
  ['create', { arity: 3, resource: true }],
  ['info', { arity: 1, resource: false }],
  ['crop', { arity: 2, resource: true }],
  ['export', { arity: 2, resource: false }],
]);

export function prepareImageCall(method: string, args: unknown[], borrow: (ref: unknown) => unknown): { values: unknown[]; resource: boolean } {
  const call = calls.get(method);
  if (!call) throw new Error(`Unsupported image method: ${method}`);
  if (!Array.isArray(args) || args.length !== call.arity) {
    throw new Error(`image ${method} requires ${call.arity} arguments`);
  }
  let values: unknown[];
  if (method === 'create') {
    values = [u32(args[0]), u32(args[1]), args[2] == null ? undefined : record(args[2], ['r', 'g', 'b', 'a'], u8)];
  } else if (method === 'crop') {
    values = [borrow(args[0]), record(args[1], ['x0', 'y0', 'x1', 'y1'], s32)];
  } else if (method === 'export') {
    if (args[1] !== 'png' && args[1] !== 'qoi') throw new Error('Expected image format png or qoi');
    values = [borrow(args[0]), args[1]];
  } else {
    values = [borrow(args[0])];
  }
  return { values, resource: call.resource };
}
