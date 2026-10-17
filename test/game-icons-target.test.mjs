import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('checked-in Game Icons font needs no build cache, npm, Python or network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gams-game-icons-'));
  try {
    await mkdir(join(dir, 'scripts/game-icons'), { recursive: true });
    await mkdir(join(dir, 'cmd/app/src/fonts'), { recursive: true });
    await copyFile(join(root, 'Makefile'), join(dir, 'Makefile'));
    await copyFile(join(root, 'scripts/game-icons/source.mk'), join(dir, 'scripts/game-icons/source.mk'));
    await writeFile(join(dir, 'cmd/app/src/fonts/game-icons.woff2'), 'already built');
    const result = spawnSync('make', ['cmd/app/src/fonts/game-icons.woff2', 'BUILD_DIR=missing-cache', 'HOST_CC=cc', 'HOST_CXX=c++'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /up to date/);
    assert.doesNotMatch(result.stdout, /curl|npm|python|node scripts/);
    assert.equal(result.stderr, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
