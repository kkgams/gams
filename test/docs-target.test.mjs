import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'gams-docs-'));
  try {
    await mkdir(join(directory, 'scripts/game-icons'), { recursive: true });
    await copyFile(join(root, 'Makefile'), join(directory, 'Makefile'));
    await copyFile(join(root, 'scripts/game-icons/source.mk'), join(directory, 'scripts/game-icons/source.mk'));
    await mkdir(join(directory, 'cmd/app/src/fonts'), { recursive: true });
    await copyFile(join(root, 'cmd/app/src/fonts/game-icons.woff2'), join(directory, 'cmd/app/src/fonts/game-icons.woff2'));
    await mkdir(join(directory, 'build.nosync'), { recursive: true });
    await writeFile(join(directory, 'build.nosync/wiki-v1.4.0.mk'),
      '.PHONY: serve validate\nserve validate:\n\t@printf "UPSTREAM:%s|%s|%s|%s|%s\\n" "$@" "$(WIKI_SOURCE)" "$(PORT)" "$(WIKI_ENGINE)" "$(WIKI_VERSION)"\n');
    const make = (...args) => spawnSync('make', [...args, 'HOST_CC=cc', 'HOST_CXX=c++'], { cwd: directory, encoding: 'utf8' });
    await run({ directory, make });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('docs targets delegate to cached upstream Makefile with canonical docs and port', async () => {
  await fixture(async ({ directory, make }) => {
    for (const [target, upstream] of [['serve-docs', 'serve'], ['validate-docs', 'validate']]) {
      const result = make(target, 'PORT=3333');
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(`UPSTREAM:${upstream}|${join(await realpath(directory), 'docs')}|3333|build.nosync/wiki-v1.4.0|v1.4.0`), result.stdout);
      assert.doesNotMatch(result.stdout, /Downloading|curl|serve-docs\.py|docs-wiki/);
      assert.deepEqual(await readFile(join(directory, 'docs/assets/game-icons.woff2')),
        await readFile(join(root, 'cmd/app/src/fonts/game-icons.woff2')));
    }
  });
});

test('custom engines must exist and are not overwritten', async () => {
  await fixture(async ({ directory, make }) => {
    await mkdir(join(directory, 'custom/scripts'), { recursive: true });
    await writeFile(join(directory, 'custom/scripts/serve.mjs'), '// custom');
    let result = make('serve-docs', 'WIKI_ENGINE=custom');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('|custom|v1.4.0'), result.stdout);
    assert.equal(await readFile(join(directory, 'custom/scripts/serve.mjs'), 'utf8'), '// custom');
    result = make('serve-docs', 'WIKI_ENGINE=missing');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Wiki engine not found/);
    assert.doesNotMatch(result.stdout, /UPSTREAM:/);
  });
});

test('docs CSS uses the locally copied font and enables name ligatures', async () => {
  const css = await readFile(join(root, 'docs/custom.css'), 'utf8');
  assert.match(css, /url\("content\/assets\/game-icons\.woff2"\)/);
  assert.match(css, /font-feature-settings: "liga" 1/);
  assert.match(css, /\.prose \.game-icons/);
});

test('sidebar uses native wiki routes and release aliases preserve original records', async () => {
  const sidebar = await readFile(join(root, 'docs/_sidebar.md'), 'utf8');
  for (const [, route] of sidebar.matchAll(/\[\[([^|\]]+)/g)) {
    assert.match(await readFile(join(root, 'docs', `${route}.md`), 'utf8'), /^---\ntitle: .+\nstatus: reference\n---/);
  }
  for (const version of ['5', '6']) {
    assert.equal(await realpath(join(root, `docs/release-2-0-${version}-review.md`)),
      await realpath(join(root, `docs/release-2.0.${version}-review.md`)));
  }
});
