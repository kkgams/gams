#!/usr/bin/env python3
"""Compile large ligature tables safely and verify every name with HarfBuzz."""
import argparse
import io
import json
from pathlib import Path

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
import uharfbuzz as hb


def verify(font_path, manifest_path):
    icons = json.loads(manifest_path.read_text())['icons']
    font = TTFont(font_path)
    cmap = font.getBestCmap()
    font.flavor = None
    stream = io.BytesIO()
    font.save(stream, reorderTables=True)
    shaper = hb.Font(hb.Face(stream.getvalue()))
    for icon in icons:
        buffer = hb.Buffer()
        buffer.add_str(icon['ligature'])
        buffer.guess_segment_properties()
        hb.shape(shaper, buffer, {'liga': True})
        actual = [glyph.codepoint for glyph in buffer.glyph_infos]
        expected = font.getGlyphID(cmap[icon['codepoint']])
        if actual != [expected]:
            raise ValueError(f"{icon['ligature']}: expected glyph {expected}, got {actual}")
        if not font['glyf'][cmap[icon['codepoint']]].numberOfContours:
            raise ValueError(f"Empty artwork: {icon['ligature']}")
    print(f'Verified all {len(icons)} name ligatures and private-use glyphs')


def finish(directory, manifest_path):
    font_path = directory / 'game-icons.ttf'
    # svg2ttf's single GSUB subtable overflows 16-bit offsets on this collection.
    # Replace it lazily, without attempting to parse its invalid offsets.
    font = TTFont(font_path, recalcTimestamp=False)
    del font['GSUB']
    # Assign safe FEA identifiers before lazily decoding cmap/glyf/hmtx. Upstream
    # glyph names like `3d-glasses` are ambiguous with FEA's numeric CID syntax.
    post = font['post']
    post.glyphOrder = [f'g{index:05d}' for index in range(font['maxp'].numGlyphs)]
    post.formatType = 3.0
    cmap = font.getBestCmap()
    icons = json.loads(manifest_path.read_text())['icons']
    rules = ['languagesystem DFLT dflt;', 'languagesystem latn dflt;',
             'lookup GameIcons useExtension {']
    # Longest first: `fire` must not consume the start of `fire-shield`.
    for icon in sorted(icons, key=lambda i: (-len(i['ligature']), i['ligature'])):
        components = ' '.join('\\' + cmap[ord(char)] for char in icon['ligature'])
        rules.append(f"sub {components} by \\{cmap[icon['codepoint']]};")
    rules.extend(['} GameIcons;', 'feature liga { lookup GameIcons; } liga;'])
    addOpenTypeFeaturesFromString(font, '\n'.join(rules))
    # Avoid svg2ttf's post glyph-name padding warning; mappings live in our manifest.
    font['post'].formatType = 3.0
    font.flavor = 'woff2'
    output = directory / 'game-icons.woff2'
    font.save(output)
    verify(output, manifest_path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('path', type=Path)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    if args.check:
        verify(args.path, args.manifest)
    else:
        finish(args.path, args.manifest)
