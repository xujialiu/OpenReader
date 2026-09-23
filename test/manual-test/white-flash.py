#!/usr/bin/env python3
"""Read every frame of a simulator recording for a white reading page (#27).

    python3 test/manual-test/white-flash.py VIDEO [-v]

The page area is the full width from 12 % to 80 % of the height: under the
navigation bar, above the player. A frame is WHITE when more than 30 % of that
area has luminance above 200. A dark page of text reads 4-6 %, a white page
91-98 % (iPhone 17 simulator, 2026-09-23). It also counts, per frame, magenta
(R, B > 200, G < 80) and green (G > 200, R, B < 80) pixels, which is how
`white-flash.sh fling` with PAINT=1 tells the page's layers apart.

`simctl io recordVideo` writes a frame only when the screen changes, so the
timestamps are uneven and a long still stretch is one frame.

Prints a summary line and every flagged frame (every frame with -v). Exit 1 when
any frame is white (RED), 0 otherwise (GREEN), 2 when the video cannot be read.
"""
import sys

import cv2
import numpy as np

USAGE = 'python3 test/manual-test/white-flash.py VIDEO [-v]'
args = [a for a in sys.argv[1:] if a != '-v']
verbose = '-v' in sys.argv
if len(args) != 1:
    print(USAGE, file=sys.stderr)
    sys.exit(2)
TOP, BOTTOM, THRESHOLD = 0.12, 0.80, 0.30

capture = cv2.VideoCapture(args[0])
rows = []
while True:
    ok, frame = capture.read()
    if not ok:
        break
    at = capture.get(cv2.CAP_PROP_POS_MSEC)
    height = frame.shape[0]
    region = frame[int(height * TOP):int(height * BOTTOM), :].astype(np.int16)
    b, g, r = region[..., 0], region[..., 1], region[..., 2]
    luminance = cv2.cvtColor(region.astype(np.uint8), cv2.COLOR_BGR2GRAY)
    white = float((luminance > 200).mean())
    magenta = float(((r > 200) & (b > 200) & (g < 80)).mean())
    green = float(((g > 200) & (r < 80) & (b < 80)).mean())
    rows.append((len(rows), at, float(luminance.mean()), white, magenta, green))
if not rows:
    print(f'cannot read {args[0]}', file=sys.stderr)
    sys.exit(2)

red = [row for row in rows if row[3] > THRESHOLD]
painted = [row for row in rows if row[4] > THRESHOLD or row[5] > THRESHOLD]
empty = [row for row in rows if row[3] < 0.003]
print(f'frames={len(rows)} white={len(red)} painted={len(painted)} empty-dark={len(empty)}')
for row in rows:
    flag = 'WHITE' if row[3] > THRESHOLD else ('PAINTED' if row[4] > THRESHOLD or row[5] > THRESHOLD else '')
    if flag or verbose:
        print(f'  #{row[0]:4d} t={row[1]:8.1f}ms mean={row[2]:6.1f} white={row[3]:.3f} '
              f'magenta={row[4]:.3f} green={row[5]:.3f} {flag}')
if red:
    print(f'RED: {len(red)} white frame(s), first at {red[0][1]:.0f} ms, last at {red[-1][1]:.0f} ms')
    sys.exit(1)
print('GREEN: no white frame')
