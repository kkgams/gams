import { assertComponent, instantiateComponent, type TranspiledComponent } from './runtime.ts';
import { projectPath } from './files-call.ts';
import { WitCallSchema } from './wit-call.ts';
import { BrowserResources } from './browser-resources.ts';
import { projectFilesystemAdapter } from './browser-filesystem.ts';
import { normalizePath, type BrowserStore } from './browser-storage.ts';

const OPTIONS = { name: 'component', instantiation: { tag: 'async' }, noTypescript: true, noNodejsCompat: true, base64Cutoff: 0, bindgenEnableWasmExnref: true } as const;
const RUNTIME = 'gams:runtime/runtime@1.0.0';
const CALLBACK_OPTIONS = { asyncMode: { tag: 'jspi', val: { imports: ['gams:runtime/runtime#call'], exports: ['*'] } } } as const;
type CompileOptions = typeof OPTIONS | (typeof OPTIONS & typeof CALLBACK_OPTIONS);
const IDENTITY = { callbacks: CALLBACK_OPTIONS, schema: 2, jco: '1.42.0', backend: '0.24.0', backendBuild: 'kkgams/jco@gams-v0.24.0-1', shim: '0.31.1', options: OPTIONS };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type Handle = { handle: string; path: string; imports: string[]; exports: string[] };
type Instance = { info: Handle; bindings: Record<string, unknown>; schema: WitCallSchema; dispose(): Promise<void> };
type Artifacts = { output: TranspiledComponent; schema: WitCallSchema };
type Injection = { transpile?: (bytes: Uint8Array, options: CompileOptions) => Promise<TranspiledComponent> | TranspiledComponent; schema?: (bytes: Uint8Array) => unknown | Promise<unknown>; instantiate?: typeof instantiateComponent };
const stripVersion = (name: string) => name.replace(/@[^@/]+$/, '');
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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
      !Array.isArray(output.files) || !output.files.every(pair => Array.isArray(pair) && pair.length === 2 && safeFile(pair[0]) && pair[0] !== 'schema.json' && pair[1] instanceof Uint8Array) ||
      new Set(output.files.map(([name]) => name)).size !== output.files.length || !output.files.some(([name]) => name === 'component.js')) throw new Error('Invalid Jco artifacts');
}

function validateSchemaExports(output: TranspiledComponent, schema: WitCallSchema): void {
  const names = output.exports.map(([name]) => name);
  if (schema.exports.some(name => !names.includes(name)) ||
      names.some(name => name.includes(':') && name.includes('/') && !schema.exports.includes(name))) {
    throw new Error('Component schema exports do not match Jco artifacts');
  }
}

