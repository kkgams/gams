function failure(code: string, path: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function checkName(name: string): void {
  if (['__proto__', 'constructor', 'prototype'].includes(name)) {
    throw failure('EINVAL', name);
  }
}

/** Virtual slash-separated paths only; traversal above the virtual root is an error. */
export function normalizePath(path: string, base = '/'): string {
  if (typeof path !== 'string' || typeof base !== 'string' ||
      /[\0\\]/.test(path) || /[\0\\]/.test(base) || !base.startsWith('/')) {
    throw failure('EINVAL', String(path));
  }
  const parts: string[] = [];
  for (const part of (path.startsWith('/') ? path : `${base}/${path}`).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw failure('EPERM', path);
      parts.pop();
    } else {
      checkName(part);
      parts.push(part);
    }
  }
  return `/${parts.join('/')}`;
}
