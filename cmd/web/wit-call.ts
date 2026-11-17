type Type = string | number;
type Obj = Record<string, any>;
export type WitResources = {
  /** Non-consuming lookup, including own inputs. Integrator validates origin. */
  borrow(ref: unknown, canonicalKind: string): unknown;
  consume(ref: unknown, canonicalKind: string): void;
  /** Integrator supplies returning component/interface origin. */
  own(canonicalKind: string, value: unknown): unknown;
  /** Roll back a public registration if publishing a compound result fails. */
  release(ref: unknown): Promise<void>;
};
const primitives = new Set(['bool','u8','s8','u16','s16','u32','s32','u64','s64','f32','f64','char','string']);
const arrays: Record<string, any> = { u8: Uint8Array, s8: Int8Array, u16: Uint16Array, s16: Int16Array, u32: Uint32Array, s32: Int32Array, u64: BigUint64Array, s64: BigInt64Array, f32: Float32Array, f64: Float64Array };
// Valid WIT identifier parts are ASCII all-lowercase or all-uppercase (plus
// digits). Jco's casing lowercases each part before joining; preserve JSON names.
const camel = (s: string) => s.split('-').map((part, i) => i ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase()).join('');
const pascal = (s: string) => { s = camel(s); return s[0].toUpperCase() + s.slice(1); };
const identifier = (s: string) => s.split('-').every((part, i) => (i ? /^(?:[a-z0-9]+|[A-Z0-9]+)$/ : /^(?:[a-z][a-z0-9]*|[A-Z][A-Z0-9]*)$/).test(part));
const fail = (message: string): never => { throw new Error(message); };
function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`Expected ${label} object`);
  return value as Obj;
}
function index(value: unknown, values: unknown[], label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= values.length) fail(`Invalid WIT ${label} index: ${String(value)}`);
  return value as number;
}
function name(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.length) fail('Invalid WIT name'); }
function entries(value: unknown, label: string): [string, any][] { return Object.entries(object(value, label)); }
type Use = { ref: unknown; kind: string; own: boolean; value: unknown };

