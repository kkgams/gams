// URL startup settings correspond to Native CLI names, but paths belong to the
// selected browser filesystem. They never name directories on the HTTP server.
export interface BrowserEnvironment {
  corsProxy?: string | null;
}

export const showcaseRoot = '/.gams-showcases';
export type Showcase = { id: string; zip?: string };

export interface ProjectOptions {
  cwd: string;
  config: string;
  modulesDir: string;
  pluginCacheDir: string;
  source?: string;
  corsProxy?: string;
}

export type BrowserOptions = ProjectOptions | { showcase: Showcase; corsProxy?: string };

const showcaseId = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const releaseTag = 'v[0-9]+\\.[0-9]+\\.[0-9]+';
const releaseZip = new RegExp(`^https://github\\.com/kkgams/showcases/releases/download/${releaseTag}/(${showcaseId})\\.zip$`);
const localZip = new RegExp(`^/showcases/${releaseTag}/(${showcaseId})\\.zip$`);

function parseShowcase(value: string, page: URL): Showcase {
  const valid = !/[\x00-\x20]/.test(value);
  if (valid && value.length <= 64 && new RegExp(`^${showcaseId}$`).test(value)) return {id:value};
  const release = valid && releaseZip.exec(value);
  const local = valid && ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname) && localZip.exec(value);
  if (release && release[1].length <= 64) return {id:release[1], zip:value};
  if (local && local[1].length <= 64) return {id:local[1], zip:new URL(value,page).href};
  throw new Error('Showcase must be a saved demo ID or a pinned kkgams/showcases release ZIP.');
}

export function validateCorsProxy(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\x00-\x20\\?#]/.test(value)) {
    throw new Error('corsProxy must be an absolute HTTP(S) endpoint without credentials, query or fragment.');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('corsProxy must be an absolute HTTP(S) endpoint.'); }
  if (url.username || url.password) throw new Error('corsProxy must not contain credentials.');
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('corsProxy requires HTTPS or loopback HTTP.');
  }
  return url.href;
}

export function virtualPath(value: string, base = '/'): string {
  if (typeof value !== 'string' || !value || /[\\\0]/.test(value) || /^[a-z]+:/i.test(value)) {
    throw new Error('Expected a nonempty browser filesystem path, not an OS path or URL.');
  }
  const parts: string[] = [];
  for (const part of (value.startsWith('/') ? value : `${base}/${value}`).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Browser filesystem path escapes its root.');
      parts.pop();
    } else parts.push(part);
  }
  return '/' + parts.join('/');
}

export function parseBrowserOptions(url: string, environment: BrowserEnvironment = {}): BrowserOptions {
  const corsProxy = validateCorsProxy(environment.corsProxy);
  const page = new URL(url);
  const allowed = new Set(['project-dir', 'cwd', 'config', 'modules-dir', 'plugin-cache-dir', 'source', 'fs', 'showcase']);
  for (const key of page.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Unsupported browser startup setting: ${key}`);
    if (page.searchParams.getAll(key).length !== 1) throw new Error(`Duplicate browser startup setting: ${key}`);
    if (!page.searchParams.get(key)?.trim()) throw new Error(`Browser startup setting ${key} must not be empty.`);
  }
  const read = (key: string) => page.searchParams.get(key) ?? undefined;
  if (read('project-dir') && read('cwd')) throw new Error('Use project-dir or cwd, not both.');
  if (read('fs') !== undefined && read('fs') !== 'opfs') throw new Error('Only fs=opfs is supported.');
  const showcase = read('showcase');
  if (showcase !== undefined) {
    if (['project-dir','cwd','config','modules-dir','plugin-cache-dir','source'].some(key => page.searchParams.has(key))) {
      throw new Error('Showcase cannot be combined with Project path or source settings.');
    }
    return {showcase:parseShowcase(showcase,page), ...(corsProxy ? {corsProxy} : {})};
  }
  const cwd = virtualPath(read('project-dir') ?? read('cwd') ?? '/projects/default');
  const config = read('config') ?? 'gams.json';
  if (config === '.' || config === '..' || /[/\\\0:]/.test(config)) {
    throw new Error('config must be a filename within the Project directory.');
  }
  const modules = read('modules-dir');
  if (modules !== undefined && !modules.startsWith('/')) throw new Error('modules-dir must be an absolute browser filesystem path.');
  const modulesDir = virtualPath(modules ?? `${cwd}/gams_modules`);
  const pluginCacheDir = virtualPath(read('plugin-cache-dir') ?? '/cache/jco', cwd);
  if ([cwd, modulesDir, pluginCacheDir].some(path => path === '/' || path === showcaseRoot || path.startsWith(showcaseRoot + '/'))) {
    throw new Error('Project and cache paths cannot expose reserved showcase storage.');
  }
  // Keep Host-owned caches outside the visible Project or as its own directory,
  // not equal to the Project root where cache clearing would remove user data.
  if (pluginCacheDir === cwd || cwd.startsWith(pluginCacheDir + '/') || pluginCacheDir === '/' || modulesDir === cwd || modulesDir === '/') {
    throw new Error('Cache/modules directories must not be the filesystem or Project root.');
  }
  if (pluginCacheDir === modulesDir || pluginCacheDir.startsWith(modulesDir + '/') || modulesDir.startsWith(pluginCacheDir + '/')) {
    throw new Error('modules-dir and plugin-cache-dir must be separate directories.');
  }
  // Seed only the implicit browser workspace. Explicit Project/config choices
  // must never silently open a different Project when their config is missing.
  const defaultProject = !['source', 'config', 'cwd', 'project-dir'].some(key => page.searchParams.has(key));
  const requestedSource = read('source') ?? (defaultProject ? '/browser-default/' : undefined);
  let source: string | undefined;
  if (requestedSource) {
    const parsed = new URL(requestedSource, page);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search) {
      throw new Error('source must be an HTTP(S) Project directory URL without credentials, query or fragment.');
    }
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('HTTP Project sources are limited to loopback; otherwise use HTTPS.');
    }
    if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
    source = parsed.href;
  }
  return { cwd, config, modulesDir, pluginCacheDir, ...(source ? { source } : {}), ...(corsProxy ? { corsProxy } : {}) };
}
