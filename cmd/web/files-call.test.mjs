import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFilesystemCall, filesystemHostValue } from './files-call.ts';

test('allow exactly the WIT targets with camelCase names and exact arities', () => {
  const calls = [
    ['read-file', 'readFile', ['file']], ['read-text', 'readText', ['file']],
    ['write-file', 'writeFile', ['file', [0, 255]]], ['write-text', 'writeText', ['file', 'text']],
    ['list', 'list', ['.']], ['stat', 'stat', ['file']], ['create-dir', 'createDir', ['dir']],
    ['remove-file', 'removeFile', ['file']], ['remove-dir', 'removeDir', ['dir']],
    ['rename', 'rename', ['old', 'new']],
  ];
  for (const [method, name, args] of calls) {
    const target = `fs/fs::${method}`;
    assert.equal(prepareFilesystemCall(target, args).name, name);
    assert.throws(() => prepareFilesystemCall(target, args.slice(1)), /requires/);
    assert.throws(() => prepareFilesystemCall(target, [...args, 'extra']), /requires/);
  }
  for (const target of ['read-file', 'fs::read-file', 'fs/fs::readFile', 'fs/fs::copy',
    'fs/fs::toString', 'toString', '__proto__', 'fs/fs::list ', 'gams:fs/fs::list']) {
    assert.throws(() => prepareFilesystemCall(target, ['.']), /Unsupported/);
  }
  assert.throws(() => prepareFilesystemCall('fs/fs::list', null), /requires/);
});

test('map Project paths and both rename arguments without backend absolute path interpretation', () => {
  for (const root of ['.', '/']) {
    assert.deepEqual(prepareFilesystemCall('fs/fs::list', [root]), { name: 'list', values: ['/project'] });
  }
  for (const path of ['foo/bar', '/foo/bar']) {
    assert.deepEqual(prepareFilesystemCall('fs/fs::read-text', [path]), {
      name: 'readText', values: ['/project/foo/bar'],
    });
  }
  assert.deepEqual(prepareFilesystemCall('fs/fs::rename', ['/old/file', 'new/file']), {
    name: 'rename', values: ['/project/old/file', '/project/new/file'],
  });
  assert.deepEqual(prepareFilesystemCall('fs/fs::stat', ['/project/file']).values, ['/project/project/file']);
  assert.deepEqual(prepareFilesystemCall('fs/fs::stat', ['/tmp/file']).values, ['/project/tmp/file']);
});

test('reject malformed paths in every path position without normalizing invalid segments away', () => {
  const invalid = ['', '..', '../file', '/..', '/a/../b', './a', '/./a', 'a/.',
    'a//b', '//a', 'a/', '/a/', 'a\\b', '\\file', 'a\0b', null, 12, {}, []];
  for (const path of invalid) {
    for (const method of ['read-file', 'read-text', 'list', 'stat', 'create-dir', 'remove-file', 'remove-dir']) {
      assert.throws(() => prepareFilesystemCall(`fs/fs::${method}`, [path]));
    }
    assert.throws(() => prepareFilesystemCall('fs/fs::write-file', [path, []]));
    assert.throws(() => prepareFilesystemCall('fs/fs::write-text', [path, '']));
    assert.throws(() => prepareFilesystemCall('fs/fs::rename', [path, 'valid']));
    assert.throws(() => prepareFilesystemCall('fs/fs::rename', ['valid', path]));
  }
});

test('write-file accepts byte lists and Uint8Array without coercion or input mutation', () => {
  for (const bytes of [[], [0, 1, 127, 255], new Uint8Array([0, 255])]) {
    const args = ['file', bytes];
    const result = prepareFilesystemCall('fs/fs::write-file', args);
    assert.ok(result.values[1] instanceof Uint8Array);
    assert.deepEqual([...result.values[1]], [...bytes]);
    assert.equal(args[0], 'file');
    assert.equal(args[1], bytes);
  }
  for (const bytes of [null, 'abc', {}, new Uint16Array([1]), [256], [-1], [1.5],
    [NaN], [Infinity], ['1'], [true], [null], [undefined], [1n], Array(1)]) {
    assert.throws(() => prepareFilesystemCall('fs/fs::write-file', ['file', bytes]));
  }
});

test('write-text requires an actual string, including an empty string', () => {
  assert.deepEqual(prepareFilesystemCall('fs/fs::write-text', ['file', '']).values, ['/project/file', '']);
  for (const text of [null, undefined, 1, true, [], {}, new String('text')]) {
    assert.throws(() => prepareFilesystemCall('fs/fs::write-text', ['file', text]), /requires a string/);
  }
});

test('convert WIT payload shapes recursively without adding a response envelope', () => {
  assert.equal(filesystemHostValue(undefined), null);
  assert.equal(filesystemHostValue('text'), 'text');
  assert.deepEqual(filesystemHostValue(new Uint8Array([0, 255])), [0, 255]);
  const stat = { type: 'file', size: 20n, atime: 0n, mtime: 9007199254740992n, ctime: 0n };
  assert.deepEqual(filesystemHostValue({ stat, entries: [{ name: 'file', type: 'file' }],
    nested: [undefined, null, true, 1.5, new Uint8Array([3])] }), {
    stat: { type: 'file', size: 20, atime: 0, mtime: '9007199254740992', ctime: 0 },
    entries: [{ name: 'file', type: 'file' }], nested: [null, null, true, 1.5, [3]],
  });
  assert.equal(stat.size, 20n);
});

test('preserve bigint values at both safe integer boundaries', () => {
  for (const number of [Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(filesystemHostValue(BigInt(number)), number);
  }
  for (const bigint of [-9007199254740992n, 9007199254740992n, 18446744073709551615n]) {
    assert.equal(filesystemHostValue(bigint), bigint.toString());
  }
});

test('reject unsupported and nonfinite payloads, nested invalid values and cycles', () => {
  for (const value of [NaN, Infinity, -Infinity, Symbol('x'), () => {}, new Date(), new Map(),
    new Set(), new Uint16Array([1]), new ArrayBuffer(2), /x/, { [Symbol('x')]: 1 }]) {
    assert.throws(() => filesystemHostValue(value));
    assert.throws(() => filesystemHostValue({ nested: [value] }));
  }
  const record = {};
  record.self = record;
  const array = [];
  array.push(array);
  assert.throws(() => filesystemHostValue(record), /Cyclic/);
  assert.throws(() => filesystemHostValue(array), /Cyclic/);
  const shared = { value: 1n };
  assert.deepEqual(filesystemHostValue([shared, shared]), [{ value: 1 }, { value: 1 }]);
  assert.deepEqual(filesystemHostValue(Object.assign(Object.create(null), { value: 2n })), { value: 2 });
  const specialKey = JSON.parse('{"__proto__":{"value":3}}');
  assert.deepEqual(filesystemHostValue(specialKey), specialKey);
});
