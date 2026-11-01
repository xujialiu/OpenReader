"""How far a recorded flick's bounce carried the Library list past its top (#338).

  python3 -I bounce.py VIDEO TOP.png [--series] [--from SECONDS --to SECONDS]

TOP.png is the page at rest at its top (first row at y 128 pt, search hidden),
the same screenshot flick-to-top.sh keeps. The whole first row ("Flick Folder
01": icon, name and subtitle) is cut out of it and matched in every frame of
VIDEO from 20 pt above to 500 pt below its rest place. The row's own digits tell
it from its neighbours 84 pt away (score 0.999 against about 0.97), so only a
match of at least 0.985 counts. The list's position is read from pixels, not
from the app.

`--from` and `--to` keep only the frames between those video times (a long recording
of several flicks); the times in the output then start at the first kept match.

Prints one line: frames, matched frames, the peak overshoot in points (positive
means the list went down past its top, which is the bounce), the time of that
peak since the first frame, and the last time the first row was seen more than
2 pt from rest. `--series` adds `seconds offset score` for every matched frame.
iPhone 17 only (1206x2622 screenshots, 3 px a point), and the first row must be
the row the TOP.png shows.

Exit 0 on a measurement, 2 when too few frames matched. What it cannot tell: the
field (field-visible.py does that) or a finger's position; frames in which the
first row is not on screen, or the Library is covered, match nothing and drop out.
"""
import sys

import cv2
import numpy as np

video, top = sys.argv[1:3]
args = sys.argv[3:]
window_from = float(args[args.index('--from') + 1]) if '--from' in args else 0.0
window_to = float(args[args.index('--to') + 1]) if '--to' in args else 1e9
reference = cv2.cvtColor(cv2.imread(top), cv2.COLOR_BGR2GRAY)
X0, X1, Y0, Y1 = 60, 900, 420, 600  # row 1 at rest, in pixels
template = reference[Y0:Y1, X0:X1]
ABOVE, BELOW = 60, 1500  # search window around the rest place, in pixels
MATCH = 0.985

capture = cv2.VideoCapture(video)
frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
points = []
while True:
    ok, frame = capture.read()
    if not ok:
        break
    millis = capture.get(cv2.CAP_PROP_POS_MSEC)
    if not window_from * 1000 <= millis <= window_to * 1000:
        continue
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    low, high = max(0, Y0 - ABOVE), min(gray.shape[0], Y1 + BELOW)
    strip = gray[low:high, X0 - 10:X1 + 10]
    scores = cv2.matchTemplate(strip, template, cv2.TM_CCOEFF_NORMED)[:, 10]
    where = int(np.argmax(scores))
    if scores[where] >= MATCH:
        points.append((millis, (low + where - Y0) / 3.0, float(scores[where])))

if len(points) < 10:
    print('frames=%d matched=%d: too few frames matched the first row' % (frames, len(points)))
    sys.exit(2)
start = points[0][0]
peak = max(points, key=lambda p: p[1])
moving = [p for p in points if abs(p[1]) > 2]
settled = (moving[-1][0] - start) / 1000 if moving else 0.0
print('frames=%d matched=%d peak_overshoot_pt=%.1f at=%.2fs last_off_rest=%.2fs'
      % (frames, len(points), peak[1], (peak[0] - start) / 1000, settled))
if '--series' in args:
    for millis, offset, score in points:
        print('%.3f %.1f %.3f' % ((millis - start) / 1000, offset, score))
