import test from 'node:test';
import assert from 'node:assert/strict';
import { assertComponent, instantiateComponent } from './runtime.ts';

const header = [0, 97, 115, 109, 13, 0, 1, 0];
test('accept Component Model header, reject core Wasm and truncated input', () => {
  assert.doesNotThrow(() => assertComponent(new Uint8Array(header)));
  for (const bytes of [[], [0, 97, 115, 109, 1, 0, 0, 0], header.slice(0, 7)]) {
    assert.throws(() => assertComponent(new Uint8Array(bytes)), /Component Model/);
  }
});
test('bound uploaded component bytes before invoking Jco', () => {
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
  bytes.set(header);
  assert.throws(() => assertComponent(bytes), /16 MiB/);
});
test('deny logging unless granted, and deny every other interface even with logging grant', async () => {
  for (const [name, granted] of [['gams:experiment/logging', false], ['wasi:filesystem/types', true], ['toString', true]]) {
    await assert.rejects(instantiateComponent({ imports: [name], files: [], exports: [] }, granted, () => {}), /Missing or denied WIT import/);
  }
});
test('do not mask missing bindings after accepting an allowed interface', async () => {
  await assert.rejects(instantiateComponent({ imports: ['gams:experiment/logging'], files: [], exports: [] }, true, () => {}), /did not produce component.js/);
});
