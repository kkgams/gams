import { assertComponent, instantiateComponent, type TranspiledComponent } from '../../cmd/web/runtime.ts';
import { createCapabilitySession, type CapabilitySession } from './capabilities';
import { runPersistenceCheck } from './opfs-checks';
import { runRandomChecks, runFilesystemChecks } from './plugin-checks';
import { prepareFilesystemCall, filesystemHostValue } from '../../cmd/web/files-call.ts';

let transpiled: TranspiledComponent | undefined;
let instance: Record<string, unknown> | undefined;
let capabilities: CapabilitySession | undefined;
async function closeSession() {
  if (instance) {
    const util = instance._util as { whenIdle(): Promise<void>; stop(): void };
    await util.whenIdle();
    util.stop();
    instance = undefined;
  }
  if (capabilities) {
    await capabilities.dispose();
    capabilities = undefined;
  }
}
const start = performance.now();
const initialized = (async () => {
  const api = await import('@bytecodealliance/jco/component');
  const backend = await import('@bytecodealliance/jco-transpile/component');
  await backend.$init;
  return api;
})();
initialized.then(() => postMessage({ event: 'ready', initializationMs: performance.now() - start }))
  .catch(error => postMessage({ event: 'fatal', error: String(error) }));

// Async OPFS setup/checkpoints must not overlap reinstantiate or shutdown.
let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
async function handle({ id, operation, args }) {
  const started = performance.now();
  try {
    let result: unknown;
    switch (operation) {
      case 'transpile': {
        await closeSession();
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
        await closeSession();
        if (!transpiled) throw new Error('Transpile a component first.');
        capabilities = await createCapabilitySession({
          logging: args.grantLogging, filesystem: args.grantFilesystem, filesystemMode: args.filesystemMode,
        }, value => { postMessage({ event: 'host-log', value }); });
        instance = await instantiateComponent(transpiled, capabilities.imports);
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
      case 'invoke-filesystem': {
        if (!instance || !capabilities || capabilities.storage !== 'opfs') throw new Error('Files View requires an explicitly granted OPFS session.');
        const call = prepareFilesystemCall(args.target, args.values);
        const fs = instance['gams:fs/fs@1.2.0'] as Record<string, (...values: unknown[]) => unknown>;
        if (!fs || !Object.hasOwn(fs, call.name) || typeof fs[call.name] !== 'function') throw new Error(`Missing filesystem export: ${call.name}`);
        try {
          result = { ok: filesystemHostValue(await fs[call.name](...call.values)) };
        } catch (error) {
          const util = instance._util as { isComponentError(error: unknown): boolean };
          // Only a declared WIT result error becomes a Host result envelope.
          // Traps, adapter/checkpoint failures and wiring errors must reject.
          if (!util.isComponentError(error) || typeof error.payload !== 'string') throw error;
          result = { err: error.payload };
        }
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
      case 'flush': {
        if (!capabilities || capabilities.storage === 'none') throw new Error('No filesystem granted.');
        result = { checkpoint: 'complete' };
        break;
      }
      case 'shutdown': {
        await closeSession();
        transpiled = undefined;
        result = { closed: true };
        break;
      }
      case 'persistence': {
        if (!instance || !capabilities || capabilities.storage !== 'opfs') throw new Error('Instantiate plugin.fs with an OPFS grant first.');
        result = runPersistenceCheck(instance, args.action);
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
    // A successful reply acknowledges persistence, not just a memory mutation.
    // The shim's automatic background flush alone is not this guarantee.
    const checkpointStart = performance.now();
    if (capabilities) await capabilities.flush();
    postMessage({ id, result, storage: capabilities ? capabilities.storage : 'none',
      checkpointMs: performance.now() - checkpointStart, durationMs: performance.now() - started });
  } catch (error) {
    postMessage({ id, error: String(error), durationMs: performance.now() - started });
  }
}
