import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImageCall } from './image-call.ts';

const ref = { $resource: 'gams:image/image', id: 'res_1' };
const image = {};
const rect = { x0: -2147483648, y0: 2147483647, x1: -1, y1: 0 };
const color = { r: 0, g: 127, b: 255, a: 128 };
const borrow = value => {
  assert.equal(value, ref);
  return image;
};

test('image supports exactly four methods and exact arities before borrowing', () => {
  const unexpectedBorrow = () => assert.fail('must not borrow');
  for (const [method, arity] of [['create', 3], ['info', 1], ['crop', 2], ['export', 2]]) {
    for (const args of [null, {}, [], Array(arity - 1), Array(arity + 1)]) {
      assert.throws(() => prepareImageCall(method, args, unexpectedBorrow), /requires .* arguments/);
    }
  }
  for (const method of ['open', 'clone', 'resize', 'transform', 'blit', 'blit-many', 'write-pixel',
    'from-pixels', 'read-pixel', 'read-pixels', 'decode-base64', 'encode-base64',
    'toString', 'constructor', '__proto__', 'Create', 'gams:image/image::create']) {
    assert.throws(() => prepareImageCall(method, [], unexpectedBorrow), /Unsupported/);
  }
});

test('create converts optional rgba8 without borrowing or mutating inputs', () => {
  const unexpectedBorrow = () => assert.fail('create must not borrow');
  for (const fill of [null, undefined, color, Object.assign(Object.create(null), color)]) {
    const args = [0, 4294967295, fill];
    assert.deepEqual(prepareImageCall('create', args, unexpectedBorrow), {
      values: [0, 4294967295, fill == null ? undefined : color], resource: true,
    });
    assert.equal(args[2], fill);
  }
  for (const value of [-1, 4294967296, 0.5, NaN, Infinity, -Infinity, '1', true, null, undefined, 1n]) {
    for (const index of [0, 1]) {
      const args = [1, 1, null];
      args[index] = value;
      assert.throws(() => prepareImageCall('create', args, unexpectedBorrow), /u32/);
    }
  }
  for (const field of Object.keys(color)) {
    for (const value of [-1, 256, 0.5, NaN, Infinity, '1', true, null, undefined, 1n]) {
      assert.throws(() => prepareImageCall('create', [1, 1, { ...color, [field]: value }], unexpectedBorrow), /u8/);
    }
  }
});

test('records require own WIT fields and reject non-record shapes', () => {
  for (const value of [[], new Date(), new Uint8Array(4), true, 'rgba8', 0, Object.create(color), {}]) {
    assert.throws(() => prepareImageCall('create', [1, 1, value], borrow), /record/);
  }
  for (const value of [null, undefined, [], new Date(), Object.create(rect), {}]) {
    assert.throws(() => prepareImageCall('crop', [ref, value], borrow), /record/);
  }
  for (const field of Object.keys(color)) {
    const incomplete = { ...color };
    delete incomplete[field];
    assert.throws(() => prepareImageCall('create', [1, 1, incomplete], borrow), /Missing/);
  }
  for (const field of Object.keys(rect)) {
    const incomplete = { ...rect };
    delete incomplete[field];
    assert.throws(() => prepareImageCall('crop', [ref, incomplete], borrow), /Missing/);
  }
});

test('crop borrows once and preserves signed edges including reversed rectangles', () => {
  let count = 0;
  const args = [ref, rect];
  assert.deepEqual(prepareImageCall('crop', args, value => { count++; return borrow(value); }), {
    values: [image, rect], resource: true,
  });
  assert.equal(count, 1);
  assert.equal(args[0], ref);
  assert.equal(args[1], rect);
  assert.deepEqual(prepareImageCall('crop', [ref, Object.assign(Object.create(null), rect)], borrow).values[1], rect);
  for (const field of Object.keys(rect)) {
    for (const value of [-2147483649, 2147483648, 0.5, NaN, Infinity, -Infinity, '1', true, null, undefined, 1n]) {
      assert.throws(() => prepareImageCall('crop', [ref, { ...rect, [field]: value }], borrow), /s32/);
    }
  }
});

test('info and export delegate opaque references and return non-resource results', () => {
  assert.deepEqual(prepareImageCall('info', [ref], borrow), { values: [image], resource: false });
  for (const format of ['png', 'qoi']) {
    assert.deepEqual(prepareImageCall('export', [ref, format], borrow), { values: [image, format], resource: false });
  }
  for (const format of ['PNG', 'jpeg', '', null, undefined, 1, {}, { tag: 'png' }]) {
    assert.throws(() => prepareImageCall('export', [ref, format], borrow), /format/);
  }
  for (const method of ['info', 'crop', 'export']) {
    const args = method === 'info' ? [ref] : [ref, method === 'crop' ? rect : 'png'];
    const failure = new Error('invalid or released resource');
    assert.throws(() => prepareImageCall(method, args, () => { throw failure; }), error => error === failure);
  }
  const opaque = Symbol('opaque');
  assert.equal(prepareImageCall('info', [opaque], value => value).values[0], opaque);
});
