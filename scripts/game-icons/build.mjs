import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [preparedArg, toolingArg, outputArg, pythonArg] = process.argv.slice(2);
assert(preparedArg && toolingArg && outputArg && pythonArg, 'Expected prepared, tooling, output, Python paths');
const prepared = path.resolve(preparedArg);
const output = path.resolve(outputArg);
const { default: svgtofont } = await import(pathToFileURL(path.resolve(toolingArg, 'node_modules/svgtofont/lib/index.js')));
const manifest = JSON.parse(await readFile(path.join(prepared, 'game-icons.json'), 'utf8'));
const codepoints = new Map(manifest.icons.map(icon => [icon.ligature, icon.codepoint]));
await mkdir(output, { recursive: true });
await svgtofont({
  src: path.join(prepared, 'svg'),
  dist: output,
  fontName: 'game-icons',
  css: false,
  log: false,
  addLigatures: true,
  startUnicode: 0xE000,
  getIconUnicode(name, _unicode, start) {
    assert(codepoints.has(name), `Unknown glyph: ${name}`);
    return [String.fromCodePoint(codepoints.get(name)), start];
  },
  svgicons2svgfont: { fontHeight: 512, descent: 0, normalize: false, fixedWidth: true },
  svg2ttf: {
    ts: 0,
    copyright: 'Icons made by the contributors listed in game-icons.contributors.txt; game-icons.net. CC BY 3.0 / CC0. Converted to a ligature font by GAMS.',
  },
  excludeFormat: ['eot', 'woff', 'woff2', 'symbol.svg'],
});
execFileSync(pythonArg, ['scripts/game-icons/finish.py', output, path.join(prepared, 'game-icons.json')], { stdio: 'inherit' });
// svgtofont catches some generation errors internally: validate required outputs ourselves.
const font = await readFile(path.join(output, 'game-icons.woff2'));
assert.equal(font.toString('ascii', 0, 4), 'wOF2', 'Missing/invalid WOFF2');
assert(font.length > 1000, 'Unexpectedly small WOFF2');
const svg = (await readFile(path.join(output, 'game-icons.svg'), 'utf8'))
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
for (const { ligature } of manifest.icons) {
  assert(svg.includes(`unicode="${ligature}"`), `Missing ligature: ${ligature}`);
}
await writeFile(path.join(output, 'game-icons.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(output, 'game-icons.contributors.txt'), await readFile(path.join(prepared, 'game-icons.contributors.txt')));
const revision = manifest.revision;
const raw = `https://raw.githubusercontent.com/game-icons/icons/${revision}`;
const repo = `https://github.com/game-icons/icons/tree/${revision}`;
let docs = `---\ntitle: "Game Icons catalogue"\nstatus: reference\n---\n\n# Game Icons catalogue\n\nGenerated from [game-icons/icons @ ${revision.slice(0, 12)}](${repo}).\n\n`;
docs += `${manifest.icons.length} icons. Names are exact, case-sensitive ligatures, including hyphens. Duplicate upstream filenames are contributor-prefixed (both variants).\n\n`;
docs += 'Use `<i class="game-icons" aria-hidden="true">crystal-ball</i>`; bare `<i>` remains Material Symbols. Core Views may use this markup under the [View guide icon rules](#/gams-view-development-guide?section=icons).\n\n';
docs += 'See [build and licensing notes](#/game-icons-build). Previews below render the actual generated Game Icons font using the listed ligatures. Run `make serve-docs` to view them; no remote images are needed. Badges are repository tooling assets and are excluded, as in the upstream colorization script.\n\n';
docs += `Icons made by the credited authors. CC BY 3.0 except rows marked CC0-1.0. The font removes the square backgrounds and converts artwork to monochrome glyphs with name ligatures. [Contributor notices](${raw}/license.txt).\n\n`;
docs += '| Icon | Ligature | Author | License |\n| --- | --- | --- | --- |\n';
for (const icon of manifest.icons) {
  docs += `| <span class="game-icons" aria-hidden="true">${icon.ligature}</span> | \`${icon.ligature}\` | ${icon.author} | ${icon.license} |\n`;
}
await writeFile(path.join(output, 'game-icons.md'), docs);
const digest = createHash('sha256').update(font).digest('hex');
await writeFile(path.join(output, 'GAME-ICONS-PROVENANCE.md'), `# Generated Game Icons font\n\n- Source: [game-icons/icons @ ${revision}](${repo}).\n- Archive: https://codeload.github.com/game-icons/icons/tar.gz/${revision}\n- Generator: svgtofont 6.5.3 plus FontTools 4.67.0 (large GSUB compilation/WOFF2); exact dependencies: scripts/game-icons/package-lock.json and requirements.txt.\n- Recipe: scripts/game-icons/{prepare.py,build.mjs,finish.py}; rebuild: see docs/game-icons-build.md.\n- ${manifest.icons.length} icons; badges excluded. Duplicate basenames are contributor-prefixed.\n- Transformations: remove verified background square, preserve foreground paths/holes, convert to monochrome glyphs, assign private-use codepoints and name ligatures.\n- License: CC BY 3.0; Viscious Speed, Zeromancer and Various artists icons are CC0-1.0.\n- Icons made by the authors credited per icon in game-icons.json and in licenses/game-icons.contributors.txt.\n- Various artists CC0 exceptions (not listed in upstream license.txt): https://game-icons.net/1x1/various-artists/infinity.html and https://game-icons.net/1x1/various-artists/salmon.html; the salmon page additionally credits the Swedish Road Administration for the original design.\n- Full texts: licenses/game-icons.CC-BY-3.0.txt and licenses/game-icons.CC0-1.0.txt.\n- Font SHA-256 (identifies generated bytes; not an archive download check): \`${digest}\`.\n\nDistribution requires exact Host NOTICE/evidence review for these bytes. Generated hashes and passing consistency checks do not grant owner approval.\n`);
console.log(`Generated ${manifest.icons.length} ligatures, ${font.length} WOFF2 bytes (${digest})`);
