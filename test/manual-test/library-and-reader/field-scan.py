"""Scan a simulator recording for Library Search's own field (#339), frame by frame.

A state-reading probe reads the accessibility tree every 50 ms or slower, so it cannot see a field that
is up for a few frames. This looks at every frame of a `simctl io recordVideo` recording instead: the
magnifier inside the capsule and the xmark of the round Close button are cut out of a screenshot of the
open, empty field (the same device, the same theme: the `search-field-open-empty` attachment of
`LibrarySearchProbe.testSearchShowsFieldWithKeyboardWhereThePhoneDrewIt`) and matched against the fixed
place they occupy in each frame. A frame counts as "field up" when BOTH glyphs match at 0.8 or more; the
positive control (a run that opens search on purpose) must show its segments, or silence proves nothing.

  python3 field-scan.py VIDEO TEMPLATE_PNG [--min 0.8]

Prints the number of frames, the highest glyph scores outside the matched frames and each segment where
the field was up. iPhone 17 geometry (402 x 874 pt at 3x); another device needs its own boxes. Seen on
the first #339 recording: the Close's xmark scores under 0.8 for the first 0.15 to 0.6 s of every opening
(the glass is still settling) while the magnifier already matches, so read "magnifier only" frames next to
a segment as the same field, not as a second appearance.
"""
import sys, cv2, numpy as np
video, shot = sys.argv[1], sys.argv[2]
thr = 0.8
if '--min' in sys.argv: thr = float(sys.argv[sys.argv.index('--min') + 1])
S = 3.0  # px per point
ref = cv2.cvtColor(cv2.imread(shot), cv2.COLOR_BGR2GRAY)
def box(x0, y0, x1, y1): return tuple(int(v * S) for v in (x0, y0, x1, y1))
MAG = box(24, 127, 52, 151)    # magnifier, left end of the capsule
XM = box(350, 128, 374, 152)   # xmark inside the round Close button
def crop(img, b): return img[b[1]:b[3], b[0]:b[2]]
tm, tx = crop(ref, MAG), crop(ref, XM)
def score(frame, t, b, pad=18):
    roi = frame[max(0, b[1]-pad):b[3]+pad, max(0, b[0]-pad):b[2]+pad]
    if roi.shape[0] < t.shape[0] or roi.shape[1] < t.shape[1]: return 0.0
    return float(cv2.matchTemplate(roi, t, cv2.TM_CCOEFF_NORMED).max())
cap = cv2.VideoCapture(video)
rows = []
while True:
    ok, f = cap.read()
    if not ok: break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    rows.append((t, score(g, tm, MAG), score(g, tx, XM)))
up = [(t, m, x) for t, m, x in rows if m >= thr and x >= thr]
print(f'frames={len(rows)} duration={rows[-1][0]:.2f}s  both-glyphs>= {thr}: {len(up)} frames')
print('max magnifier score outside the matched frames: %.3f; max xmark: %.3f' % (
    max([m for t, m, x in rows if not (m >= thr and x >= thr)] or [0]), max([x for t, m, x in rows if not (m >= thr and x >= thr)] or [0])))
segs = []
for t, m, x in up:
    if segs and t - segs[-1][1] < 0.6: segs[-1][1] = t; segs[-1][2] += 1
    else: segs.append([t, t, 1])
for a, b, n in segs: print(f'  field up {a:7.2f}s .. {b:7.2f}s  ({n} frames)')
