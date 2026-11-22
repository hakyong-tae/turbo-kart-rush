#!/usr/bin/env python3
"""Before / after sheets from two tools/gfx-shots.mjs output folders.

    python3 tools/gfx-compare.py <beforeDir> <afterDir> <outDir> [shot ...]

For every circuit both folders hold, one image per shot: the "before" frame on the left, the
"after" frame on the right, labelled. A shot is the part of the file name after the circuit
(default: 0-grid, 2-race, 2-kart). Needs Pillow.
"""
from __future__ import annotations

import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    before, after, out = sys.argv[1:4]
    shots = sys.argv[4:] or ['0-grid', '2-race', '2-kart']
    os.makedirs(out, exist_ok=True)
    label = font(30)
    made = 0
    for shot in shots:
        for path in sorted(glob.glob(os.path.join(before, f'*-{shot}.jpg'))):
            name = os.path.basename(path)
            other = os.path.join(after, name)
            if not os.path.exists(other):
                continue
            a = Image.open(path).convert('RGB')
            b = Image.open(other).convert('RGB')
            if b.size != a.size:
                b = b.resize(a.size, Image.LANCZOS)
            w, h = a.size
            gap = 8
            sheet = Image.new('RGB', (w * 2 + gap, h), (16, 16, 18))
            sheet.paste(a, (0, 0))
            sheet.paste(b, (w + gap, 0))
            draw = ImageDraw.Draw(sheet)
            for x, text in ((16, 'BEFORE'), (w + gap + 16, 'AFTER')):
                box = draw.textbbox((x, 14), text, font=label)
                draw.rectangle((box[0] - 10, box[1] - 8, box[2] + 10, box[3] + 8), fill=(0, 0, 0))
                draw.text((x, 14), text, font=label, fill=(255, 212, 0))
            sheet.save(os.path.join(out, name), quality=90)
            made += 1
    print(f'{made} sheets in {out}')


if __name__ == '__main__':
    main()
