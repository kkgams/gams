// URL startup settings correspond to Native CLI names, but paths belong to the
// selected browser filesystem. They never name directories on the HTTP server.
export interface BrowserOptions {
  cwd: string;
  config: string;
  modulesDir: string;
  pluginCacheDir: string;
  source?: string;
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

export function parseBrowserOptions(url: string): BrowserOptions {
  const page = new URL(url);
  const allowed = new Set(['project-dir', 'cwd', 'config', 'modules-dir', 'plugin-cache-dir', 'source', 'fs']);
  for (const key of page.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Unsupported browser startup setting: ${key}`);
    if (page.searchParams.getAll(key).length !== 1) throw new Error(`Duplicate browser startup setting: ${key}`);
    if (!page.searchParams.get(key)?.trim()) throw new Error(`Browser startup setting ${key} must not be empty.`);
  }
  const read = (key: string) => page.searchParams.get(key) ?? undefined;
  if (read('project-dir') && read('cwd')) throw new Error('Use project-dir or cwd, not both.');
  if (read('fs') !== undefined && read('fs') !== 'opfs') throw new Error('Only fs=opfs is implemented.');
  const cwd = virtualPath(read('project-dir') ?? read('cwd') ?? '/projects/default');
  const config = read('config') ?? 'gams.json';
  if (config === '.' || config === '..' || /[/\\\0:]/.test(config)) {
    throw new Error('config must be a filename within the Project directory.');
  }
  const modules = read('modules-dir');
  if (modules !== undefined && !modules.startsWith('/')) throw new Error('modules-dir must be an absolute browser filesystem path.');
  const modulesDir = virtualPath(modules ?? `${cwd}/gams_modules`);
  const pluginCacheDir = virtualPath(read('plugin-cache-dir') ?? '/cache/jco', cwd);
  // Keep Host-owned caches outside the visible Project or as its own directory,
  // not equal to the Project root where cache clearing would remove user data.
  if (pluginCacheDir === cwd || cwd.startsWith(pluginCacheDir + '/') || pluginCacheDir === '/' || modulesDir === cwd || modulesDir === '/') {
    throw new Error('Cache/modules directories must not be the filesystem or Project root.');
  }
  if (pluginCacheDir === modulesDir || pluginCacheDir.startsWith(modulesDir + '/') || modulesDir.startsWith(pluginCacheDir + '/')) {
    throw new Error('modules-dir and plugin-cache-dir must be separate directories.');
  }
  let source: string | undefined;
  if (read('source')) {
    const parsed = new URL(read('source')!, page);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search) {
      throw new Error('source must be an HTTP(S) Project directory URL without credentials, query or fragment.');
    }
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('HTTP Project sources are limited to loopback; otherwise use HTTPS.');
    }
    if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
    source = parsed.href;
  }
  return { cwd, config, modulesDir, pluginCacheDir, ...(source ? { source } : {}) };
}
