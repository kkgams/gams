#!/usr/bin/env python3
"""Refuse Host distribution if any Git ancestor includes a Project/game source."""

from pathlib import Path
import subprocess


def git(*args: str) -> str:
    return subprocess.check_output(['git', *args], text=True).strip()


def forbidden(path: str) -> bool:
    return path == 'gams.json' or path.startswith(('examples/', 'game/', 'content/'))


if git('rev-parse', '--is-shallow-repository') != 'false':
    raise SystemExit('Full Host Git history is required for source boundary review')
for prefix in ('examples', 'game', 'content'):
    if (Path.cwd() / prefix).exists() or (Path.cwd() / prefix).is_symlink():
        raise SystemExit(f'Example source remains in Host worktree: {prefix}')
for commit in git('rev-list', 'HEAD').splitlines():
    paths = git('ls-tree', '-r', '--name-only', commit).splitlines()
    leaked = [path for path in paths if forbidden(path)]
    if leaked:
        raise SystemExit(f'Host Git history contains Project/game source in {commit}: {leaked[:5]}')
print('Host source boundary: no Project/game source in worktree or Git ancestry')
