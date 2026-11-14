import { assertComponent, instantiateComponent, type TranspiledComponent } from './runtime';
import { createCapabilityImports } from './capabilities';
import { runRandomChecks, runFilesystemChecks } from './plugin-checks';

let transpiled: TranspiledComponent | undefined;
let instance: Record<string, unknown> | undefined;
const start = performance.now();
const initialized = (async () => {
  const api = await import('@bytecodealliance/jco/component');
  const backend = await import('@bytecodealliance/jco-transpile/component');
  await backend.$init;
  return api;
})();
initialized.then(() => postMessage({ event: 'ready', initializationMs: performance.now() - start }))
  .catch(error => postMessage({ event: 'fatal', error: String(error) }));

self.onmessage = async ({ data: { id, operation, args } }) => {
  const started = performance.now();
  try {
    let result: unknown;
    switch (operation) {
      case 'transpile': {
        instance = undefined;
        transpiled = undefined;
        const bytes = new Uint8Array(args.bytes);
        assertComponent(bytes);
        const { transpile } = await initialized;
        transpiled = await transpile(bytes, {
          name: 'component', instantiation: { tag: 'async' },
          noTypescript: true, noNodejsCompat: true, base64Cutoff: 0,
        });
        result = {
          imports: transpiled.imports, exports: transpiled.exports,
          files: transpiled.files.map(([name, bytes]) => ({ name, bytes: bytes.byteLength })),
        };
        break;
      }
      case 'instantiate': {
        instance = undefined;
        if (!transpiled) throw new Error('Transpile a component first.');
        const imports = createCapabilityImports({ logging: args.grantLogging, filesystem: args.grantFilesystem }, value => {
          postMessage({ event: 'host-log', value });
        });
        instance = await instantiateComponent(transpiled, imports);
        result = { exports: Object.keys(instance) };
        break;
      }
      case 'call': {
        if (!instance) throw new Error('Instantiate a component first.');
        const owner = args.interface === undefined ? instance : instance[args.interface];
        if (!owner || typeof owner !== 'object' || (args.interface !== undefined && !Object.hasOwn(instance, args.interface))) {
          throw new Error(`No exported interface: ${args.interface}`);
        }
        const fn = Object.hasOwn(owner, args.name) ? owner[args.name] : undefined;
        if (typeof fn !== 'function') throw new Error(`No callable export: ${args.name}`);
        result = await fn(...args.values);
        break;
      }
      case 'check-random': {
        if (!instance) throw new Error('Instantiate a component first.');
        result = runRandomChecks(instance);
        break;
      }
      case 'check-filesystem': {
        if (!instance) throw new Error('Instantiate a component first.');
        result = runFilesystemChecks(instance);
        break;
      }
      case 'benchmark': {
        if (!instance || typeof instance.add !== 'function') throw new Error('Expected add export.');
        const count = 1000;
        let value;
        for (let i = 0; i < count; i++) value = instance.add(10, 20);
        result = { count, lastResult: value, totalMs: performance.now() - started };
        break;
      }
      default: throw new Error(`Unknown operation: ${operation}`);
    }
    postMessage({ id, result, durationMs: performance.now() - started });
  } catch (error) {
    postMessage({ id, error: String(error), durationMs: performance.now() - started });
  }
};
