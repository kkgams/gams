"""Add the static Web Host to a staged GitHub Pages promo/docs site."""
import shutil
import sys
from pathlib import Path


def merge(web, pages, sources):
    entry = (web / 'index.html').read_text(encoding='utf-8')
    launcher = 'src="/browser-launch.js"'
    if entry.count(launcher) != 1 or (pages / 'app.html').exists():
        raise ValueError('Expected one Web Host launcher and no existing app.html')
    for source in sorted(web.rglob('*')):
        relative = source.relative_to(web)
        if not source.is_file() or relative.as_posix() in {'index.html', '_headers'}:
            continue
        target = pages / relative
        if target.exists():
            if target.read_bytes() != source.read_bytes():
                raise ValueError(f'Promo/Web Host asset collision: {relative}')
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    (pages / 'app.html').write_text(entry.replace(launcher, 'src="/pages-launch.js"'), encoding='utf-8')
    for name in ('pages-isolation-sw.js', 'pages-launch.js'):
        shutil.copy2(sources / name, pages / name)


if __name__ == '__main__':
    merge(*map(Path, sys.argv[1:]))
