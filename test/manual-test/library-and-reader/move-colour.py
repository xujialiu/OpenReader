#!/usr/bin/env python3
"""Sample a region of an OpenReader or Files screenshot (3x: 1 pt = 3 px).

Usage: move-colour.py SCREENSHOT XPT YPT WPT HPT
Prints the region's mode colour (a capsule's fill, a row's background) as
`fill=#rrggbb (share)` and, against it, the non-fill colour farthest in
luminance (the word or label drawn on it) as `ink=#rrggbb`. Antialiased edge
pixels lose to the mode, so the fill is the drawn colour, not an average; the
ink is a single extreme pixel, so for a word's colour prefer a band with many
text pixels and read the extremes by hand when the share is small.

Used by the move-drawer recipe (#151) for the header capsule's fill and word
in both themes, Contents' unreachable rows, and Files' own Move sheet.

What it cannot prove: a fill sampled where a gradient or a mark runs under the
region is the mode of the mix, not either colour alone; keep the region inside
flat colour.
"""
import sys
from collections import Counter

PT = 3.0


def lum(c):
    def f(v):
        v = v / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hexs(c):
    return '#%02x%02x%02x' % c


def main():
    path = sys.argv[1]
    from PIL import Image
    im = Image.open(path).convert('RGB')
    x0, y0, w, h = (int(float(v) * PT) for v in sys.argv[2:6])
    px = im.load()
    cnt = Counter()
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            cnt[px[x, y]] += 1
    fill = cnt.most_common(1)[0][0]
    others = [(c, n) for c, n in cnt.items() if c != fill]
    if not others:
        print(f'{path.split("/")[-1]} region ({sys.argv[2]},{sys.argv[3]} {sys.argv[4]}x{sys.argv[5]}pt) '
              f'fill={hexs(fill)} (uniform)')
        return
    fl = lum(fill)
    ink = max(others, key=lambda cn: abs(lum(cn[0]) - fl))[0]
    share = sum(n for c, n in cnt.items() if c == fill) / sum(cnt.values())
    print(f'{path.split("/")[-1]} region ({sys.argv[2]},{sys.argv[3]} {sys.argv[4]}x{sys.argv[5]}pt) '
          f'fill={hexs(fill)} ({share:.0%}) ink={hexs(ink)}')


if __name__ == '__main__':
    main()
