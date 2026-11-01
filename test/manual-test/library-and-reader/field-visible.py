"""Whether the Library's search field showed during a recorded flick (#338).

  python3 -I field-visible.py VIDEO BEFORE.png AFTER.png TOP.png
  python3 -I field-visible.py --still SCREENSHOT.png       (exit 1 when the field shows)
  python3 -I field-visible.py --scan VIDEO                 (exit 1 when any frame shows it)

flick-to-top.sh calls it once a run. On an iPhone 17 (1206x2622, 3 px a point)
the revealed field is a uniform bar of its own gray at y 116-160 pt under the
title. A pixel row of y 100-187 pt counts as the field when 95 % of its pixels
across x 200-367 pt (right of the placeholder) are within 2 levels of one value
that differs from that row's page background by at least 6 levels, the page
background being the median of x 2-17 pt, which no row, icon or field touches.
A frame shows the field when at least 15 such pixel rows are found; list rows
never are (their text and buttons break the 95 %). Both themes: the light bar is
about 243 on 253, the dark one is told apart the same way. TOP.png is the page
at its top: it must itself show no field, BEFORE must differ from it (the list
left the top) and AFTER must match it (the flick reached the top and the field
ended hidden), or the run is invalid.

Exit 0: no frame showed the field. 1: some frame did. 2: invalid run.
What it cannot tell: other screen sizes, or why the field showed.

--scan scores every frame of any recording, such as an XCTest probe's screen.mp4, and prints the
bursts of frames that show the field. Only frames that show the app's own bar count (its Settings
button at x 20-64 pt and the title at x 173-229 pt both carry contrast): the white launch
screen of every relaunch fills the whole band and would otherwise read as a field. A field that
flashes starts at about 130 rows (the bar in full) and falls to 4 in about 0.15 s as it collapses.
A frame of more than 150 rows is no field either: the Settings page, whose Back button and title sit
where the Library's Settings button and title do and whose gray grouped background fills the band,
reads 210 rows (4 false bursts in a recording of two Settings round trips, #338 round 3). A field that
is up on purpose (a committed pull, the menu Search, the results) is a burst as well: read the bursts
against the probe's log, since the scan of a probe that opens search is not 0.
"""
import sys

import cv2
import numpy as np

DIFFERENCE = 6
MINIMUM_ROWS = 15
MAXIMUM_ROWS = 150  # --scan only: the field is 130 pixel rows; the Settings page's grouped background is 210 (#338 round 3)


def gray(path):
    image = cv2.imread(path)
    if image is None:
        sys.exit('Cannot read ' + path)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.int16)


def field_rows(image):
    """Pixel rows of y 100-187 pt that look like the field's own fill."""
    band = image[300:561, 600:1101]
    background = np.median(image[300:561, 6:51], axis=1)
    middle = np.median(band, axis=1)
    uniform = (np.abs(band - middle[:, None]) <= 2).mean(axis=1) >= 0.95
    return int((uniform & (np.abs(middle - background) >= DIFFERENCE)).sum())


def app_bar_shown(image):
    """The Settings button and the title are on screen: the frame is the app's page, not its launch screen."""
    return image[186:318, 60:192].std() >= 20 and image[222:285, 519:687].std() >= 60


def list_difference(a, b):
    return float(np.abs(a[600:1600] - b[600:1600]).mean())


if sys.argv[1] == '--still':
    # One screenshot: print the field rows; exit 1 when the field shows (catch-release.sh reads the end state).
    rows_still = field_rows(gray(sys.argv[2]))
    print('field_rows=%d' % rows_still)
    sys.exit(1 if rows_still >= MINIMUM_ROWS else 0)

if sys.argv[1] == '--scan':
    capture = cv2.VideoCapture(sys.argv[2])
    frames = 0
    bursts = []  # [first time, last time, frames, most rows]
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames += 1
        grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.int16)
        rows_now = field_rows(grey)
        if rows_now < MINIMUM_ROWS or rows_now > MAXIMUM_ROWS or not app_bar_shown(grey):
            continue
        at = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if bursts and at - bursts[-1][1] <= 0.5:
            bursts[-1][1:] = [at, bursts[-1][2] + 1, max(bursts[-1][3], rows_now)]
        else:
            bursts.append([at, at, 1, rows_now])
    print('frames=%d field_bursts=%d' % (frames, len(bursts)))
    for first, last, count, most in bursts:
        print('burst %.2f-%.2f s: %d frames, most rows %d' % (first, last, count, most))
    sys.exit(1 if bursts else 0)

video, before, after, top = sys.argv[1:5]
reference = gray(top)
if field_rows(reference) >= MINIMUM_ROWS:
    print('TOP.png itself shows the field: start from a page at its top with search hidden')
    sys.exit(2)
left_top = list_difference(gray(before), reference) > 3
ended_top = list_difference(gray(after), reference) < 3
capture = cv2.VideoCapture(video)
rows = []
while True:
    ok, frame = capture.read()
    if not ok:
        break
    rows.append(field_rows(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.int16)))
shown = [count for count in rows if count >= MINIMUM_ROWS]
print('frames=%d shown_frames=%d max_rows=%d left_top=%s ended_top=%s'
      % (len(rows), len(shown), max(rows or [0]), left_top, ended_top))
if not left_top or not ended_top or len(rows) < 10:
    sys.exit(2)
sys.exit(1 if shown else 0)
