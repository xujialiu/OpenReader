#!/usr/bin/env python3
"""#29: which theme's line colour is each full-width hairline drawn in?

    python3 test/manual-test/line-colour.py light|dark SCREENSHOT.png...

For every screenshot, lists each pixel row where at least half the width is one
of the two line colours, `#dcdce2` (the light theme's) or `#33333c` (the dark
theme's), and every shorter horizontal run of at least RUN pixels in the other
theme's line colour, which is where a chip's or a small ring's border shows up.
Single pixels are not counted: the edges of dark-theme text pass through
`#dcdce2` on their way to the background. The theme is the one the app was set
to, so the other one is the wrong one.

Exit 1 = RED (the other theme's line colour is on a screen), 0 = GREEN.

What it cannot see: a line in some other colour entirely, and a border shorter
than RUN pixels. A rendered image is compared
within 3 levels per channel, so a translucent line over another colour is not
matched at all.
"""
import sys

import numpy as np
from PIL import Image

LINE = {'light': (0xDC, 0xDC, 0xE2), 'dark': (0x33, 0x33, 0x3C)}
TOLERANCE = 3
RUN = 24


def matches(pixels, colour):
    return (np.abs(pixels.astype(int) - np.array(colour)).max(axis=2) <= TOLERANCE)


def longest_run(row):
    best = run = 0
    for hit in row:
        run = run + 1 if hit else 0
        best = max(best, run)
    return best


def main():
    theme, paths = sys.argv[1], sys.argv[2:]
    if theme not in LINE or not paths:
        print(__doc__, file=sys.stderr)
        return 64
    other = 'dark' if theme == 'light' else 'light'
    red = False
    for path in paths:
        pixels = np.asarray(Image.open(path).convert('RGB'))
        width = pixels.shape[1]
        right, wrong = matches(pixels, LINE[theme]), matches(pixels, LINE[other])
        rows = []
        for name, mask in ((theme, right), (other, wrong)):
            for y in np.nonzero(mask.sum(axis=1) >= width / 2)[0]:
                rows.append((int(y), name, mask[y].sum() / width))
        full = {y for y, name, _ in rows}
        for y in np.nonzero(wrong.sum(axis=1) >= RUN)[0]:
            run = longest_run(wrong[y])
            if int(y) not in full and run >= RUN:
                rows.append((int(y), other, run / width))
        stray = sum(1 for _, name, _ in rows if name == other)
        red |= stray > 0
        print(f'{"RED  " if stray else "GREEN"} {path}: {stray} rows of the {other} line colour')
        for y, name, share in sorted(rows):
            print(f'    y={y:5d} {name:5s} {share:4.0%}{"   <- wrong" if name == other else ""}')
    return 1 if red else 0


if __name__ == '__main__':
    sys.exit(main())
