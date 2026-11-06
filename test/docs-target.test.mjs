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
    await copyFile(join(root, 'scripts/package-host.py'), join(directory, 'scripts/package-host.py'));
    const git = spawnSync('git', ['init', '--quiet'], { cwd: directory, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    await mkdir(join(directory, 'docs'));
    await copyFile(join(root, 'scripts/game-icons/source.mk'), join(directory, 'scripts/game-icons/source.mk'));
    await mkdir(join(directory, 'cmd/app/src/fonts'), { recursive: true });
    await copyFile(join(root, 'cmd/app/src/fonts/game-icons.woff2'), join(directory, 'cmd/app/src/fonts/game-icons.woff2'));
    await mkdir(join(directory, 'build.nosync'), { recursive: true });
    await writeFile(join(directory, 'build.nosync/wiki-v1.4.0.mk'),
      '.PHONY: serve validate build\nserve validate build:\n\t@printf "UPSTREAM:%s|%s|%s|%s|%s\\n" "$@" "$(WIKI_SOURCE)" "$(PORT)" "$(WIKI_ENGINE)" "$(WIKI_VERSION)"\n');
    const make = (...args) => spawnSync('make', [...args, 'HOST_CC=cc', 'HOST_CXX=c++'], { cwd: directory, encoding: 'utf8' });
    await run({ directory, make });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('docs targets delegate to cached upstream Makefile with staged docs and port', async () => {
  await fixture(async ({ directory, make }) => {
    for (const [target, upstream] of [['serve-docs', 'serve'], ['validate-docs', 'validate'], ['docs', 'build']]) {
      const result = make(target, 'PORT=3333');
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /Circular/);
      assert.ok(result.stdout.includes(`UPSTREAM:${upstream}|${join(await realpath(directory), 'build.nosync/docs-source')}|3333|build.nosync/wiki-v1.4.0|v1.4.0`), result.stdout);
      assert.doesNotMatch(result.stdout, /Downloading|curl|serve-docs\.py|docs-wiki/);
      assert.deepEqual(await readFile(join(directory, 'build.nosync/docs-source/assets/game-icons.woff2')),
        await readFile(join(root, 'cmd/app/src/fonts/game-icons.woff2')));
    }
  });
});

test('docs port has an independent override and defaults remain compatible', async () => {
  await fixture(async ({ make }) => {
    let result = make('serve-docs');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\|8080\|/);
    result = make('serve-docs', 'PORT=3333', 'DOCS_PORT=4444');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\|4444\|/);
    result = make('-n', 'serve-promo', 'PROMO_PORT=5555', 'DOCS_PORT=4444');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--port "5555" --docs-port "4444"/);
  });
});

test('site assembly nests the wiki, resolves aliases, and preserves output on failure', {
  skip: process.platform === 'win32' ? 'POSIX symlink fixture requires ln -s and symlink privileges' : false,
}, async () => {
  await fixture(async ({ directory, make }) => {
    await mkdir(join(directory, 'promo'));
    await writeFile(join(directory, 'promo/index.html'), '<a href="docs/">Docs</a>');
    await writeFile(join(directory, 'build.nosync/wiki-v1.4.0.mk'),
      'build:\n\t@test "$(FAIL_BUILD)" != yes\n\t@mkdir -p "$(WIKI_OUTPUT)/content"\n\t@printf wiki > "$(WIKI_OUTPUT)/index.html"\n\t@printf page > "$(WIKI_OUTPUT)/content/original.md"\n\t@ln -s original.md "$(WIKI_OUTPUT)/content/alias.md"\n');
    let result = make('promo');
    assert.equal(result.status, 0, result.stderr);
    const site = join(directory, 'build.nosync/site');
    assert.match(await readFile(join(site, 'index.html'), 'utf8'), /href="docs\/"/);
    assert.equal(await readFile(join(site, 'docs/index.html'), 'utf8'), 'wiki');
    assert.equal(await readFile(join(site, 'docs/content/alias.md'), 'utf8'), 'page');
    assert.equal(await realpath(join(site, 'docs/content/alias.md')), join(await realpath(site), 'docs/content/alias.md'));
    assert.equal(await readFile(join(site, '.nojekyll'), 'utf8'), '');
    result = make('promo', 'FAIL_BUILD=yes');
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(site, 'docs/index.html'), 'utf8'), 'wiki');
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

test('sidebar uses existing native wiki routes with reference frontmatter', async () => {
  const sidebar = await readFile(join(root, 'docs/_sidebar.md'), 'utf8');
  for (const [, route] of sidebar.matchAll(/\[\[([^|\]]+)/g)) {
    assert.match(await readFile(join(root, 'docs', `${route}.md`), 'utf8'), /^---\ntitle: .+\nstatus: reference\n---/);
  }
});
