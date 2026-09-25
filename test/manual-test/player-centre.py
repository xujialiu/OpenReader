#!/usr/bin/env python3
"""#70: is the Voice name's own glyph bounding box centred on the screenshot's
width (the player has `left:0`/`right:0`, so the player's own width is the
screenshot's)?

    python3 test/manual-test/player-centre.py SCREENSHOT.png Y_TOP Y_BOTTOM

Y_TOP/Y_BOTTOM (pixels, the screenshot's own scale) must bracket the head
row's text baseline and nothing else — get them once from
`XCUIElement.frame` (`PlayerTouchProbe.swift` prints the window frame and the
"Choose a Voice"/"Collapse the player" frames in points; multiply by the
screenshot's scale, 3 on an iPhone 17, and pad by a few points) or by eye from
the screenshot. There is no auto-detected band: an early version scanned for
the screen's own widest run of light-on-dark pixels and found the book's
title instead of the player's head row, which is wider still. Pass a Y range
too narrow and nothing so widely off that it silently measures the wrong
line.

Scans for DARK_TEXT (`#e6e6ea`)-ish pixels (tolerance 30 per channel, for
anti-aliased edges) within X in `[192, width-192]` at 3x — the 44pt
`headEnd`/chevron zones either side, outside of which only the name's own
glyphs should fall — and within the given Y band, and reports the glyph's
leftmost/rightmost X, its centre, and the offset from `width/2`.

Measured on the dark theme, iPhone 17 (1206x2622, scale 3), y=[2270,2330):
Andrew (`en-US-AndrewNeural`) centred at +0.0 px; the longest real Azure voice
label across all ~691 voices, `Xiaoshuang Dragon HD Flash Latest` (33
characters), still fit on one line at -0.5 px — Azure has no voice long
enough to force `numberOfLines={1}`'s ellipsis in this player.
"""
import sys
import numpy as np
from PIL import Image

TEXT = np.array([0xE6, 0xE6, 0xEA])
TOL = 30


def main():
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 64
    path, ytop, ybot = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    im = np.asarray(Image.open(path).convert('RGB'))
    h, w = im.shape[0], im.shape[1]
    xlo, xhi = 192, w - 192
    band = im[ytop:ybot, xlo:xhi]
    mask = np.abs(band.astype(int) - TEXT).max(axis=2) <= TOL
    cols = np.nonzero(mask.sum(axis=0) > 0)[0]
    if len(cols) == 0:
        print('No text-coloured pixels found in the scanned band'); return 1
    left, right = int(cols.min()) + xlo, int(cols.max()) + xlo
    centre = (left + right) / 2
    print(f'{path}: image {w}x{h}, scanned y=[{ytop},{ybot}) x=[{xlo},{xhi})')
    print(f'  glyph x=[{left},{right}] width={right - left} centre={centre:.1f}')
    print(f'  image centre = {w / 2:.1f}, offset = {centre - w / 2:+.1f} px ({(centre - w / 2) / 3:+.2f} pt)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
