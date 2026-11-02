"""search-restore.py VIDEO [--band Y0 Y1]   (#341 verification, 2026-11-02)

The list's shift (phase correlation of a band of rows, in points) of every unique frame of a `simctl io recordVideo` recording against the LAST
frame, for checking that Close restores the browsing position: plateaus (three frames or 150 ms at one shift) are printed, so a position
before search, the 60-pt shift with the field open and the position after Close read off one list. A 1-pt creep after the closing overshoot
(list at its very bottom) shows as two plateaus 1 pt apart. Needs OpenCV and NumPy."""
import sys
import cv2, numpy as np
video = sys.argv[1]
a = sys.argv[2:]
band = (float(a[a.index('--band') + 1]), float(a[a.index('--band') + 2])) if '--band' in a else (140.0, 420.0)
cap = cv2.VideoCapture(video)
fr = []
while True:
    ok, f = cap.read()
    if not ok: break
    fr.append((cap.get(cv2.CAP_PROP_POS_MSEC), cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)))
S = fr[0][1].shape[1] / 402.0
def crop(g): return g[int(band[0]*S):int(band[1]*S), int(16*S):int(300*S)].astype(np.float32)
ref = crop(fr[-1][1]); win = cv2.createHanningWindow(ref.shape[::-1], cv2.CV_32F)
prev = None; out = []
for ms, g in fr:
    c = crop(g)
    if prev is not None and np.mean(np.abs(c - prev)) < 0.05: continue
    prev = c
    sh = cv2.phaseCorrelate(ref, c, win)
    out.append((ms, sh[0][1] / S, sh[1]))
# plateaus
runs = []
for ms, s, resp in out:
    if runs and abs(runs[-1]['s'] - s) < 0.4 and ms - runs[-1]['t1'] < 400:
        runs[-1]['t1'] = ms; runs[-1]['n'] += 1
    else:
        runs.append(dict(t0=ms, t1=ms, s=s, n=1, resp=resp))
for r in runs:
    if r['n'] >= 3 or r['t1'] - r['t0'] > 150:
        print(f"{r['t0']:.0f}-{r['t1']:.0f} ms  shift vs last frame {r['s']:+.2f} pt  ({r['n']} frames, resp {r['resp']:.2f})")
