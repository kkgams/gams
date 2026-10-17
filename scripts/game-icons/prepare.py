#!/usr/bin/env python3
"""Prepare the pinned game-icons collection; reject changes to its SVG contract."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

# Names follow upstream license.txt, including its two CC0 exceptions.
AUTHORS = dict(zip(
    'lorc delapouite john-colburn felbrigg john-redman carl-olsen sbed priorblue '
    'willdabeast viscious-speed lord-berandas irongamer heavenly-dog lucasms '
    'faithtoken skoll andymeneely cathelineau kier-heyl aussiesim sparker '
    'zeromancer rihlsul quoting guard13007 darkzaitzev spencerdub generalace135 '
    'zajkonur catsu starseeker pepijn-poolman pierre-leducq caro-asercion seregacthtuf'.split(),
    ['Lorc', 'Delapouite', 'John Colburn', 'Felbrigg', 'John Redman', 'Carl Olsen',
     'Sbed', 'PriorBlue', 'Willdabeast', 'Viscious Speed', 'Lord Berandas',
     'Irongamer', 'HeavenlyDog', 'Lucas', 'Faithtoken', 'Skoll', 'Andy Meneely',
     'Cathelineau', 'Kier Heyl', 'Aussiesim', 'Sparker', 'Zeromancer', 'Rihlsul',
     'Quoting', 'Guard13007', 'DarkZaitzev', 'SpencerDub', 'GeneralAce135',
     'Zajkonur', 'Catsu', 'Starseeker', 'Pepijn Poolman', 'Pierre Leducq',
     'Caro Asercion', 'SeregaCthtuf'], strict=True))
# These two CC0 icons are omitted from license.txt; their individual upstream
# pages credit Various artists (salmon additionally credits Swedish Road Administration).
AUTHORS['various-artists'] = 'Various artists'
SVG = '{http://www.w3.org/2000/svg}'


def foreground(path):
    root = ET.parse(path).getroot()
    if root.tag != SVG + 'svg' or root.attrib != {'viewBox': '0 0 512 512'}:
        raise ValueError(f'{path}: unexpected SVG root')
    children = list(root)
    if (len(children) != 2 or children[0].tag != SVG + 'path'
            or children[0].attrib != {'d': 'M0 0h512v512H0z'}
            or children[1].tag != SVG + 'path'
            or set(children[1].attrib) != {'fill', 'd'}
            or children[1].get('fill') != '#fff' or not children[1].get('d')
            or len(children[0]) or len(children[1])):
        raise ValueError(f'{path}: unexpected SVG background/artwork')
    # Remove only the verified square; preserve the compound path's winding/holes.
    output = ET.Element('svg', xmlns=SVG[1:-1], viewBox='0 0 512 512')
    ET.SubElement(output, 'path', d=children[1].get('d'))
    return ET.tostring(output, encoding='unicode')


def prepare(source, output, revision):
    files = sorted(p for p in source.glob('*/*.svg') if p.parent.name != 'badges')
    if not files:
        raise ValueError('No upstream icons found')
    counts = Counter(p.stem for p in files)
    records = []
    names = set()
    (output / 'svg').mkdir(parents=True)
    for path in files:
        author = AUTHORS[path.parent.name]  # Unknown contributors require explicit review.
        name = path.stem if counts[path.stem] == 1 else f'{path.parent.name}-{path.stem}'
        if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', name) or name in names:
            raise ValueError(f'Duplicate/invalid ligature: {name}')
        names.add(name)
        (output / 'svg' / f'{name}.svg').write_text(foreground(path) + '\n')
        records.append(dict(ligature=name, source=path.relative_to(source).as_posix(),
                            author=author, license='CC0-1.0' if path.parent.name in
                            {'viscious-speed', 'zeromancer', 'various-artists'} else 'CC-BY-3.0'))
    records.sort(key=lambda item: item['ligature'])
    for index, record in enumerate(records):
        record['codepoint'] = 0xE000 + index
        if record['codepoint'] > 0xF8FF:
            raise ValueError('Collection exceeds the BMP private-use area')
    manifest = dict(revision=revision, icons=records)
    (output / 'game-icons.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'game-icons.contributors.txt').write_bytes((source / 'license.txt').read_bytes())
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('revision')
    args = parser.parse_args()
    prepare(args.source, args.output, args.revision)
