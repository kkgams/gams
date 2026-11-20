import { normalizePath } from './browser-path.ts';
import { validateCorsProxy, type ProjectOptions } from './browser-options.ts';

export interface Store {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<'file' | 'directory'>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  publishResource?(from: string, to: string): Promise<void>;
  flush(): Promise<void>;
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectJson = { [key: string]: Json };
export interface ZipMember {
  name: string; directory?: boolean; bytes?: Uint8Array; size?: number;
  encrypted?: boolean; symlink?: boolean; mode?: number; crc32?: number;
}
type DownloadProgress = { downloaded: number; total: number | null };
export type ProjectDependencies = {
  download?: (url: string, progress?: (value: DownloadProgress) => void) => Promise<Uint8Array>;
  unzip?: (bytes: Uint8Array) => Promise<ZipMember[]>;
};
type ResourceEvent = {
  operationId: number; resource: string; phase: string; completed: number;
  total: number | null; unit: 'bytes' | 'entries' | null; cached: boolean;
  entry: string | null; error: string | null;
};
export type ResolutionProgress = {
  operationId: string; status: 'resolving' | 'ready' | 'failed'; discovered: number;
  completed: number; resources: ResourceEvent[]; error: string | null;
};
type Location = { kind: 'local'; path: string } | { kind: 'remote'; url: string }
  | { kind: 'archive'; url: string; entry: string };
type Document = { value: Json; location: Location };
const MAX_DOWNLOAD = 64 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_MEMBERS = 10_000;
const MARKER = '.gams-resource.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const clone = <T>(value: T): T => structuredClone(value);
const object = (value: unknown): value is ObjectJson => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a: Json, b: Json): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  return false;
};
function insist(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function parent(path: string): string { return path.slice(0, path.lastIndexOf('/')) || '/'; }
function inside(path: string, root: string): boolean { return path === root || path.startsWith(root === '/' ? '/' : root + '/'); }
function zipName(value: string, directory = false): string {
  insist(typeof value === 'string' && value.length > 0 && !/[\\\x00-\x1f:]/.test(value) && !value.startsWith('/'), 'unsafe ZIP path');
  const name = directory ? value.replace(/\/$/, '') : value;
  insist(name.length > 0 && encoder.encode(name).length <= 4096 && name.split('/').every(p => p && p !== '.' && p !== '..' && !/[. ]$/.test(p)
    && !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(p)), 'unsafe ZIP path component');
  insist(name.toLowerCase() !== MARKER && !name.toLowerCase().startsWith(MARKER + '/'), 'reserved ZIP cache marker');
  return name;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function validateMembers(members: ZipMember[]): void {
  insist(Array.isArray(members) && members.length <= MAX_MEMBERS, 'ZIP member count exceeds limit');
  const paths = new Map<string, boolean>(); let total = 0;
  for (const member of members) {
    const name = zipName(member.name, member.directory).toLowerCase();
    insist(!paths.has(name), 'duplicate/case-colliding ZIP entry'); paths.set(name, !!member.directory);
    const kind = (member.mode ?? 0) & 0o170000;
    insist(!member.encrypted && !member.symlink && (kind === 0 || kind === 0o100000 || (member.directory && kind === 0o040000)), 'encrypted ZIP or symlink/special file unsupported');
    const size = member.size ?? member.bytes?.length ?? 0;
    insist(Number.isSafeInteger(size) && size >= 0 && size <= MAX_DOWNLOAD, 'ZIP member exceeds 64 MiB limit');
    total += size; insist(total <= MAX_EXPANDED, 'ZIP exceeds 256 MiB expanded limit');
    if (member.bytes) {
      insist(member.bytes.length === size, 'ZIP expanded size mismatch');
      if (member.crc32 !== undefined) insist(crc32(member.bytes) === member.crc32 >>> 0, 'ZIP CRC mismatch');
    }
  }
  const spelling = new Map<string, string>();
  for (const member of members) {
    const parts = zipName(member.name, member.directory).split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/'); const lower = path.toLowerCase();
      insist(!spelling.has(lower) || spelling.get(lower) === path, 'case-colliding ZIP path'); spelling.set(lower, path);
      if (i < parts.length) insist(paths.get(lower) !== false, 'ZIP file/directory conflict');
    }
  }
}

// Keep this absolute Host-owned import external to the Web Host bundle.
async function unzipBrowser(bytes: Uint8Array): Promise<ZipMember[]> {
  const zip = await import(/* @vite-ignore */ '/util/vendor/zipjs/zip-native.js');
  zip.configure({ useWebWorkers: false });
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(bytes), { useWebWorkers: false });
  try {
    const entries = [];
    for await (const entry of reader.getEntriesGenerator()) {
      insist(entries.length < MAX_MEMBERS, 'ZIP member count exceeds limit'); entries.push(entry);
    }
    const members: ZipMember[] = entries.map(entry => ({ name: entry.filename, directory: entry.directory, encrypted: entry.encrypted, symlink: entry.symlink,
      mode: entry.unixMode ?? (entry.versionMadeBy >> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0), size: entry.uncompressedSize, crc32: entry.signature }));
    validateMembers(members);
    for (let i = 0; i < entries.length; i++) {
      if (members[i].directory) continue;
      const chunks: Uint8Array[] = []; let size = 0;
      const writable = new WritableStream<Uint8Array>({ write(chunk) {
        size += chunk.length; insist(size <= MAX_DOWNLOAD && size <= members[i].size!, 'ZIP expanded size exceeds declared limit'); chunks.push(chunk.slice());
      } });
      await entries[i].getData(writable, { checkSignature: true, useWebWorkers: false });
      insist(size === members[i].size, 'ZIP expanded size mismatch');
      const result = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } members[i].bytes = result;
    }
    validateMembers(members); return members;
  } finally { await reader.close(); }
}

