import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectOpfsStore } from './opfs-store.ts';

test('bounded writes advance by the returned byte count, not by the size of the reply', () => {
  const payload = new Uint8Array(300_000).map((_, i) => i % 251);
  const capacity = 256 * 1024;
  const shared = new SharedArrayBuffer(capacity + 16);
  const reply = new Int32Array(shared, 0, 4);
  const data = new Uint8Array(shared, 16);
  const bytes = new Uint8Array(payload.length);
  const offsets = [];
  const store = Object.assign(Object.create(DirectOpfsStore.prototype), {
    reply, data, metrics: { writes: 0, writeBytes: 0 },
    worker: { postMessage({ op, at, size }) {
      assert.equal(op, 'write');
      offsets.push(at);
      // An implementation may write less than the offered chunk.
      const count = Math.min(150_000, size);
      bytes.set(data.subarray(0, count), at - 9);
      const response = new TextEncoder().encode(JSON.stringify(count));
      data.set(response);
      Atomics.store(reply, 1, response.length);
      Atomics.store(reply, 0, 1);
    } },
  });
  assert.equal(store.writeAt('/data.bin', payload, 9), payload.length);
  assert.deepEqual(offsets, [9, 150_009]);
  assert.deepEqual(bytes, payload);
  assert.deepEqual(store.metrics, { writes: 2, writeBytes: payload.length });
});
