import { filesystemHostValue } from './files-call.ts';

type Kind = 'connection' | 'statement' | 'error';
type Borrow = (ref: unknown, kind: Kind) => object;
type SqlCall = { result: boolean; resource?: Kind; call(owner: unknown): unknown };
type Spec = { arity: number; resource?: Kind; className?: 'Connection' | 'Statement'; member: string };
const calls = new Map<string, Spec>([
  ['sql/types::[static]connection.open', { arity: 1, resource: 'connection', className: 'Connection', member: 'open' }],
  ['sql/types::[static]statement.prepare', { arity: 2, resource: 'statement', className: 'Statement', member: 'prepare' }],
  ['sql/types::[method]error.trace', { arity: 1, resource: undefined, className: undefined, member: 'trace' }],
  ['sql/readwrite::query', { arity: 2, resource: undefined, className: undefined, member: 'query' }],
  ['sql/readwrite::exec', { arity: 2, resource: undefined, className: undefined, member: 'exec' }],
]);

/** Exact wasi:sql@0.2.0-draft dispatch; never interpret arbitrary resource syntax. */
export function prepareSqlCall(short: string, method: string, args: unknown[], borrow: Borrow): SqlCall {
  const target = `${short}::${method}`;
  const spec = calls.get(target);
  if (!spec) throw new Error(`Unsupported SQL target: ${target}`);
  if (args.length !== spec.arity) throw new Error(`${target} requires ${spec.arity} arguments`);
  let values: unknown[];
  let receiver: unknown;
  if (spec.className) {
    if (typeof args[0] !== 'string') throw new Error('Expected SQL string');
    values = [args[0]];
    if (spec.className === 'Statement') {
      if (!Array.isArray(args[1]) || !args[1].every(value => typeof value === 'string')) throw new Error('Expected SQL string parameters');
      values.push([...args[1]]);
    }
  } else if (spec.member === 'trace') {
    receiver = borrow(args[0], 'error'); values = [];
  } else {
    values = [borrow(args[0], 'connection'), borrow(args[1], 'statement')];
  }
  return {
    result: spec.member !== 'trace', resource: spec.resource,
    call(owner: unknown) {
      let object = receiver ?? owner;
      if (spec.className) {
        if (!object || typeof object !== 'object' || !Object.hasOwn(object, spec.className)) throw new Error(`Missing SQL resource class: ${spec.className}`);
        object = (object as Record<string, unknown>)[spec.className];
      }
      // Jco resource methods live on the resource prototype and require their actual receiver.
      const fn = object && (object as Record<string, unknown>)[spec.member];
      if (typeof fn !== 'function') throw new Error(`Missing callable SQL export: ${target}`);
      return fn.apply(object, values);
    },
  };
}

const payloadCases = new Set(['int32', 'int64', 'uint32', 'uint64', 'float', 'double', 'str', 'boolean', 'date', 'time', 'timestamp', 'binary']);
/** Jco variants use tag/val; Native JSON uses case/value, including null's payload. */
export function sqlHostValue(method: string, value: unknown): unknown {
  if (method !== 'query') return filesystemHostValue(value);
  if (!Array.isArray(value)) throw new Error('Expected SQL cells');
  return value.map(cell => {
    if (!cell || typeof cell !== 'object' || typeof cell.fieldName !== 'string' || !cell.value || typeof cell.value !== 'object') throw new Error('Expected SQL row cell');
    const variant = cell.value;
    if (variant.tag !== 'null' && (!payloadCases.has(variant.tag) || !Object.hasOwn(variant, 'val'))) throw new Error('Expected SQL data-type variant');
    return { 'field-name': cell.fieldName, value: { case: variant.tag, value: variant.tag === 'null' ? null : filesystemHostValue(variant.val) } };
  });
}
