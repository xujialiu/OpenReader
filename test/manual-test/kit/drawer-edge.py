#!/usr/bin/env python3
"""Where a drawer's top edge is in a simulator screenshot (#117).

  python3 test/manual-test/kit/drawer-edge.py SHOT.png            # by the grabber
  python3 test/manual-test/kit/drawer-edge.py SHOT.png R G B      # and by the sheet's colour

The screenshot is `xcrun simctl io UDID screenshot`, 3 px to the point.

By the grabber: the first run, down the screen's centre column, of 9-16 px of
one grey (mean 60-200; measured 187 light, 88 dark) that differ from the equal
pixels above and below them by more than 40. The sheet's top edge
is 17 px above it when the drawer floats at the Drawer Height (5.67 pt: 6 pt
scaled by 0.96) and 18 px above it at `large` (6.0 pt). It works in the dark,
where the drawer's grey is the reader's page and nothing else marks the edge
(notes, 2026-10-01).

By colour: for each column from x 300 to 900 px, the first row from which 30 px
run down within 3 of R G B; the median, in pt. The edge's shadow runs 3-5 px
above it, and a page behind of the same colour defeats it.

What it cannot tell: whether the drawer is at the Drawer Height or at `large`
(read `Sheet Grabber`'s value with `kit/ax.py UDID tree`: `Half screen` or
`Expanded`).
"""
import sys

import numpy as np
from PIL import Image

img = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
H, W, _ = img.shape
centre = img[:, W // 2].sum(axis=1) / 3

found = None
y = 150
while y < H - 20 and found is None:
    for length in range(9, 17):
        run = centre[y:y + length]
        above, below = centre[y - 1], centre[y + length]
        if 60 < run.mean() < 200 and np.ptp(run) <= 3 and abs(run.mean() - above) > 40 and abs(run.mean() - below) > 40 and abs(above - below) <= 3:
            found = (y, length)
            break
    y += 1
if found:
    top, length = found
    print(f'grabber {top}-{top + length - 1} px ({length / 3:.2f} pt tall, grey {int(centre[top])})')
    print(f'top edge {(top - 17) / 3:.2f} pt floating at the Drawer Height, or {(top - 18) / 3:.2f} pt at large')
else:
    print('no grabber found on the centre column')

if len(sys.argv) >= 5:
    bg = np.array([int(v) for v in sys.argv[2:5]])
    match = np.abs(img - bg).max(axis=2) <= 3
    tops = []
    for x in range(300, 900, 10):
        col = match[:, x]
        for y in range(150, H - 30):
            if col[y:y + 30].all() and not col[y - 1]:
                tops.append(y)
                break
    if tops:
        med = int(np.median(tops))
        print(f'first row in the sheet colour: median {med} px = {med / 3:.2f} pt (columns {len(tops)}, {min(tops)}-{max(tops)} px)')
