#!/usr/bin/env python3
"""Compare release ZIP's human-readable third-party texts to reviewed sources."""

from pathlib import Path
import sys
from zipfile import ZipFile


def assert_members(archive: ZipFile, pairs: dict[str, Path]) -> None:
    for member, source in pairs.items():
        if archive.read(member) != source.read_bytes():
            raise ValueError(f"Archive notice differs from reviewed source: {member}")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('usage: check-candidate-notices.py APP.zip')
    root = Path.cwd()
    common = {name: root / name for name in ('LICENSE', 'NOTICE', 'NOTICE-EVIDENCE.sha256')}
    app = {
        **common,
        'NATIVE-NOTICES.md': root / 'NATIVE-NOTICES.md',
        'NATIVE-SOURCE/README.md': root / 'NATIVE-SOURCE/README.md',
        'FONT-PROVENANCE.md': root / 'cmd/app/src/fonts/PROVENANCE.md',
        'BUNDLE-LICENSES/ajv/PROVENANCE.md': root / 'cmd/app/src/util/BUNDLE-REVIEW.md',
        'BUNDLE-LICENSES/markdown-it/PROVENANCE.md': root / 'cmd/app/src/widgets/BUNDLE-REVIEW.md',
        'BUNDLE-LICENSES/aseprite-reference.LICENSE': root / 'cmd/app/src/util/aseprite.LICENSE',
        'BUNDLE-LICENSES/markdown-it/markdown-it.LICENSE': root / 'cmd/app/src/widgets/markdown-it.LICENSE',
    }
    for crate_source in (root / 'NATIVE-SOURCE').glob('*.crate'):
        app[f'NATIVE-SOURCE/{crate_source.name}'] = crate_source
    for archive_dir, source_dir, pattern in (
        ('FONT-LICENSES', 'cmd/app/src/fonts/licenses', '*.txt'),
        ('BUNDLE-LICENSES/ajv', 'cmd/app/src/util/licenses', '*.LICENSE'),
        ('BUNDLE-LICENSES/markdown-it', 'cmd/app/src/widgets/licenses', '*.LICENSE'),
    ):
        for source in (root / source_dir).glob(pattern):
            app[f'{archive_dir}/{source.name}'] = source
    with ZipFile(sys.argv[1]) as app_zip:
        assert_members(app_zip, app)
        if any(name.startswith('examples/') for name in app_zip.namelist()):
            raise ValueError('Host ZIP must not include example source')
    print(f'Reviewed texts match Host ZIP: {len(app)} files')


if __name__ == '__main__':
    main()
