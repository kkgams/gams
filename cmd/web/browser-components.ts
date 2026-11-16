import { assertComponent, instantiateComponent, type TranspiledComponent } from './runtime.ts';
import { prepareFilesystemCall, filesystemHostValue } from './files-call.ts';
import { prepareTileDetectCall } from './tile-detect-call.ts';
import { prepareImageCall } from './image-call.ts';
import { prepareSqlCall, sqlHostValue } from './sql-call.ts';
import { BrowserResources } from './browser-resources.ts';
import { projectFilesystemAdapter } from './browser-filesystem.ts';
import { normalizePath, type BrowserStore } from './browser-storage.ts';

const OPTIONS = { name: 'component', instantiation: { tag: 'async' }, noTypescript: true, noNodejsCompat: true, base64Cutoff: 0 } as const;
const IDENTITY = { schema: 1, jco: '1.42.0', backend: '0.24.0', shim: '0.31.1', options: OPTIONS };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type Handle = { handle: string; path: string; imports: string[]; exports: string[] };
type Instance = { info: Handle; bindings: Record<string, unknown>; dispose(): Promise<void> };
type Injection = { transpile?: (bytes: Uint8Array, options: typeof OPTIONS) => Promise<TranspiledComponent> | TranspiledComponent; instantiate?: typeof instantiateComponent };
const stripVersion = (name: string) => name.replace(/@[^@/]+$/, '');
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const absent = (error: unknown) => (error as { code?: string })?.code === 'ENOENT';
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function safeFile(name: string): boolean {
  return typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/.test(name) && !['.', '..', 'manifest.json', 'complete'].includes(name);
}
function validateOutput(output: TranspiledComponent): void {
  if (!Array.isArray(output.imports) || !output.imports.every(name => typeof name === 'string') ||
      !Array.isArray(output.exports) || !output.exports.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && ['instance', 'function'].includes(pair[1])) ||
      !Array.isArray(output.files) || !output.files.every(pair => Array.isArray(pair) && pair.length === 2 && safeFile(pair[0]) && pair[1] instanceof Uint8Array) ||
      new Set(output.files.map(([name]) => name)).size !== output.files.length || !output.files.some(([name]) => name === 'component.js')) throw new Error('Invalid Jco artifacts');
}