/** Worker-owned singleton components; cache contains JS/core Wasm/schema, never native code. */
export class BrowserComponents {
  onEvent?: (event: Record<string, unknown>) => void;
  callView?: (target: string, args: string) => Promise<string>;
  private active = new Set<Instance>();
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
    const { output, schema } = await this.artifacts(bytes, key);
    const capabilities = await this.capabilities(output.imports, schema);
    let bindings;
    try { bindings = await (this.injection.instantiate ?? instantiateComponent)(output, capabilities.imports); }
    catch (error) { await capabilities.dispose(); throw error; }
    const instance: Instance = { info: { handle: `browser-component-${this.nextHandle++}`, path, imports: [...output.imports], exports: output.exports.map(([name]) => name) }, bindings, schema, dispose: capabilities.dispose };
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
  private async artifacts(bytes: Uint8Array, key: string): Promise<Artifacts> {
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
      if (new Set(files.map(([name]) => name)).size !== files.length) throw new Error('Duplicate plugin cache artifacts');
      const schemaBytes = files.find(([name]) => name === 'schema.json')?.[1];
      if (!schemaBytes) throw new Error('Missing plugin cache schema');
      const schema = new WitCallSchema(JSON.parse(decoder.decode(schemaBytes)));
      const output = { files: files.filter(([name]) => name !== 'schema.json'), imports: manifest.imports, exports: manifest.exports }; validateOutput(output); validateSchemaExports(output, schema);
      this.counts.cacheHits++; return { output, schema };
    }
    this.counts.cacheMisses++; this.onEvent?.({ event: 'component-transpiling', key });
    const rawSchema = await this.extractSchema(bytes);
    const schema = new WitCallSchema(rawSchema);
    const options = schema.imports.includes(RUNTIME) ? { ...OPTIONS, ...CALLBACK_OPTIONS } : OPTIONS;
    const output = await (await this.transpiler())(bytes, options); validateOutput(output); validateSchemaExports(output, schema); this.counts.transpilations++;
    try { await this.store.remove(dir); } catch (error) { if (!absent(error)) throw error; }
    await this.store.mkdir(dir);
    const files = [];
    for (const [name, data] of [...output.files, ['schema.json', encoder.encode(JSON.stringify(rawSchema))] as [string, Uint8Array]]) {
      await this.store.write(`${dir}/${name}`, data); files.push({ name, hash: await hash(data) });
    }
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
    return { output, schema };
  }
  private async extractSchema(bytes: Uint8Array): Promise<unknown> {
    if (this.injection.schema) return this.injection.schema(bytes);
    const { componentWitJson } = await import('./component-schema.ts');
    return JSON.parse(await componentWitJson(bytes));
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
  private async capabilities(required: string[], schema: WitCallSchema): Promise<{ imports: Map<string, unknown>; dispose(): Promise<void> }> {
    const imports = new Map<string, unknown>();
    for (const name of required) if (stripVersion(name) === stripVersion(RUNTIME)) {
      // Jco strips this import's version. Never infer its ABI from that key.
      const declared = schema.imports.filter(item => stripVersion(item) === stripVersion(RUNTIME));
      if (declared.length !== 1 || declared[0] !== RUNTIME || name !== stripVersion(RUNTIME) && name !== RUNTIME) throw new Error(`Missing or denied WIT import: ${name}`);
      const functions = schema.interface(RUNTIME, 'imports').functions;
      const call = functions.call;
      const result = call && call.result !== null && call.result !== undefined ? schema.kind(call.result) : null;
      if (Object.keys(functions).length !== 1 || !call || call.kind !== 'freestanding' || call.params.length !== 2 ||
          !call.params.every((p: { type: string | number }) => schema.kind(p.type) === 'string') ||
          !result?.result || result.result.ok === null || result.result.err === null || schema.kind(result.result.ok) !== 'string' || schema.kind(result.result.err) !== 'string') throw new Error('Missing or denied Runtime import ABI: expected call(string, string) -> result<string, string>');
      if (!this.injection.instantiate && (typeof WebAssembly.Suspending !== 'function' || typeof WebAssembly.promising !== 'function')) throw new Error('Runtime callbacks require WebAssembly JSPI support.');
      imports.set(name, { call: async (target: string, args: string) => {
        try { return await this.callback(target, args); }
        catch (error) {
          // A core trap must remain a trap. Other router failures are the
          // declared WIT string error, not arbitrary JS exceptions in the guest.
          if (error instanceof WebAssembly.RuntimeError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          throw Object.assign(new Error(message), { payload: message });
        }
      } });
    }
    const wasi = required.filter(name => !imports.has(name));
    if (!wasi.length) return { imports, dispose: async () => {} };
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
      for (const name of wasi) {
        const base = stripVersion(name);
        if (!allowed.has(base)) throw new Error(`Missing or denied WIT import: ${name}`);
        imports.set(name, allowed.get(base));
      }
    } catch (error) { await fs.dispose(); throw error; }
    return { imports, dispose: () => fs.dispose() };
  }
  private async callback(target: string, args: string): Promise<string> {
    this.assertOpen();
    if (typeof target !== 'string' || typeof args !== 'string') throw new Error('Runtime call target and args must be strings');
    const values = JSON.parse(args);
    if (!Array.isArray(values)) throw new Error('Runtime call args must be a JSON array');
    if (target.includes('::')) {
      let guestFailed = false;
      try { return JSON.stringify(await this.invoke(target, values, () => { guestFailed = true; })); }
      catch (error) {
        // Include non-core guest failures (for example WASI exit). They must
        // abort the linked caller, not masquerade as a recoverable router error.
        if (!guestFailed || error instanceof WebAssembly.RuntimeError) throw error;
        throw new WebAssembly.RuntimeError(error instanceof Error ? error.message : String(error), { cause: error });
      }
    }
    // Dotted names reach only the shared Runtime's registered UI plugins.
    if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(target) || ['constructor','__proto__','prototype'].includes(target.split('.').at(-1)!)) throw new Error(`Missing or denied Runtime target: ${target}`);
    if (!this.callView) throw new Error('View callback bridge is not ready');
    const result = await this.callView(target, args);
    if (typeof result !== 'string') throw new Error('View callback must return a JSON string');
    JSON.parse(result);
    return result;
  }
  async invoke(target: string, args: unknown[], onGuestFailure?: () => void): Promise<unknown> {
    this.assertOpen();
    const match = /^(?:([A-Za-z][A-Za-z0-9-]*):)?([A-Za-z][A-Za-z0-9-]*\/[A-Za-z][A-Za-z0-9-]*)(@[^:]+)?::([A-Za-z][A-Za-z0-9-]*|\[(?:static|method)\][A-Za-z][A-Za-z0-9-]*\.[A-Za-z][A-Za-z0-9-]*|\[constructor\][A-Za-z][A-Za-z0-9-]*)$/.exec(target);
    if (!match || !Array.isArray(args)) throw new Error(`Invalid or unsupported resource target: ${target}`);
    const [, namespace, short, version, method] = match;
    const candidates: Array<{ instance: Instance; name: string }> = [];
    for (const instance of this.instances.values()) for (const name of instance.info.exports) {
      if (stripVersion(name).replace(/^[^:]+:/, '') !== short ||
          (namespace && !name.startsWith(`${namespace}:`)) || (version && !name.endsWith(version))) continue;
      candidates.push({ instance, name });
    }
    if (candidates.length !== 1) throw new Error(`${candidates.length ? 'Ambiguous' : 'Missing'} exported interface: ${target}`);
    const { instance, name } = candidates[0];
    let values = args;
    // Filesystem paths are a Host semantic policy, not a property of WIT strings.
    // Keep this boundary explicit; generic conversion must not rewrite payload text.
    if (name === 'gams:fs/fs@1.2.0') {
      const pathMethods = ['read-file', 'read-text', 'write-file', 'write-text', 'list', 'stat', 'create-dir', 'remove-file', 'remove-dir', 'rename'];
      if (!pathMethods.includes(method)) throw new Error(`Unsupported filesystem target: ${target}`);
      values = [...args];
      for (const index of method === 'rename' ? [0, 1] : [0]) {
        const path = projectPath(values[index]);
        normalizePath(path);
        values[index] = path === '/project/gams_modules' || path.startsWith('/project/gams_modules/') ? path.slice('/project/'.length) : path;
      }
    }
    if (this.active.has(instance)) throw new Error(`Component is already active; cyclic reentrant call denied: ${target}`);
    this.active.add(instance);
    try {
      return await instance.schema.invoke(name, method, values, instance.bindings, {
        borrow: (ref, kind) => this.resources.borrow(ref, instance, kind),
        consume: (ref, kind) => this.resources.consume(ref, instance, kind),
        own: (kind, value) => this.resources.own(instance, stripVersion(name), kind, value),
        release: ref => this.resources.release(ref),
      }, onGuestFailure);
    } finally { this.active.delete(instance); }
  }
  async releaseResource(ref: unknown): Promise<void> {
    this.assertOpen(); await this.resources.release(ref, this.active);
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
        if (!(file === 'manifest.json' || file === 'complete' || file === 'schema.json' || /^component(?:\.core\d*)?\.(?:js|wasm)$/.test(file)) || await this.store.stat(`${directory}/${file}`) !== 'file') {
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