export class BrowserProject {
  readonly store: Store;
  readonly options: ProjectOptions;
  onProgress?: (snapshot: ResolutionProgress) => void;
  private original?: ObjectJson;
  private resolved?: ObjectJson;
  private source?: URL;
  private deps: ProjectDependencies;
  private pending = new Map<string, Promise<string>>();
  private resolvingFiles = 0;
  private fileSources = new Map<string, Json>();
  private snapshot: ResolutionProgress = { operationId: 'browser-project', status: 'resolving', discovered: 0, completed: 0, resources: [], error: null };
  constructor(store: Store, options: ProjectOptions, dependencies: ProjectDependencies = {}) {
    this.store = store; this.deps = dependencies;
    for (const key of ['cwd', 'modulesDir', 'pluginCacheDir'] as const) insist(options[key].startsWith('/'), `${key} must be absolute`);
    insist(typeof options.config === 'string' && options.config.length > 0 && !/[\/\\:\x00]/.test(options.config) && options.config !== '.' && options.config !== '..', 'config must be a filename');
    this.options = { ...options, corsProxy: validateCorsProxy(options.corsProxy), cwd: normalizePath(options.cwd), modulesDir: normalizePath(options.modulesDir), pluginCacheDir: normalizePath(options.pluginCacheDir) };
    if (options.source !== undefined) {
      if (/^[a-z][a-z\d+.-]*:/i.test(options.source)) this.validateURL(options.source);
      const source = new URL(options.source, globalThis.location?.href);
      insist(!source.search && !source.hash, 'Project source must be a static folder URL without query or fragment');
      this.validateURL(source.href); source.pathname = source.pathname.replace(/\/?$/, '/'); this.source = source;
    }
  }
  get originalConfig(): ObjectJson | undefined { return this.original && clone(this.original); }
  get resolvedConfig(): ObjectJson | undefined { return this.resolved && clone(this.resolved); }
  get current(): ObjectJson | undefined { return this.resolvedConfig; }
  get progress(): ResolutionProgress { return clone(this.snapshot); }
  private emit(): void { this.onProgress?.(this.progress); }
  private event(resource: string, entry: string | null): ResourceEvent {
    const event: ResourceEvent = { operationId: this.snapshot.resources.length + 1, resource, entry, phase: 'checking-cache', completed: 0, total: null, unit: null, cached: false, error: null };
    this.snapshot.resources.push(event); this.snapshot.discovered++; this.emit(); return event;
  }
  private async exists(path: string): Promise<boolean> {
    try { await this.store.stat(path); return true; } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return false; throw error; }
  }
  private async mkdir(path: string): Promise<void> {
    if (await this.exists(path)) { insist(await this.store.stat(path) === 'directory', `not a directory: ${path}`); return; }
    if (path !== '/') await this.mkdir(parent(path)); await this.store.mkdir(path);
  }
  private validateURL(source: string): URL {
    let url: URL;
    insist(/^https?:\/\//i.test(source) && !/[\x00-\x20\\]/.test(source), 'invalid resource URL');
    try { url = new URL(source); } catch { throw new Error('invalid resource URL'); }
    insist(!url.username && !url.password, 'resource URL contains credentials');
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    insist(url.protocol === 'https:' || (url.protocol === 'http:' && (loopback || url.origin === globalThis.location?.origin)), 'downloads require HTTPS or loopback/same-origin HTTP');
    insist(!url.hash, 'download URL fragments are unsupported'); return url;
  }
  async download(source: string, progress?: (value: DownloadProgress) => void): Promise<Uint8Array> {
    const url = this.validateURL(source).href;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('download timeout (120 seconds)')); }, 120_000); });
    const action = async () => {
      if (this.deps.download) return this.deps.download(url, progress);
      const relay = this.options.corsProxy && new URL(url).origin !== globalThis.location?.origin
        ? new URL(this.options.corsProxy) : undefined;
      if (relay) relay.searchParams.set('url', url);
      const response = await fetch(relay?.href ?? url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
      insist(response.ok, `download failed: HTTP ${response.status}`);
      const final = this.validateURL(response.url);
      if (relay) {
        insist(final.origin === relay.origin && final.pathname === relay.pathname, 'CORS proxy redirect changed endpoint');
      } else {
        insist(new URL(url).protocol !== 'https:' || final.protocol === 'https:', 'HTTPS downgrade redirect rejected');
      }
      const length = response.headers.get('content-length'); const total = length === null ? null : Number(length);
      insist(total === null || (Number.isSafeInteger(total) && total >= 0 && total <= MAX_DOWNLOAD), 'download exceeds 64 MiB limit');
      insist(response.body, 'download response has no body');
      const reader = response.body.getReader(); const chunks = []; let downloaded = 0; progress?.({ downloaded, total });
      try {
        while (true) {
          const result = await reader.read(); if (result.done) break;
          downloaded += result.value.length; insist(downloaded <= MAX_DOWNLOAD, 'download exceeds 64 MiB limit');
          chunks.push(result.value); progress?.({ downloaded, total });
        }
      } catch (error) { await reader.cancel(); throw error; }
      const bytes = new Uint8Array(downloaded); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
    };
    try {
      const bytes = await Promise.race([action(), timeout]);
      insist(bytes instanceof Uint8Array && bytes.length <= MAX_DOWNLOAD, 'download exceeds 64 MiB limit'); return bytes;
    } finally { clearTimeout(timer!); }
  }
  private guest(path: string): string {
    if (inside(path, this.options.modulesDir)) return 'gams_modules' + path.slice(this.options.modulesDir.length);
    insist(inside(path, this.options.cwd), 'resource outside Project and modules directories');
    return path.slice(this.options.cwd === '/' ? 1 : this.options.cwd.length + 1) || '.';
  }
  private local(path: string): string {
    if (path === 'gams_modules' || path.startsWith('gams_modules/')) return normalizePath(path.slice('gams_modules'.length).replace(/^\//, ''), this.options.modulesDir);
    return normalizePath(path, this.options.cwd);
  }
  private location(source: Json, base: Location): Location {
    let value: string; let entry: string | undefined;
    if (typeof source === 'string') value = source;
    else {
      insist(object(source) && Object.keys(source).every(k => k === 'url' || k === 'entry') && typeof source.url === 'string', 'source must be a string or {url,entry}'); value = source.url;
      if (Object.hasOwn(source, 'entry')) { insist(typeof source.entry === 'string', 'entry must be a string'); entry = source.entry; }
    }
    insist(value.length > 0 && !/[\x00\\]/.test(value), 'invalid resource source');
    let result: Location;
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
      const url = this.validateURL(value).href;
      result = /\.zip$/i.test(new URL(url).pathname) ? { kind: 'archive', url, entry: '' } : { kind: 'remote', url };
    } else if (base.kind === 'remote') {
      return this.location(entry === undefined ? new URL(value, base.url).href : { url: new URL(value, base.url).href, entry }, { kind: 'local', path: this.options.cwd });
    } else if (base.kind === 'archive') {
      insist(entry === undefined && !value.startsWith('/') && !value.includes(':'), 'nested ZIP selectors or absolute archive paths unsupported');
      const path = normalizePath(value, '/' + base.entry); result = { kind: 'archive', url: base.url, entry: path.slice(1) };
    } else {
      insist(!value.startsWith('//') && !value.includes('?') && !value.includes('#') && !value.includes(':'), 'malformed local resource source');
      const path = value.startsWith('gams_modules/') ? this.local(value) : normalizePath(value, base.path); this.guest(path);
      result = /\.zip$/i.test(path) ? { kind: 'archive', url: 'virtual:' + path, entry: '' } : { kind: 'local', path };
    }
    if (entry !== undefined) {
      insist(result.kind === 'archive', 'entry selector requires ZIP source'); result.entry = entry === '' ? '' : zipName(entry, true);
    }
    return result;
  }
  private base(location: Location): Location {
    if (location.kind === 'local') return { kind: 'local', path: parent(location.path) };
    if (location.kind === 'remote') return { kind: 'remote', url: new URL('.', location.url).href };
    return { ...location, entry: location.entry.includes('/') ? location.entry.slice(0, location.entry.lastIndexOf('/')) : '' };
  }
  private async readLocal(path: string): Promise<Uint8Array> {
    try { return await this.store.read(path); } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      insist(this.source && inside(path, this.options.cwd) && !inside(path, this.options.modulesDir), `missing Project resource: ${path}; no static source available`);
      const relative = path.slice(this.options.cwd === '/' ? 1 : this.options.cwd.length + 1);
      const url = new URL(relative.split('/').map(encodeURIComponent).join('/'), this.source).href;
      const bytes = await this.download(url); await this.mkdir(parent(path)); await this.store.write(path, bytes); await this.store.flush(); return bytes;
    }
  }
  private async install(url: string): Promise<string> {
    if (this.pending.has(url)) return this.pending.get(url)!;
    const action = this.installOnce(url); this.pending.set(url, action);
    try { return await action; } finally { this.pending.delete(url); }
  }
  private async installOnce(url: string): Promise<string> {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(url))), n => n.toString(16).padStart(2, '0')).join('');
    const root = normalizePath(hash, this.options.modulesDir); const event = this.event(url, null);
    let stage: string | undefined;
    try {
      if (await this.exists(root + '/' + MARKER)) {
        const marker = JSON.parse(decoder.decode(await this.store.read(root + '/' + MARKER)));
        insist(marker.url === url && typeof marker.path === 'string', 'invalid resource completion marker');
        const path = normalizePath(marker.path, root); insist(inside(path, root), 'unsafe cache marker path');
        event.cached = true; event.phase = 'ready'; this.snapshot.completed++; this.emit(); return path;
      }
      insist(!await this.exists(root), 'incomplete resource cache; remove it before retrying');
      event.phase = 'downloading'; event.unit = 'bytes'; this.emit();
      const bytes = url.startsWith('virtual:') ? await this.readLocal(url.slice(8)) : await this.download(url, value => { event.completed = value.downloaded; event.total = value.total; this.emit(); });
      insist(bytes.length <= MAX_DOWNLOAD, 'archive exceeds 64 MiB compressed limit');
      stage = normalizePath('.install-' + hash + '-' + crypto.randomUUID(), this.options.modulesDir); await this.mkdir(stage);
      const archive = /\.zip$/i.test(url.startsWith('virtual:') ? url.slice(8) : new URL(url).pathname);
      let path: string;
      if (archive) {
        event.phase = 'extracting'; event.unit = 'entries'; event.completed = 0; event.total = null; this.emit();
        const members = await (this.deps.unzip ?? unzipBrowser)(bytes); validateMembers(members); event.total = members.length;
        for (const member of members) {
          const target = stage + '/' + zipName(member.name, member.directory);
          if (member.directory) await this.mkdir(target);
          else { insist(member.bytes instanceof Uint8Array, 'ZIP entry missing bytes'); await this.mkdir(parent(target)); await this.store.write(target, member.bytes); }
          event.completed++; this.emit();
        }
        path = '.';
      } else {
        const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'resource');
        path = zipName(name); insist(!path.includes('/'), 'invalid direct download filename'); await this.store.write(stage + '/' + path, bytes);
      }
      await this.store.flush();
      await this.store.write(stage + '/' + MARKER, encoder.encode(JSON.stringify({ url, path })));
      await this.store.flush();
      if (this.store.publishResource) await this.store.publishResource(stage, root);
      else await this.store.rename(stage, root);
      stage = undefined; await this.store.flush();
      event.phase = 'ready'; this.snapshot.completed++; this.emit(); return normalizePath(path, root);
    } catch (error) { event.phase = 'failed'; event.error = String(error); this.emit(); throw error;
    } finally { if (stage) { await this.store.remove(stage); await this.store.flush(); } }
  }
  private async materialize(location: Location): Promise<string> {
    if (location.kind === 'local') {
      if (await this.exists(location.path) && await this.store.stat(location.path) === 'directory') return location.path;
      await this.readLocal(location.path); return location.path;
    }
    const path = await this.install(location.url);
    const selected = location.kind === 'archive' && location.entry ? normalizePath(location.entry, path) : path;
    insist(await this.exists(selected), `missing cached resource selector: ${location.kind === 'archive' ? location.entry : location.url}`); return selected;
  }
  private canonical(location: Location): Json {
    if (location.kind === 'local') return { $file: this.guest(location.path) };
    if (location.kind === 'remote') return { $file: location.url };
    return { $file: { url: location.url.startsWith('virtual:') ? this.guest(location.url.slice(8)) : location.url, entry: location.entry } };
  }
  async resolveFile(source: Json, base?: string): Promise<string> {
    if (this.resolvingFiles++ === 0) {
      this.snapshot = { operationId: crypto.randomUUID(), status: 'resolving', discovered: 0, completed: 0, resources: [], error: null };
      this.emit();
    }
    try {
      const location = this.location(source, base ? (/^https?:/.test(base) ? { kind: 'remote', url: base } : { kind: 'local', path: this.local(base) }) : { kind: 'local', path: this.options.cwd });
      const path = this.guest(await this.materialize(location)); this.fileSources.set(path, this.canonical(location)); return path;
    } catch (error) {
      this.snapshot.status = 'failed'; this.snapshot.error = String(error); throw error;
    } finally {
      if (--this.resolvingFiles === 0 && this.snapshot.status !== 'failed') this.snapshot.status = 'ready';
      this.emit();
    }
  }
  private pointer(value: Json, pointer: string): Json {
    if (pointer === '') return value;
    insist(pointer.startsWith('/'), 'JSON pointer must start with /');
    for (const token of pointer.slice(1).split('/')) {
      insist(!/~(?:[^01]|$)/.test(token), 'invalid JSON pointer escape');
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      insist((object(value) || Array.isArray(value)) && Object.hasOwn(value, key), `missing JSON pointer: ${pointer}`);
      insist(!Array.isArray(value) || /^(0|[1-9]\d*)$/.test(key), 'invalid JSON pointer array index'); value = (value as ObjectJson)[key];
    }
    return value;
  }
  private async document(location: Location): Promise<Document> {
    const path = await this.materialize(location); return { location, value: JSON.parse(decoder.decode(await this.store.read(path))) };
  }
  private async resolve(value: Json, doc: Document, active: Set<string>): Promise<Json> {
    if (Array.isArray(value)) { const result = []; for (const child of value) result.push(await this.resolve(child, doc, active)); return result; }
    if (!object(value)) return value;
    const hasRef = Object.hasOwn(value, '$ref'); const hasFile = Object.hasOwn(value, '$file');
    if (hasRef || hasFile) {
      insist(Object.keys(value).length === 1, 'resource expression must not have siblings');
      if (hasFile) {
        const location = this.location(value.$file, this.base(doc.location)); const path = this.guest(await this.materialize(location));
        this.fileSources.set(path, this.canonical(location)); return path;
      }
      let source = value.$ref; let pointer = ''; let sameDocument = false;
      if (typeof source === 'string') {
        const hash = source.indexOf('#');
        if (hash >= 0) { pointer = decodeURIComponent(source.slice(hash + 1)); source = source.slice(0, hash); sameDocument = source === ''; }
      } else {
        insist(object(source) && Object.keys(source).every(k => ['url', 'entry', 'pointer'].includes(k)), 'invalid $ref descriptor');
        if (Object.hasOwn(source, 'pointer')) { insist(typeof source.pointer === 'string', 'pointer must be a string'); pointer = source.pointer; }
        source = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'pointer'));
      }
      const location = sameDocument ? doc.location : this.location(source, this.base(doc.location)); const key = JSON.stringify(location) + '#' + pointer;
      insist(!active.has(key), 'circular $ref reference'); const next = new Set(active); next.add(key);
      const target = sameDocument ? doc : await this.document(location); return this.resolve(this.pointer(target.value, pointer), target, next);
    }
    const result: ObjectJson = {};
    for (const [key, child] of Object.entries(value)) Object.defineProperty(result, key, { value: await this.resolve(child, doc, active), enumerable: true, writable: true, configurable: true });
    return result;
  }
  private async importLocalUnits(config: ObjectJson): Promise<void> {
    if (!this.source) return;
    // An HTTP Project folder is an import source, not a mounted filesystem.
    // Import explicitly configured local Unit files as well as $ref/$file data.
    const sources: Json[] = Array.isArray(config.plugins) ? [...config.plugins] : [];
    if (object(config.ui)) {
      for (const group of [config.ui.services, config.ui.views]) {
        if (object(group)) for (const entry of Object.values(group)) if (object(entry)) sources.push(entry.url);
      }
      if (object(config.ui.theme)) sources.push(config.ui.theme.url ?? config.ui.theme.path);
    }
    for (const source of sources) {
      // Bare remote Unit URLs remain invalid frontend input, not implicit $file.
      if (typeof source === 'string' && source && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(source)) {
        await this.materialize(this.location(source, {kind:'local',path:this.options.cwd}));
      }
    }
  }
  async importShowcaseArchive(url: string): Promise<void> {
    const event = this.event(url, null);
    try {
      event.phase = 'downloading'; event.unit = 'bytes'; this.emit();
      const bytes = await this.download(url, ({downloaded, total}) => {
        event.completed = downloaded; event.total = total; this.emit();
      });
      const members = await (this.deps.unzip ?? unzipBrowser)(bytes);
      validateMembers(members);
      insist(members.some(member => member.name === 'gams.json' && !member.directory && member.bytes), 'showcase ZIP requires gams.json at its root');
      for (const member of members) {
        const name = zipName(member.name, member.directory);
        insist(name.toLowerCase().split('/')[0] !== 'gams_modules', 'showcase ZIP must not contain the Unit cache');
        insist(member.directory || member.bytes, 'missing showcase ZIP member bytes');
      }
      event.phase = 'extracting'; event.unit = 'entries'; event.completed = 0; event.total = members.length; this.emit();
      for (const member of members) {
        const path = this.options.cwd + '/' + zipName(member.name, member.directory);
        if (member.directory) await this.mkdir(path);
        else { await this.mkdir(parent(path)); await this.store.write(path, member.bytes!); }
        event.completed++; this.emit();
      }
      event.phase = 'ready'; this.snapshot.completed++; this.emit();
    } catch (error) {
      event.phase = 'failed'; event.error = String(error);
      this.snapshot.status = 'failed'; this.snapshot.error = String(error); this.emit();
      throw error;
    }
  }
  async load(): Promise<{ config: ObjectJson; configFile: string; modulesDir: string }> {
    this.snapshot.status = 'resolving'; this.emit();
    try {
      const configFile = normalizePath(this.options.config, this.options.cwd); const document = await this.document({ kind: 'local', path: configFile });
      insist(object(document.value), 'Project config must be a JSON object'); const config = await this.resolve(document.value, document, new Set());
      insist(object(config), 'resolved Project config must be a JSON object'); await this.importLocalUnits(config);
      this.original = clone(document.value); this.resolved = clone(config);
      this.snapshot.status = 'ready'; this.emit(); return { config, configFile: this.options.config, modulesDir: this.options.modulesDir };
    } catch (error) { this.snapshot.status = 'failed'; this.snapshot.error = String(error); this.emit(); throw error; }
  }
  async prepareConfig(config: Json): Promise<ObjectJson> {
    insist(this.original && this.resolved, 'Project has not loaded'); insist(object(config), 'Project config must be a JSON object');
    const files = (value: Json): Json => {
      if (typeof value === 'string') {
        if (this.fileSources.has(value)) return clone(this.fileSources.get(value)!);
        insist(!value.startsWith(this.options.modulesDir + '/'), 'cannot save virtual cache path'); return value;
      }
      if (Array.isArray(value)) return value.map(files);
      if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, files(child)])); return value;
    };
    const restore = (original: Json | undefined, resolved: Json | undefined, current: Json): Json => {
      if (original !== undefined && resolved !== undefined && object(original) && (Object.hasOwn(original, '$ref') || Object.hasOwn(original, '$file')) && equal(resolved, current)) return clone(original);
      if (Array.isArray(current)) return current.map((child, i) => restore(Array.isArray(original) ? original[i] : undefined, Array.isArray(resolved) ? resolved[i] : undefined, child));
      if (object(current)) return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, restore(object(original) ? original[key] : undefined, object(resolved) ? resolved[key] : undefined, child)]));
      return files(current);
    };
    let candidate = restore(this.original, this.resolved, config) as ObjectJson;
    // Retained same-document references must still reproduce the edited config.
    const fix = async (value: Json, current: Json, root: ObjectJson): Promise<Json> => {
      if (object(value) && Object.hasOwn(value, '$ref')) {
        let matches = false;
        try { matches = equal(await this.resolve(value, { value: root, location: { kind: 'local', path: normalizePath(this.options.config, this.options.cwd) } }, new Set()), current); }
        catch { /* Editing can remove a former same-document dependency. */ }
        return matches ? value : files(current);
      }
      if (Array.isArray(value) && Array.isArray(current)) { const result = []; for (let i = 0; i < value.length; i++) result.push(await fix(value[i], current[i], root)); return result; }
      if (object(value) && object(current) && !Object.hasOwn(value, '$file')) {
        const result: ObjectJson = {};
        for (const [key, child] of Object.entries(value)) Object.defineProperty(result, key, { value: await fix(child, current[key], root), enumerable: true, writable: true, configurable: true }); return result;
      }
      return value;
    };
    for (let i = 0; i <= this.snapshot.discovered + 1; i++) { const next = await fix(candidate, config, candidate) as ObjectJson; if (equal(next, candidate)) return next; candidate = next; }
    throw new Error('cannot preserve configuration references consistently');
  }
}
