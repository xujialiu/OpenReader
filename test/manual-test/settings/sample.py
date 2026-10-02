#!/usr/bin/env python3
"""Sample a rect of a screenshot (points) and report the non-background colours.

  python3 sample.py SHOT.png X0PT Y0PT X1PT Y1PT [EXPECT_HEX TOL]

Prints the most common colours (count, hex, share) with their mean, so a
glyph's colour can be read off a small element. With EXPECT+TOL also prints
whether any pixel is within TOL of it (and the closest pixel).
"""
import sys
from PIL import Image
from collections import Counter

PT = 3.0

def hexrgb(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))

def main():
    path = sys.argv[1]
    x0, y0, x1, y1 = (int(float(v) * PT) for v in sys.argv[2:6])
    expect = hexrgb(sys.argv[6]) if len(sys.argv) > 6 else None
    tol = int(sys.argv[7]) if len(sys.argv) > 7 else 24
    im = Image.open(path).convert('RGB')
    px = im.load()
    cnt = Counter()
    for y in range(max(0, y0), min(im.height, y1)):
        for x in range(max(0, x0), min(im.width, x1)):
            cnt[px[x, y]] += 1
    total = sum(cnt.values())
    print(path.split('/')[-1], 'rect', x0/PT, y0/PT, x1/PT, y1/PT)
    for c, n in cnt.most_common(6):
        print('  #%02x%02x%02x x%d (%.1f%%)' % (c[0], c[1], c[2], n, 100*n/total))
    if expect:
        best, bestd = None, 10**9
        hit = 0
        for (c, n) in cnt.items():
            d = max(abs(c[i]-expect[i]) for i in range(3))
            if d < bestd: best, bestd = c, d
            if d <= tol: hit += n
        print('  expect #%02x%02x%02x tol %d: %.2f%% within, closest #%02x%02x%02x (maxΔ %d)' %
              (expect[0], expect[1], expect[2], tol, 100*hit/total, best[0], best[1], best[2], bestd))

if __name__ == '__main__':
    main()
