#!/usr/bin/env python3
"""Measure text ink extents in an OpenReader screenshot (3x: 1 pt = 3 px).

Usage: ink.py SCREENSHOT [Y0PT Y1PT]
Prints, within the row band [Y0PT, Y1PT): the minimum leftmost ink column and
the maximum rightmost ink column over all inked rows (the justified body rows
show the true margins), plus the ink's top/bottom.
"""
import sys
from PIL import Image
from collections import Counter

PT = 3.0

def main():
    path = sys.argv[1]
    im = Image.open(path).convert('RGB')
    w, h = im.size
    y0 = int(float(sys.argv[2]) * PT) if len(sys.argv) > 2 else int(130 * PT)
    y1 = int(float(sys.argv[3]) * PT) if len(sys.argv) > 3 else int(700 * PT)
    y1 = min(y1, h)
    px = im.load()
    cnt = Counter()
    for y in range(y0, y1, 4):
        for x in range(0, 40):
            cnt[px[x, y]] += 1
    bg = cnt.most_common(1)[0][0]
    def ink(p):
        return abs(p[0]-bg[0]) + abs(p[1]-bg[1]) + abs(p[2]-bg[2]) > 60
    min_left = max_right = None
    top = bottom = None
    for y in range(y0, y1):
        l = r = None
        for x in range(w):
            if ink(px[x, y]):
                if l is None: l = x
                r = x
        if l is not None:
            if min_left is None or l < min_left: min_left = l
            if max_right is None or r > max_right: max_right = r
            if top is None: top = y
            bottom = y
    name = path.split('/')[-1]
    if min_left is None:
        print(f"{name}: no ink in band y {y0/PT:.1f}..{y1/PT:.1f} pt, bg={bg}")
        return
    print(f"{name}: bg={bg} band y {y0/PT:.1f}..{y1/PT:.1f} pt  "
          f"ink x {min_left/PT:.1f}..{(max_right+1)/PT:.1f} pt (width {(max_right+1-min_left)/PT:.1f})  "
          f"y {top/PT:.1f}..{(bottom+1)/PT:.1f} pt")

if __name__ == '__main__':
    main()
