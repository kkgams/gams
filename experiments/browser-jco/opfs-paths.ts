// preview2-shim 0.31.1 owns this sidecar name. A guest file with the same
// name would be hidden on reload (and can be deleted during root flush).
const SIDECAR = '.__wasi_symlinks__.json';
const PATH_ARGUMENTS = new Map<string, number[]>([
  ['createDirectoryAt', [0]], ['statAt', [1]], ['setTimesAt', [1]],
  ['linkAt', [1, 3]], ['openAt', [1]], ['readlinkAt', [0]],
  ['removeDirectoryAt', [0]], ['renameAt', [0, 2]], ['symlinkAt', [0, 1]],
  ['unlinkFileAt', [0]], ['metadataHashAt', [1]],
]);

export function protectOpfsDescriptor<T extends object>(root: T): T {
  const originals = new WeakMap<object, object>();
  const unwrap = (descriptor: object) => originals.has(descriptor) ? originals.get(descriptor) : descriptor;
  function wrap(target: object): object {
    const proxy = new Proxy(target, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (typeof property === 'string') {
            const indexes = PATH_ARGUMENTS.get(property);
            if (indexes) for (const index of indexes) {
              const path = args[index];
              if (typeof path !== 'string') throw new Error(`Expected a path for ${property}`);
              if (path.split('/').includes(SIDECAR)) throw 'not-permitted';
            }
            // The in-memory descriptor uses private fields. Pass the original
            // descriptor for cross-descriptor operations, never this Proxy.
            if (property === 'renameAt') args[1] = unwrap(args[1] as object);
            if (property === 'linkAt') args[2] = unwrap(args[2] as object);
            if (property === 'isSameObject') args[0] = unwrap(args[0] as object);
          }
          const result = Reflect.apply(value, target, args);
          return property === 'openAt' ? wrap(result) : result;
        };
      },
    });
    originals.set(proxy, target);
    return proxy;
  }
  return wrap(root) as T;
}
