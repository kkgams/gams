#!/usr/bin/env python3
"""Generate a complete commit/author changelog from published ancestor releases."""

import argparse
import json
from pathlib import Path
import re
import subprocess


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def escape(text):
    return re.sub(r'([\\`*_{}\[\]<>#!|])', r'\\\1', text.replace('\r', ' ').replace('\n', ' '))


def generate(tag, repository, releases, guide):
    if repository != 'kkgams/gams':
        raise ValueError('Unexpected release repository')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag):
        raise ValueError('Invalid release tag')
    if git('rev-parse', '--is-shallow-repository') != 'false':
        raise ValueError('Full history required for release notes')
    head = git('rev-parse', f'refs/tags/{tag}^{{commit}}')
    if head != git('rev-parse', 'HEAD'):
        raise ValueError('Release tag must match checkout HEAD')
    # API results include drafts and prereleases. Only a published stable
    # ancestor is a baseline; failed tags alone do not hide commits.
    published = {r['tag_name'] for r in releases
                 if not r['draft'] and not r['prerelease']
                 and r['published_at'] is not None and r['tag_name'] != tag}
    candidates = []
    for previous in published:
        if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', previous):
            continue
        commit = git('rev-parse', f'refs/tags/{previous}^{{commit}}')
        ancestor = subprocess.run(['git', 'merge-base', '--is-ancestor', commit, head])
        if ancestor.returncode not in (0, 1):
            ancestor.check_returncode()
        if ancestor.returncode == 0:
            distance = int(git('rev-list', '--count', f'{commit}..{head}'))
            candidates.append((distance, previous, commit))
    baseline = min(candidates) if candidates else None
    revision = f'{baseline[2]}..{head}' if baseline else head
    hashes = git('rev-list', '--reverse', revision).splitlines()
    lines = [guide.rstrip(), '', '## Changelog', '']
    url = f'https://github.com/{repository}'
    if baseline:
        previous = baseline[1]
        lines += [f'Changes since [{previous}]({url}/releases/tag/{previous}).', '']
    else:
        lines += ['First published release: complete Host commit history.', '']
    for sha in hashes:
        subject = escape(git('show', '-s', '--format=%s', sha))
        author = escape(git('show', '-s', '--format=%aN', sha))
        lines.append(f'- [{sha[:8]}]({url}/commit/{sha}) {subject} — {author}')
    lines += ['', '## Authors', '']
    authors = sorted({git('show', '-s', '--format=%aN', sha) for sha in hashes})
    lines.extend(f'- {escape(author)}' for author in authors)
    if baseline:
        lines += ['', f'[Full comparison]({url}/compare/{baseline[1]}...{tag})']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--releases', type=Path, required=True,
                        help='JSON array from authenticated, paginated Releases API')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    releases = json.loads(args.releases.read_text())
    if not isinstance(releases, list):
        raise ValueError('Expected Releases API array')
    args.output.write_text(generate(args.tag, args.repository, releases,
                                   Path('.github/RELEASE_GUIDE.md').read_text()))


if __name__ == '__main__':
    main()
