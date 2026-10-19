"""Preparation regression tests; no network or third-party Python packages needed."""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare', ROOT / 'scripts/game-icons/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="M10 10h40v40H10z M20 20v20h20V20z"/></svg>'


class PreparationTests(unittest.TestCase):
    def test_background_only_removed_and_compound_artwork_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'test.svg'
            source.write_text(SVG)
            result = prepare.foreground(source)
            self.assertNotIn('M0 0h512v512H0z', result)
            self.assertIn('M10 10h40v40H10z M20 20v20h20V20z', result)
            source.write_text(SVG.replace('fill="#fff"', 'fill="#888"'))
            with self.assertRaisesRegex(ValueError, 'unexpected SVG'):
                prepare.foreground(source)

    def test_duplicate_names_badge_exclusion_and_cc0(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ['lorc/fire', 'delapouite/fire', 'viscious-speed/unique',
                         'various-artists/infinity', 'badges/decoration']:
                file = root / 'source' / f'{name}.svg'
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(SVG)
            (root / 'source/license.txt').write_text('upstream contributor credits')
            manifest = prepare.prepare(root / 'source', root / 'out', 'test-revision')
            icons = {item['ligature']: item for item in manifest['icons']}
            self.assertEqual(set(icons), {'lorc-fire', 'delapouite-fire', 'unique', 'infinity'})
            self.assertEqual(icons['unique']['license'], 'CC0-1.0')
            self.assertEqual(icons['infinity']['license'], 'CC0-1.0')
            self.assertEqual(icons['lorc-fire']['license'], 'CC-BY-3.0')
            self.assertEqual([item['codepoint'] for item in manifest['icons']], list(range(0xE000, 0xE004)))
            self.assertEqual(json.loads((root / 'out/game-icons.json').read_text()), manifest)

    def test_hyphenated_ligatures_keep_a_single_webkit_shaping_run(self):
        # Browser/WKWebView integration verifies rendering; this guards both
        # canonical CSS entry points against dropping the required shaping rule.
        for file, selector in [('cmd/app/src/css/base.css', 'i.game-icons'),
                               ('docs/custom.css', '.prose .game-icons')]:
            css = (ROOT / file).read_text()
            rule = re.search(re.escape(selector) + r'\s*\{([^}]+)\}', css)
            self.assertIsNotNone(rule, file)
            self.assertIn('word-break: keep-all;', rule.group(1), file)

    def test_checked_in_catalogue_covers_manifest(self):
        manifest = json.loads((ROOT / 'cmd/app/src/fonts/game-icons.json').read_text())
        docs = (ROOT / 'docs/game-icons.md').read_text()
        self.assertEqual(len(manifest['icons']), 4180)
        self.assertNotIn('<img ', docs)
        self.assertEqual(docs.count('<span class="game-icons" aria-hidden="true">'), len(manifest['icons']))
        for item in manifest['icons']:
            self.assertIn(f'<span class="game-icons" aria-hidden="true">{item["ligature"]}</span> | `{item["ligature"]}` |', docs)


if __name__ == '__main__':
    unittest.main()