/** Worker-owned singleton components; cache contains JS/core Wasm, never native code. */
export class BrowserComponents {
  onEvent?: (event: Record<string, unknown>) => void;
  private instances = new Map<string, Instance>();
  private resources = new BrowserResources();
  private compiler?: Promise<NonNullable<Injection['transpile']>>;
  private counts = { cacheHits: 0, cacheMisses: 0, transpilations: 0 };
  private closed = false;
  private nextHandle = 1;
  private cwd: string;
  private modulesDir: string;
  private cacheDir: string;
  private store: BrowserStore;
  private injection: Injection;
  constructor(store: BrowserStore, options: { cwd: string; modulesDir: string; pluginCacheDir: string }, injection: Injection = {}) {
    this.store = store; this.injection = injection;
    this.cwd = normalizePath(options.cwd); this.modulesDir = normalizePath(options.modulesDir); this.cacheDir = normalizePath(options.pluginCacheDir);
    if (this.cacheDir === '/' || [this.cwd, this.modulesDir].some(path => path === this.cacheDir || path.startsWith(`${this.cacheDir}/`))) throw new Error('Plugin cache must not contain Project or modules roots');
  }
  async add(paths: string[], reload = false): Promise<Handle[]> {
    this.assertOpen();
    const handles: Handle[] = [];
    for (const path of paths) {
      const absolute = this.sourcePath(path);
      const existing = this.instances.get(absolute);
      handles.push(existing && !reload ? this.info(existing) : await this.load(await this.store.read(absolute), absolute, reload));
    }
    return handles;
  }
  async loadFromBytes(bytes: Uint8Array, path: string): Promise<Handle> {
    this.assertOpen(); return this.load(bytes, this.sourcePath(path), false);
  }
  private async load(bytes: Uint8Array, path: string, reload: boolean): Promise<Handle> {
    const previous = this.instances.get(path);
    if (previous && !reload) return this.info(previous);
    assertComponent(bytes);
    const prefix = encoder.encode(JSON.stringify(IDENTITY));
    const keyed = new Uint8Array(prefix.length + bytes.length); keyed.set(prefix); keyed.set(bytes, prefix.length);
    const key = await hash(keyed);
    const output = await this.artifacts(bytes, key);
    const capabilities = await this.capabilities(output.imports);
    let bindings;
    try { bindings = await (this.injection.instantiate ?? instantiateComponent)(output, capabilities.imports); }
    catch (error) { await capabilities.dispose(); throw error; }
    const instance: Instance = { info: { handle: `browser-component-${this.nextHandle++}`, path, imports: [...output.imports], exports: output.exports.map(([name]) => name) }, bindings, dispose: capabilities.dispose };
    if (previous) {
      this.instances.delete(path);
      try { await this.dispose(previous); }
      catch (error) {
        try { await this.dispose(instance); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], `Component replacement cleanup failed: ${String(error)}; ${String(cleanupError)}`); }
        throw error;
      }
    }
    this.instances.set(path, instance); this.onEvent?.({ event: 'component-loaded', path, key });
    return this.info(instance);
  }
  private async artifacts(bytes: Uint8Array, key: string): Promise<TranspiledComponent> {
    const dir = `${this.cacheDir}/${key}`;
    let complete: Uint8Array | undefined;
    try { complete = await this.store.read(`${dir}/complete`); } catch (error) { if (!absent(error)) throw error; }
    if (complete) {
      // Corrupt completed entries fail loudly; clearCache explicitly permits recompilation.
      const manifestBytes = await this.store.read(`${dir}/manifest.json`);
      if (decoder.decode(complete) !== await hash(manifestBytes)) throw new Error(`Corrupt plugin cache marker: ${key}`);
      const manifest = JSON.parse(decoder.decode(manifestBytes));
      if (JSON.stringify(manifest.identity) !== JSON.stringify(IDENTITY) || !Array.isArray(manifest.files)) throw new Error(`Invalid plugin cache manifest: ${key}`);
      const files: Array<[string, Uint8Array]> = [];
      for (const file of manifest.files) {
        if (!safeFile(file.name)) throw new Error('Unsafe plugin cache filename');
        const data = await this.store.read(`${dir}/${file.name}`);
        if (await hash(data) !== file.hash) throw new Error(`Corrupt plugin cache artifact: ${file.name}`);
        files.push([file.name, data]);
      }
      const output = { files, imports: manifest.imports, exports: manifest.exports }; validateOutput(output);
      this.counts.cacheHits++; return output;
    }
    this.counts.cacheMisses++; this.onEvent?.({ event: 'component-transpiling', key });
    const output = await (await this.transpiler())(bytes, OPTIONS); validateOutput(output); this.counts.transpilations++;
    try { await this.store.remove(dir); } catch (error) { if (!absent(error)) throw error; }
    await this.store.mkdir(dir);
    const files = [];
    for (const [name, data] of output.files) { await this.store.write(`${dir}/${name}`, data); files.push({ name, hash: await hash(data) }); }
    const manifest = encoder.encode(JSON.stringify({ identity: IDENTITY, imports: output.imports, exports: output.exports, files }));
    await this.store.write(`${dir}/manifest.json`, manifest);
    await this.store.flush(); // Artifacts durable before marker exists.
    await this.store.write(`${dir}/complete`, encoder.encode(await hash(manifest)));
    try { await this.store.flush(); }
    catch (error) {
      // A failed durable acknowledgement must not leave a reusable in-memory marker.
      await this.store.remove(`${dir}/complete`);
      throw error;
    }
    return output;
  }
  private async transpiler(): Promise<NonNullable<Injection['transpile']>> {
    if (this.injection.transpile) return this.injection.transpile;
    this.compiler ??= (async () => {
      const api = await import('@bytecodealliance/jco/component');
      const backend = await import('@bytecodealliance/jco-transpile/component'); await backend.$init;
      return api.transpile;
    })();
    return this.compiler;
  }
  private async capabilities(required: string[]): Promise<{ imports: Map<string, unknown>; dispose(): Promise<void> }> {
    const imports = new Map<string, unknown>();
    // Injected native tests need no package ecosystem; real instances have isolated FS handles.
    if (!required.length && this.injection.instantiate) return { imports, dispose: async () => {} };
    const { createFilesystem, InMemoryFilesystemAdapter } = await import('@bytecodealliance/preview2-shim/filesystem');
    const root = this.store.entry(this.cwd);
    // C/WASI libc resolves relative paths through a dot preopen, not initialCwd.
    const fs = createFilesystem({ adapter: projectFilesystemAdapter(new InMemoryFilesystemAdapter()), preopens: { '.': root, '/project': root, 'gams_modules': this.store.entry(this.modulesDir) } });
    try {
      const shim = await import('@bytecodealliance/preview2-shim');
      const cli = shim.cli.createCli({ environment: {}, arguments: [], initialCwd: '/project' });
      const allowed = new Map<string, unknown>([
        ['wasi:filesystem/types', fs.types], ['wasi:filesystem/preopens', fs.preopens],
        ['wasi:io/error', shim.io.error], ['wasi:io/poll', shim.io.poll], ['wasi:io/streams', shim.io.streams],
        ['wasi:clocks/monotonic-clock', shim.clocks.monotonicClock], ['wasi:clocks/wall-clock', shim.clocks.wallClock],
        ['wasi:random/random', shim.random.random], ['wasi:random/insecure', shim.random.insecure], ['wasi:random/insecure-seed', shim.random.insecureSeed],
        ...['environment', 'exit', 'stdin', 'stdout', 'stderr', 'terminal-input', 'terminal-output', 'terminal-stdin', 'terminal-stdout', 'terminal-stderr'].map(name => [`wasi:cli/${name}`, cli[camel(name)]] as [string, unknown]),
      ]);
      for (const name of required) {
        const base = stripVersion(name);
        if (!allowed.has(base)) throw new Error(`Missing or denied WIT import: ${name}`);
        imports.set(name, allowed.get(base));
      }
    } catch (error) { await fs.dispose(); throw error; }
    return { imports, dispose: () => fs.dispose() };
  }
  async invoke(target: string, args: unknown[]): Promise<unknown> {
    this.assertOpen();
    const match = /^(?:(gams|wasi):)?([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)(@[^:]+)?::([a-z][a-z0-9-]*|\[(?:static|method)\][a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)$/.exec(target);
    if (!match || !Array.isArray(args)) throw new Error(`Invalid or unsupported resource target: ${target}`);
    const [, namespace, short, version, method] = match;
    const candidates: Array<{ instance: Instance; name: string }> = [];
    for (const instance of this.instances.values()) for (const name of instance.info.exports) if (stripVersion(name).replace(/^[^:]+:/, '') === short) candidates.push({ instance, name });
    if (candidates.length !== 1) throw new Error(`${candidates.length ? 'Ambiguous' : 'Missing'} exported interface: ${short}`);
    const { instance, name } = candidates[0];
    // Jco metadata has only function/instance, not result schemas. Never guess unknown ABIs.
    const tileDetect = name === 'gams:tile-detect/tile-detect@1.0.0';
    const image = name === 'gams:image/image@1.0.0';
    const sql = name === 'wasi:sql/types@0.2.0-draft' || name === 'wasi:sql/readwrite@0.2.0-draft';
    if (sql && ((namespace && namespace !== 'wasi') || (version && !name.endsWith(version)))) throw new Error(`Unsupported SQL interface: ${target}`);
    const result = name === 'gams:fs/fs@1.2.0' || name === 'gams:layout/layout@1.0.0' || tileDetect || image || sql;
    const raw = name === 'gams:random/seeded-random@1.0.0' || name === 'wasi:random/random@0.2.0';
    if (!result && !raw) throw new Error(`No Host ABI adapter for ${name}; arbitrary WIT schemas are unsupported`);
    const sqlCall = sql ? prepareSqlCall(short, method, args, (ref, kind) => this.resources.borrow(ref, instance, kind)) : undefined;
    let values = args;
    let ownedImage = false;
    if (image) {
      const call = prepareImageCall(method, args, ref => this.resources.borrow(ref, instance, 'image'));
      values = call.values; ownedImage = call.resource;
    } else if (short === 'fs/fs') {
      const call = prepareFilesystemCall(`${short}::${method}`, args); values = [...call.values];
      for (const index of method === 'rename' ? [0, 1] : [0]) {
        const path = values[index] as string;
        // BrowserStore and guest FS must reject the same inherited-object segments.
        normalizePath(path);
        if (path === '/project/gams_modules' || path.startsWith('/project/gams_modules/')) values[index] = path.slice('/project/'.length);
      }
    } else if (tileDetect) values = prepareTileDetectCall(method, args);
    else if (short === 'layout/layout') values = args.map(layoutInput);
    else if (method === 'set-seed' || method === 'get-random-bytes') values = args.map(u64);
    const owner = Object.hasOwn(instance.bindings, name) ? instance.bindings[name] : undefined;
    const fn = owner && typeof owner === 'object' && Object.hasOwn(owner, camel(method)) ? owner[camel(method)] : undefined;
    if (!sqlCall && typeof fn !== 'function') throw new Error(`Missing callable export: ${target}`);
    try {
      const value = sqlCall ? await sqlCall.call(owner) : await (fn as (...values: unknown[]) => unknown)(...values);
      if (sqlCall) {
        const host = sqlCall.resource ? this.resources.own(instance, stripVersion(name), sqlCall.resource, value) : sqlHostValue(method, value);
        return sqlCall.result ? { ok: host } : host;
      }
      const host = ownedImage ? this.resources.own(instance, stripVersion(name), 'image', value) : hostValue(value, short === 'layout/layout' || tileDetect || image, tileDetect);
      return result ? { ok: host } : host;
    } catch (error) {
      const util = instance.bindings._util as { isComponentError(error: unknown): boolean } | undefined;
      if (!result || (sqlCall && !sqlCall.result) || !util || !util.isComponentError(error)) throw error;
      if (sqlCall) return { err: this.resources.own(instance, stripVersion(name), 'error', (error as { payload: unknown }).payload) };
      return { err: hostValue((error as { payload: unknown }).payload, short === 'layout/layout' || tileDetect, tileDetect) };
    }
  }
  async releaseResource(ref: unknown): Promise<void> {
    this.assertOpen(); await this.resources.release(ref);
  }
  async diagnostics() { return { ...this.counts, jsonResourceRefs: this.resources.size, cacheDir: this.cacheDir, instances: [...this.instances.values()].map(instance => this.info(instance)), closed: this.closed }; }
  async clearCache(): Promise<void> {
    this.assertOpen();
    let names: string[];
    try { names = await this.store.list(this.cacheDir); } catch (error) { if (absent(error)) return; throw error; }
    const owned: string[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const directory = `${this.cacheDir}/${name}`;
      if (await this.store.stat(directory) !== 'directory') throw new Error('Refusing non-directory plugin cache entry');
      for (const file of await this.store.list(directory)) {
        if (!(file === 'manifest.json' || file === 'complete' || /^component(?:\.core\d*)?\.(?:js|wasm)$/.test(file)) || await this.store.stat(`${directory}/${file}`) !== 'file') {
          throw new Error(`Refusing unfamiliar plugin cache artifact: ${file}`);
        }
      }
      owned.push(directory);
    }
    for (const directory of owned) await this.store.remove(directory);
    await this.store.flush();
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const [path, instance] of this.instances) {
      this.instances.delete(path);
      try { await this.dispose(instance); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `Component shutdown failed: ${errors.map(String).join('; ')}`);
  }
  private async dispose(instance: Instance): Promise<void> {
    const util = instance.bindings._util as { whenIdle(): Promise<void>; stop(): void } | undefined;
    const errors: unknown[] = [];
    // Drop public resources while their guest is live, then stop it and release WASI handles.
    // One failed destructor must not skip the other resources or teardown phases.
    for (const cleanup of [
      async () => { if (util) await util.whenIdle(); },
      () => this.resources.releaseOwner(instance),
      () => { if (util) util.stop(); },
      () => instance.dispose(),
    ]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `Component teardown failed (${instance.info.path}): ${errors.map(String).join('; ')}`);
  }
  private info(instance: Instance): Handle { return { ...instance.info, imports: [...instance.info.imports], exports: [...instance.info.exports] }; }
  private sourcePath(path: string): string {
    if (path === 'gams_modules' || path.startsWith('gams_modules/')) {
      const absolute = normalizePath(path.slice('gams_modules'.length).replace(/^\//, ''), this.modulesDir);
      if (absolute !== this.modulesDir && !absolute.startsWith(`${this.modulesDir}/`)) throw new Error('Module source escapes modulesDir');
      return absolute;
    }
    return normalizePath(path, this.cwd);
  }
  private assertOpen(): void { if (this.closed) throw new Error('BrowserComponents is closed'); }
}
function u64(value: unknown): bigint {
  if (!(typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value)))) throw new Error('Expected lossless u64');
  const integer = BigInt(value); if (integer < 0n || integer > 18446744073709551615n) throw new Error('Expected u64 in range'); return integer;
}
function layoutInput(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(layoutInput);
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Expected layout record');
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [camel(key), key === 'generation' ? u64(field) : layoutInput(field)]));
  }
  return value;
}
function hostValue(value: unknown, witFields: boolean, uint32Lists = false): unknown {
  const plain = filesystemHostValue(value, uint32Lists); if (!witFields) return plain;
  function fields(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(fields);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [kebab(key), fields(field)]));
    return value;
  }
  return fields(plain);
}
