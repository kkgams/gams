#!/usr/bin/env python3
"""Bind owner-reviewed NOTICE to all shipped third-party inputs and full texts."""

import argparse
from hashlib import sha256
from pathlib import Path
import re

ROOT = Path.cwd()
GROUPS = {
    'cmd/app/src/fonts/*.woff2': 10,
    'cmd/app/src/fonts/licenses/*.txt': 8,
    'cmd/app/src/util/licenses/*.LICENSE': 6,
    'cmd/app/src/widgets/licenses/*.LICENSE': 6,
    'NATIVE-SOURCE/*.crate': 5,
}
FILES = [
    'cmd/app/src/fonts/PROVENANCE.md',
    'cmd/app/src/util/ajv.js', 'cmd/app/src/util/BUNDLE-REVIEW.md',
    'cmd/app/src/util/aseprite.js', 'cmd/app/src/util/aseprite.LICENSE',
    'cmd/app/src/widgets/markdown-it.js', 'cmd/app/src/widgets/markdown-it.LICENSE',
    'cmd/app/src/widgets/BUNDLE-REVIEW.md',
    'cmd/app/src-tauri/Cargo.lock', 'native-about.toml', 'NATIVE-NOTICES.md',
    'NATIVE-SOURCE/README.md',
]


def evidence() -> bytes:
    paths = [ROOT / name for name in FILES]
    for pattern, expected_count in GROUPS.items():
        matches = sorted(ROOT.glob(pattern))
        if len(matches) != expected_count:
            raise ValueError(f'{pattern}: expected {expected_count} files, got {len(matches)}')
        paths.extend(matches)
    if len(set(paths)) != len(paths):
        raise ValueError('Duplicate third-party evidence path')
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or symlinked evidence: {path}')
    return ''.join(f'{sha256(path.read_bytes()).hexdigest()}  {path.relative_to(ROOT)}\n'
                   for path in sorted(paths)).encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-manifest', action='store_true',
                        help='Prepare manifest for explicit owner review; never modifies NOTICE')
    args = parser.parse_args()
    manifest = evidence()
    digest = sha256(manifest).hexdigest()
    if args.write_manifest:
        Path('NOTICE-EVIDENCE.sha256').write_bytes(manifest)
        print(f'Candidate NOTICE evidence SHA-256: {digest}')
        return
    saved = Path('NOTICE-EVIDENCE.sha256').read_bytes()
    if saved != manifest:
        raise SystemExit('Third-party files differ from owner-reviewed NOTICE-EVIDENCE.sha256')
    notice = Path('NOTICE').read_text()
    marker = re.search(r'^Third-party evidence SHA-256: `([0-9a-f]{64})`$', notice, re.M)
    if not marker or marker.group(1) != digest:
        raise SystemExit('NOTICE does not bind the exact third-party evidence manifest')
    print(f'NOTICE binds {len(manifest.splitlines())} third-party inputs: {digest}')


if __name__ == '__main__':
    main()
