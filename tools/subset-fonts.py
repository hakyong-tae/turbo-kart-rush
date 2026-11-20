#!/usr/bin/env python3
"""Cuts the web fonts the CrazyGames edition serves itself (src/assets/fonts/).

The default edition takes its three faces from Google Fonts. A CrazyGames build may not ask any
other host for anything, so it carries them: Anton whole, and the two Korean faces cut down to
the characters the game can actually print — the Hangul of `src/core/locales/ko.ts`, the jamo an
input method shows while a syllable is being typed, and the Latin and punctuation of the source.

Run it again whenever Korean text is added (`src/assets/fonts/charset.test.ts` fails until you do):

    python3 tools/subset-fonts.py <dir with the three source fonts>

The sources are not in the repository (11 MB). They are the Open Font License files of
https://github.com/google/fonts — ofl/anton/Anton-Regular.ttf,
ofl/blackhansans/BlackHanSans-Regular.ttf and ofl/notosanskr/NotoSansKR[wght].ttf (saved here as
NotoSansKR-wght.ttf), each with its OFL.txt saved as <Family>-OFL.txt. Needs `fonttools` and
`brotli` (pip).
"""
from __future__ import annotations

import os
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'assets', 'fonts')


def source_text() -> str:
    """Every character the game's own source can put on screen."""
    text = []
    for folder, _, names in os.walk(os.path.join(ROOT, 'src')):
        for name in names:
            if name.endswith('.ts') and '.test.' not in name:
                with open(os.path.join(folder, name), encoding='utf8') as f:
                    text.append(f.read())
    for name in ('server.js', 'index.html'):
        with open(os.path.join(ROOT, name), encoding='utf8') as f:
            text.append(f.read())
    return ''.join(text)


def is_hangul(c: str) -> bool:
    return '가' <= c <= '힣'


def cut(font: TTFont, out: str, codepoints: set[int], weights: tuple[int, int] | None = None) -> int:
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.notdef_outline = True
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    # Narrowing a weight axis comes after the cut: the other order trips over glyphs the cut drops.
    if weights:
        font = instancer.instantiateVariableFont(font, {'wght': weights})
    font.flavor = 'woff2'
    font.save(os.path.join(OUT, out))
    return os.path.getsize(os.path.join(OUT, out))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)

    text = source_text()
    hangul = sorted({c for c in text if is_hangul(c)})
    # Compatibility jamo: what a Korean keyboard shows before a syllable is complete.
    jamo = [chr(c) for c in range(0x3131, 0x318F)]
    latin = [chr(c) for c in range(0x20, 0x7F)] + [chr(c) for c in range(0xA0, 0x100)]
    other = sorted({c for c in text if ord(c) > 0xFF and not is_hangul(c)})
    korean = {ord(c) for c in hangul + jamo}
    everything = korean | {ord(c) for c in latin + other}

    sizes = {}
    # Anton: the whole face. It is small, and a nickname may use any Latin letter.
    anton = TTFont(os.path.join(src, 'Anton-Regular.ttf'))
    sizes['anton.woff2'] = cut(anton, 'anton.woff2', set(anton.getBestCmap()))
    # Black Han Sans is only ever reached for Hangul (Anton draws the Latin before it).
    sizes['black-han-sans.woff2'] = cut(TTFont(os.path.join(src, 'BlackHanSans-Regular.ttf')), 'black-han-sans.woff2', korean)
    # Noto Sans KR draws all Korean body copy, Latin included. The game uses weights 400 to 900.
    sizes['noto-sans-kr.woff2'] = cut(TTFont(os.path.join(src, 'NotoSansKR-wght.ttf')), 'noto-sans-kr.woff2', everything, (400, 900))

    with open(os.path.join(OUT, 'charset.txt'), 'w', encoding='utf8') as f:
        f.write(''.join(hangul) + '\n')
    for family in ('Anton', 'BlackHanSans', 'NotoSansKR'):
        shutil.copyfile(os.path.join(src, f'{family}-OFL.txt'), os.path.join(OUT, f'{family}-OFL.txt'))

    for name, size in sizes.items():
        print(f'{name:24} {size / 1024:6.1f} KB')
    print(f'{len(hangul)} Hangul syllables, {sum(sizes.values()) / 1024:.1f} KB in all')


if __name__ == '__main__':
    main()