/** Validates the actual pinned componentWitJson Resolve graph, not source WIT. */
export class WitCallSchema {
  readonly exports: string[];
  private resolve: Obj;
  private world: Obj;
  constructor(raw: unknown) {
    const root = object(raw, 'WIT metadata');
    const r = this.resolve = object(root.resolve, 'Resolve');
    for (const key of ['worlds','interfaces','types','packages']) if (!Array.isArray(r[key])) fail(`Expected Resolve ${key} array`);
    this.world = r.worlds[index(root.world, r.worlds, 'world')];
    const states = new Map<number, number>();
    const check = (type: unknown): void => {
      if (typeof type === 'string') { if (!primitives.has(type) && type !== 'error-context') fail(`Unknown WIT primitive: ${type}`); return; }
      const id = index(type, r.types, 'type');
      if (states.get(id) === 1) fail(`Cyclic WIT type: ${id}`);
      if (states.get(id) === 2) return;
      states.set(id, 1);
      const node = object(r.types[id], 'type'); const k = node.kind;
      if (node.name !== null) name(node.name);
      if (node.owner !== null) {
        const owner = entries(node.owner, 'type owner');
        if (owner.length !== 1 || !['interface','world'].includes(owner[0][0])) fail('Invalid WIT type owner');
        index(owner[0][1], owner[0][0] === 'interface' ? r.interfaces : r.worlds, 'type owner');
      }
      if (k === 'resource') {
        name(node.name); index(object(node.owner, 'resource owner').interface, r.interfaces, 'resource interface');
      } else {
        const pair = entries(k, 'type kind'); if (pair.length !== 1) fail('Invalid WIT type kind');
        const [tag, body] = pair[0];
        switch (tag) {
          case 'type': case 'list': case 'option': check(body); break;
          case 'record': case 'variant': case 'enum': case 'flags': {
            const items = object(body, tag)[tag === 'record' ? 'fields' : tag === 'flags' ? 'flags' : 'cases'];
            if (!Array.isArray(items)) fail(`Invalid WIT ${tag}`);
            const names = new Set(); const jsNames = new Set();
            for (const item of items) {
              object(item, tag); name(item.name);
              if (names.has(item.name) || (['record', 'flags'].includes(tag) && jsNames.has(camel(item.name)))) fail(`Duplicate WIT ${tag} name: ${item.name}`);
              names.add(item.name); jsNames.add(camel(item.name));
              if (tag === 'record' || (tag === 'variant' && item.type !== null)) check(item.type);
            }
            break;
          }
          case 'tuple': if (!Array.isArray(body.types)) fail('Invalid WIT tuple'); else body.types.forEach(check); break;
          case 'result': object(body, 'result'); for (const side of ['ok','err']) if (body[side] !== null) check(body[side]); break;
          case 'handle': {
            const h = entries(body, 'handle');
            if (h.length !== 1 || !['own','borrow'].includes(h[0][0])) fail('Invalid WIT handle');
            check(h[0][1]); this.resourceId(h[0][1]); break;
          }
          case 'future': case 'stream': if (body !== null) check(body); break;
          default: fail(`Unknown WIT type kind: ${tag}`);
        }
      }
      states.set(id, 2);
    };
    r.types.forEach((_: unknown, id: number) => check(id));
    const checkFunction = (fn: any, key: string) => {
      object(fn, 'function'); if (fn.name !== key) fail('WIT function name mismatch');
      if (!Array.isArray(fn.params)) fail('Invalid WIT parameters');
      const names = new Set();
      for (const p of fn.params) { object(p, 'parameter'); name(p.name); if (names.has(p.name)) fail('Duplicate WIT parameter'); names.add(p.name); check(p.type); }
      if (fn.result !== undefined && fn.result !== null) check(fn.result);
      if (fn.kind !== 'freestanding') {
        const pair = entries(fn.kind, 'function kind');
        if (pair.length !== 1 || !['static','method','constructor'].includes(pair[0][0])) fail('Unsupported WIT function kind');
        const declared = index(pair[0][1], r.types, 'resource function type');
        const id = this.resourceId(declared); const resource = r.types[declared].name; const tag = pair[0][0];
        name(resource);
        if (tag === 'constructor' ? key !== `[constructor]${resource}` : !key.startsWith(`[${tag}]${resource}.`) || !identifier(key.slice(`[${tag}]${resource}.`.length))) fail('WIT resource function name mismatch');
        if (tag === 'constructor' && (fn.result === null || fn.result === undefined || this.kind(fn.result)?.handle?.own === undefined || this.resourceId(this.kind(fn.result).handle.own) !== id)) fail('Invalid WIT constructor result');
        if (tag === 'method' && (!fn.params.length || this.kind(fn.params[0].type)?.handle?.borrow === undefined || this.resourceId(this.kind(fn.params[0].type).handle.borrow) !== id)) fail('Invalid WIT method receiver');
      }
    };
    for (const pkg of r.packages) {
      object(pkg, 'package'); name(pkg.name);
      for (const [, id] of entries(pkg.interfaces, 'package interfaces')) index(id, r.interfaces, 'package interface');
      for (const [, id] of entries(pkg.worlds, 'package worlds')) index(id, r.worlds, 'package world');
    }
    for (const iface of r.interfaces) {
      object(iface, 'interface'); name(iface.name); index(iface.package, r.packages, 'package');
      for (const [, type] of entries(iface.types, 'interface types')) check(type);
      for (const [key, fn] of entries(iface.functions, 'interface functions')) checkFunction(fn, key);
    }
    for (const world of r.worlds) {
      object(world, 'world'); name(world.name);
      if (world.package !== null) index(world.package, r.packages, 'world package');
      for (const side of ['imports','exports']) for (const [key, item] of entries(world[side], `world ${side}`)) {
        const pair = entries(item, 'world item'); if (pair.length !== 1) fail('Invalid WIT world item');
        if (pair[0][0] === 'interface') index(object(item.interface, 'world interface').id, r.interfaces, 'interface');
        else if (pair[0][0] === 'function') checkFunction(item.function, key);
        else if (pair[0][0] === 'type') check(item.type);
        else fail(`Unknown WIT world item: ${pair[0][0]}`);
      }
    }
    this.exports = Object.entries(this.world.exports).map(([key, item]) => (item as Obj).interface ? this.exportName(key, item as Obj) : key);
    if (new Set(this.exports).size !== this.exports.length) fail('Duplicate WIT exports');
  }
  private interfaceName(id: number): string {
    const iface = this.resolve.interfaces[id]; const pkg = this.resolve.packages[iface.package].name as string; const at = pkg.indexOf('@');
    return at < 0 ? `${pkg}/${iface.name}` : `${pkg.slice(0, at)}/${iface.name}${pkg.slice(at)}`;
  }
  private exportName(key: string, item: Obj): string { return key.startsWith('interface-') ? this.interfaceName(item.interface.id) : key; }
  interface(name: string): Obj {
    const entry = Object.entries(this.world.exports).find(([key, item]) => (item as Obj).interface && this.exportName(key, item as Obj) === name);
    if (!entry) fail(`Missing WIT exported interface: ${name}; world functions are unsupported`);
    return this.resolve.interfaces[(entry![1] as Obj).interface.id];
  }
  private deref(type: Type): Type {
    while (typeof type === 'number' && this.resolve.types[type].kind.type !== undefined) type = this.resolve.types[type].kind.type;
    return type;
  }
  private kind(type: Type): any { type = this.deref(type); return typeof type === 'string' ? type : this.resolve.types[type].kind; }
  private resourceId(type: number): number {
    const id = this.deref(type);
    if (typeof id !== 'number' || this.resolve.types[id].kind !== 'resource') return fail('Handle must reference a resource');
    return id;
  }
  private canonical(type: number): string {
    const node = this.resolve.types[this.resourceId(type)]; return `${this.interfaceName(node.owner.interface)}/${node.name}`;
  }
  // Pinned Jco as_nullable/maybe_null: nested option representations alternate.
  private nullable(type: Type): boolean { const k = this.kind(type); return typeof k === 'object' && k.option !== undefined && !this.nullable(k.option); }
  private supported(type: Type, output = false): void {
    const k = this.kind(type);
    if (typeof k === 'string') { if (!primitives.has(k)) fail(`Unsupported WIT value type: ${k}`); return; }
    if (k.handle) { if (output && k.handle.borrow !== undefined) fail('Unsupported borrowed WIT resource result'); return; }
    if (k.list !== undefined || k.option !== undefined) { this.supported(k.list ?? k.option, output); return; }
    if (k.record || k.variant) { for (const field of (k.record?.fields ?? k.variant.cases)) if (field.type !== null) this.supported(field.type, output); return; }
    if (k.tuple) { k.tuple.types.forEach((t: Type) => this.supported(t, output)); return; }
    if (k.result) { for (const t of [k.result.ok,k.result.err]) if (t !== null) this.supported(t, output); return; }
    if (k.enum || k.flags) return;
    fail(`Unsupported WIT value type: ${Object.keys(k)[0]}`);
  }
  private convert(type: Type, value: unknown, input: boolean, resources: WitResources, uses: Use[]): unknown {
    const k = this.kind(type); const cv = (t: Type, v: unknown) => this.convert(t, v, input, resources, uses);
    if (typeof k === 'string') return scalar(k, value, input);
    if (k.handle) {
      const own = k.handle.own !== undefined; const key = this.canonical(own ? k.handle.own : k.handle.borrow);
      if (!input) return resources.own(key, value);
      const resolved = resources.borrow(value, key);
      for (const use of uses) if (use.value === resolved && (use.own || own)) fail('Duplicate owned resource or own/borrow conflict');
      uses.push({ ref: value, kind: key, own, value: resolved }); return resolved;
    }
    if (k.list !== undefined) {
      const element = this.deref(k.list); const ctor = typeof element === 'string' ? arrays[element] : undefined;
      if (input ? !Array.isArray(value) : !(Array.isArray(value) || (ctor && value instanceof ctor))) fail('Expected WIT list array');
      const values = Array.from(value as any, item => cv(k.list, item)); return input && ctor ? new ctor(values) : values;
    }
    if (k.record) {
      const record = object(value, 'record');
      return Object.fromEntries(k.record.fields.map((f: Obj) => {
        const from = input ? f.name : camel(f.name); const to = input ? camel(f.name) : f.name;
        if (!Object.hasOwn(record, from)) fail(`Missing record field: ${from}`);
        return [to, cv(f.type, record[from])];
      }));
    }
    if (k.tuple) {
      if (!Array.isArray(value) || value.length !== k.tuple.types.length) fail('Expected WIT tuple of exact length');
      return k.tuple.types.map((t: Type, i: number) => cv(t, (value as unknown[])[i]));
    }
    if (k.enum) { if (!k.enum.cases.some((c: Obj) => c.name === value)) fail('Unknown WIT enum case'); return value; }
    if (k.flags) {
      const flags = k.flags.flags;
      if (input) {
        if (!Array.isArray(value) || value.some(v => !flags.some((f: Obj) => f.name === v))) fail('Expected valid WIT flags array');
        return Object.fromEntries(flags.map((f: Obj) => [camel(f.name), (value as unknown[]).includes(f.name)]));
      }
      const record = object(value, 'flags');
      return flags.filter((f: Obj) => { const key = camel(f.name); const v = record[key]; if (!Object.hasOwn(record, key) || typeof v !== 'boolean') fail('Expected Jco flag boolean'); return v; }).map((f: Obj) => f.name);
    }
    if (k.option !== undefined) {
      const tagged = this.nullable(k.option);
      if (input) return value === null ? tagged ? { tag: 'none' } : undefined : tagged ? { tag: 'some', val: cv(k.option, value) } : cv(k.option, value);
      if (!tagged) return value === undefined || value === null ? null : cv(k.option, value);
      const option = object(value, 'tagged option');
      if (!Object.hasOwn(option, 'tag')) fail('Expected own Jco option tag');
      if (option.tag === 'none') return null;
      if (option.tag !== 'some' || !Object.hasOwn(option, 'val')) fail('Expected tagged Jco option');
      return cv(k.option, option.val);
    }
    if (k.result) {
      const result = object(value, 'result');
      const side = input ? Object.hasOwn(result, 'ok') !== Object.hasOwn(result, 'err') ? Object.hasOwn(result, 'ok') ? 'ok' : 'err' : fail('Expected exactly one of ok or err') : Object.hasOwn(result, 'tag') && ['ok','err'].includes(result.tag) ? result.tag : fail('Expected Jco result tag');
      const payload = k.result[side];
      if (payload !== null && !Object.hasOwn(result, input ? side : 'val')) fail('Missing result payload');
      const val = payload === null ? input ? undefined : null : cv(payload, result[input ? side : 'val']);
      return input ? payload === null ? { tag: side } : { tag: side, val } : { [side]: val };
    }
    if (k.variant) {
      const variant = object(value, 'variant'); const discriminator = input ? 'case' : 'tag';
      if (!Object.hasOwn(variant, discriminator)) fail('Expected own WIT variant discriminator');
      const tag = variant[discriminator];
      const entry = k.variant.cases.find((c: Obj) => c.name === tag); if (!entry) fail('Unknown WIT variant case');
      const payload = entry.type;
      if (payload !== null && !Object.hasOwn(variant, input ? 'value' : 'val')) fail('Missing variant payload');
      const val = payload === null ? input ? undefined : null : cv(payload, variant[input ? 'value' : 'val']);
      return input ? payload === null ? { tag } : { tag, val } : { case: tag, value: val };
    }
    return fail('Unsupported WIT value type');
  }
  private async host(type: Type, value: unknown, resources: WitResources): Promise<unknown> {
    const owned = new Map<unknown, { count: number; drop?: () => unknown }>();
    // Collect every schema-declared owned value before validating siblings. On
    // malformed compound output even resources after the bad field need dropping.
    const collect = (type: Type, value: unknown): void => {
      const k = this.kind(type);
      if (typeof k === 'string') return;
      if (k.handle) {
        const entry = owned.get(value);
        if (entry) entry.count++;
        else {
          const drop = value && typeof value === 'object' ? (value as Record<symbol, unknown>)[Symbol.dispose || Symbol.for('dispose')] : undefined;
          owned.set(value, { count: 1, drop: typeof drop === 'function' ? drop.bind(value) : undefined });
        }
        return;
      }
      if (k.list !== undefined) {
        if (typeof this.kind(k.list) === 'string') return;
        if (Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView)) for (const item of value as Iterable<unknown>) collect(k.list, item);
      } else if (k.tuple) {
        if (Array.isArray(value)) k.tuple.types.forEach((t: Type, i: number) => collect(t, value[i]));
      } else if (k.record) {
        if (value && typeof value === 'object') for (const f of k.record.fields) if (Object.hasOwn(value, camel(f.name))) collect(f.type, (value as Obj)[camel(f.name)]);
      } else if (k.option !== undefined) {
        if (this.nullable(k.option)) {
          if (value && typeof value === 'object' && Object.hasOwn(value, 'tag') && (value as Obj).tag === 'some' && Object.hasOwn(value, 'val')) collect(k.option, (value as Obj).val);
        } else if (value !== null && value !== undefined) collect(k.option, value);
      } else if ((k.result || k.variant) && value && typeof value === 'object' && Object.hasOwn(value, 'tag')) {
        const tag = (value as Obj).tag;
        const payload = k.result ? ['ok', 'err'].includes(tag) ? k.result[tag] : null : k.variant.cases.find((c: Obj) => c.name === tag)?.type;
        if (payload !== null && payload !== undefined && Object.hasOwn(value, 'val')) collect(payload, (value as Obj).val);
      }
    };
    const registered: Array<{ value: unknown; ref: unknown }> = [];
    try {
      collect(type, value);
      for (const entry of owned.values()) {
        if (!entry.drop) fail('Expected owned component resource with destructor');
        if (entry.count !== 1) fail('Duplicate owned resource in component result');
      }
      this.convert(type, value, false, { ...resources, own: (_kind, value) => value }, []);
      return this.convert(type, value, false, { ...resources, own: (kind, value) => {
        const ref = resources.own(kind, value); registered.push({ value, ref }); return ref;
      } }, []);
    } catch (error) {
      const errors = [error];
      for (const entry of registered.reverse()) {
        owned.delete(entry.value);
        try { await resources.release(entry.ref); } catch (cleanupError) { errors.push(cleanupError); }
      }
      for (const entry of owned.values()) if (entry.drop) {
        try { await entry.drop(); } catch (cleanupError) { errors.push(cleanupError); }
      }
      if (errors.length > 1) throw new AggregateError(errors, `Component result cleanup failed: ${errors.map(String).join('; ')}`);
      throw error;
    }
  }
  /** Full bindings include Jco's _util classifier. Only outermost results throw. */
  async invoke(name: string, method: string, args: unknown[], bindings: Record<string, unknown>, resources: WitResources): Promise<unknown> {
    const iface = this.interface(name); const fn = Object.hasOwn(iface.functions, method) ? iface.functions[method] : undefined;
    if (!fn) fail(`Missing WIT function: ${method}`);
    if (!Array.isArray(args) || args.length !== fn.params.length) fail(`Expected ${fn.params.length} WIT arguments`);
    for (const p of fn.params) this.supported(p.type);
    if (fn.result !== undefined && fn.result !== null) this.supported(fn.result, true);
    const uses: Use[] = []; const values = fn.params.map((p: Obj, i: number) => this.convert(p.type, args[i], true, resources, uses));
    let receiver: any = Object.hasOwn(bindings, name) ? bindings[name] : undefined;
    let callable: any; let construct = false;
    if (fn.kind === 'freestanding') {
      const member = camel(method);
      callable = receiver && Object.hasOwn(receiver, member) ? receiver[member] : undefined;
    } else {
      const [tag, id] = Object.entries(fn.kind)[0]; const resource = this.resolve.types[id as number].name;
      const className = pascal(resource);
      const resourceClass = receiver && Object.hasOwn(receiver, className) ? receiver[className] : undefined;
      if (typeof resourceClass !== 'function') fail(`Missing callable WIT resource class: ${className}`);
      let member = camel(method.slice(method.indexOf('.') + 1));
      if (tag === 'method') {
        receiver = values.shift();
        const prototype = resourceClass.prototype;
        if (!prototype || !receiver || !Object.prototype.isPrototypeOf.call(prototype, receiver)) fail('Invalid WIT resource method receiver');
        callable = Object.hasOwn(prototype, member) ? Object.getOwnPropertyDescriptor(prototype, member)?.value : undefined;
        if (member === 'constructor' && callable === resourceClass) callable = undefined;
      } else {
        receiver = resourceClass; construct = tag === 'constructor';
        if (member === 'prototype') member = 'prototype_';
        callable = construct ? resourceClass : Object.hasOwn(resourceClass, member) ? resourceClass[member] : undefined;
      }
    }
    if (typeof callable !== 'function') fail(`Missing callable WIT export: ${method}`);
    for (const use of uses) if (use.own) resources.consume(use.ref, use.kind);
    const result = fn.result === undefined || fn.result === null ? undefined : this.kind(fn.result);
    let value: unknown;
    try { value = await (construct ? Reflect.construct(callable, values) : callable.apply(receiver, values)); }
    catch (error) {
      const util = bindings._util as { isComponentError(error: unknown): boolean } | undefined;
      if (!result?.result || !util || !util.isComponentError(error)) throw error;
      const ty = result.result.err;
      return { err: ty === null ? null : await this.host(ty, (error as Obj).payload, resources) };
    }
    if (result?.result) return { ok: result.result.ok === null ? null : await this.host(result.result.ok, value, resources) };
    return result === undefined ? null : this.host(fn.result, value, resources);
  }
}
function scalar(type: string, value: unknown, input: boolean): unknown {
  if (type === 'string' || type === 'char') {
    if (typeof value !== 'string' || (type === 'char' && (Array.from(value).length !== 1 || /[\uD800-\uDFFF]/u.test(value)))) fail(`Expected ${type}`);
    return value;
  }
  if (type === 'bool') { if (typeof value !== 'boolean') fail('Expected bool'); return value; }
  if (type === 's64' || type === 'u64') {
    if (!(typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^-?\d+$/.test(value)))) fail(`Expected lossless ${type}`);
    const n = BigInt(value as any); const signed = type === 's64';
    if (n < (signed ? -(1n << 63n) : 0n) || n > (signed ? (1n << 63n) - 1n : (1n << 64n) - 1n)) fail(`Expected ${type} in range`);
    return input ? n : n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`Expected finite ${type}`);
  if (type === 'f32' || type === 'f64') { if (type === 'f32' && !Number.isFinite(Math.fround(value as number))) fail('Expected finite f32'); return type === 'f32' ? Math.fround(value as number) : value; }
  const bits = Number(type.slice(1)); const signed = type[0] === 's';
  if (!Number.isInteger(value) || (value as number) < (signed ? -(2 ** (bits - 1)) : 0) || (value as number) > (signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1)) fail(`Expected ${type} in range`);
  return value;
}
