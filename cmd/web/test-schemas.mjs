import { readFileSync } from 'node:fs';

// Complete wit-parser Resolve graphs extracted with wasm-tools 1.248.0 from
// existing component bytes, not handwritten ABI definitions. FS/Layout/Random:
// plugin.<name>/build.nosync/plugin.<name>.wasm. Image/SQL/Tile Detect:
// build.nosync/web-generic-review/{image,sql,tile-detect}-resolve.json.
const graphs = ['fs', 'layout', 'random', 'image', 'sql', 'tile-detect'].map(name =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')));
const interfaceName = (resolve, id) => {
  const iface = resolve.interfaces[id];
  const [name, version] = resolve.packages[iface.package].name.split('@');
  return `${name}/${iface.name}${version ? `@${version}` : ''}`;
};

export function testSchema(names) {
  for (const graph of graphs) {
    const resolve = structuredClone(graph);
    const world = resolve.worlds.findIndex(world => names.every(name => Object.values(world.exports)
      .some(item => item.interface && interfaceName(resolve, item.interface.id) === name)));
    if (world < 0) continue;
    resolve.worlds[world].exports = Object.fromEntries(Object.entries(resolve.worlds[world].exports)
      .filter(([, item]) => item.interface && names.includes(interfaceName(resolve, item.interface.id))));
    return { world, resolve };
  }
  throw new Error(`No component-derived test schema for ${names.join(', ')}`);
}

// A deliberately unfamiliar test-only interface using the same serialized graph
// structure as the real fixtures. No plugin-specific Runtime adapter can serve it.
export function unfamiliarSchema(names = ['acme:metrics/counter@2.3.0']) {
  return { world: 0, resolve: {
    worlds: [{ name: 'test', imports: {}, exports: Object.fromEntries(names.map((_, id) =>
      [`interface-${id}`, { interface: { id } }])), package: names.length }],
    interfaces: names.map((name, id) => ({ name: name.split('/')[1].split('@')[0], package: id, types: {}, functions: {
      'next-value': { name: 'next-value', kind: 'freestanding', params: [{ name: 'current', type: 'u64' }], result: 'u64' },
    } })),
    types: [],
    packages: [...names.map((name, id) => ({ name: `${name.split('/')[0]}@${name.split('@')[1]}`, interfaces: { [name.split('/')[1].split('@')[0]]: id }, worlds: {} })),
      { name: 'test:fixture', interfaces: {}, worlds: { test: 0 } }],
  } };
}
