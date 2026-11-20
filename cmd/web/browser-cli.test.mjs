import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { BrowserComponents } from './browser-components.ts';
import { TestMemoryStore } from './test-memory-store.mjs';
import { unfamiliarSchema } from './test-schemas.mjs';

const bytes = Uint8Array.from([0,97,115,109,13,0,1,0]);
const encode = text => new TextEncoder().encode(text);

// Exercise the real component import selection without installing compiler packages
// for native tests. Real shim behavior is also checked with browser WASI probes.
test('components receive isolated CLI environment/exit bindings; unrelated imports stay denied', async () => {
  const configurations = [];
  const cliInstances = [];
  const filesystems = [];
  let disposed = 0;
  globalThis.__browserCliTest = {
    createCli(config) {
      configurations.push(config);
      const cli = { environment: {}, exit: {} };
      cliInstances.push(cli);
      return cli;
    },
    createFilesystem(config) {
      filesystems.push(config);
      return { types: {}, preopens: {}, dispose: async () => { disposed++; } };
    },
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      let source;
      if (specifier === '@bytecodealliance/preview2-shim/filesystem') {
        source = 'export const createFilesystem = (...args) => globalThis.__browserCliTest.createFilesystem(...args);';
      } else if (specifier === '@bytecodealliance/preview2-shim') {
        source = 'export const cli = { createCli: config => globalThis.__browserCliTest.createCli(config) };' +
          'export const io = {}, clocks = {}, random = {};';
      } else return nextResolve(specifier, context);
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    },
  });
  async function manager(imports, instantiate) {
    const store = new TestMemoryStore({ dir: {} });
    await store.mkdir('/project'); await store.mkdir('/modules');
    return new BrowserComponents(store, { cwd: '/project', modulesDir: '/modules', pluginCacheDir: '/cache' }, {
      filesystem: async (cwd, modules) => (await import('@bytecodealliance/preview2-shim/filesystem')).createFilesystem({preopens:{'.':cwd, '/project':cwd, gams_modules:modules}}),
      schema: () => unfamiliarSchema([]),
      transpile: async () => ({ imports, exports: [], files: [['component.js', encode('test')]] }),
      instantiate,
    });
  }
  try {
    for (const version of ['0.2.0', '0.2.6']) {
      let bindings;
      const names = [`wasi:cli/environment@${version}`, `wasi:cli/exit@${version}`];
      const components = await manager(names, async (_output, imports) => { bindings = imports; return {}; });
      await components.loadFromBytes(bytes, 'cli.wasm');
      const cli = cliInstances.at(-1);
      assert.equal(bindings.get(names[0]), cli.environment);
      assert.equal(bindings.get(names[1]), cli.exit);
      assert.deepEqual(configurations.at(-1), { environment: {}, arguments: [], initialCwd: '/project' });
      const { preopens } = filesystems.at(-1);
      assert.deepEqual(Object.keys(preopens).sort(), ['.', '/project', 'gams_modules']);
      assert.equal(preopens['.'], preopens['/project']); // C/WASI relative paths share the Project tree.
      assert.notEqual(preopens.gams_modules, preopens['/project']);
      await components.close();
    }
    assert.notEqual(cliInstances[0], cliInstances[1]);
    assert.equal(disposed, 2);
    const denied = await manager(['wasi:sockets/tcp@0.2.0'], async () => assert.fail('denied component instantiated'));
    await assert.rejects(denied.loadFromBytes(bytes, 'denied.wasm'), /Missing or denied WIT import: wasi:sockets\/tcp@0.2.0/);
    assert.equal(disposed, 3);
  } finally {
    hooks.deregister();
    delete globalThis.__browserCliTest;
  }
});
