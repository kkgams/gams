#!/usr/bin/env python3
"""Verify all supplied MPL-covered crate sources match pinned Cargo.lock."""

from hashlib import sha256
from pathlib import Path
import tarfile
import tomllib

root = Path('NATIVE-SOURCE')
archives = sorted(root.glob('*.crate'))
if len(archives) != 5:
    raise SystemExit(f'Expected five MPL source archives, found {len(archives)}')
locked = {(p['name'], p['version']): p for p in
          tomllib.loads(Path('cmd/app/src-tauri/Cargo.lock').read_text())['package']}
expected = {'cssparser', 'cssparser-macros', 'dtoa-short', 'option-ext', 'selectors'}
for archive in archives:
    name, version = archive.stem.rsplit('-', 1)
    if name not in expected or (name, version) not in locked:
        raise SystemExit(f'Unexpected MPL source: {archive}')
    info = locked[(name, version)]
    if sha256(archive.read_bytes()).hexdigest() != info['checksum']:
        raise SystemExit(f'MPL archive differs from Cargo.lock: {archive}')
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if not any(m.name.endswith(('/LICENSE', '/LICENSE.txt')) for m in members):
            # selectors' published crate has per-source MPL-2.0 headers but no
            # standalone LICENSE; the full MPL text is in NATIVE-NOTICES.md.
            if name != 'selectors':
                raise SystemExit(f'Missing upstream license inside {archive}')
            source = next(m for m in members if m.name.endswith('/lib.rs'))
            if b'Mozilla Public' not in tar.extractfile(source).read(320):
                raise SystemExit('selectors source lacks expected MPL header')
    expected.remove(name)
if expected:
    raise SystemExit(f'Missing MPL source archives: {expected}')
print('Five exact MPL crate source archives match Cargo.lock')
