"""search-motion.py VIDEO [--band Y0 Y1] [--amp 60]   (#341)

The Library Search field's motion from a `simctl io recordVideo` recording of a
Library at the top of its list: the list's per-frame shift (phase correlation
of a band of rows, in points, against the first frame), the darkness of Close's
xmark and of the magnifier's region, and a spring fit (start, natural
frequency, damping ratio) of every episode in which the list moves. Prints JSON.

Times are the video's own timestamps, which simctl delivers at a variable rate
(pitfalls/simulators.md, #341): a fit is good to a few per cent, and a frame
the recorder dropped shows as a step. The band must hold rows that differ: a
list scrolled to its middle shows rows 84 points apart that phase correlation
confuses with a 60-point shift, so measure mid-list cases from the row frames
in the accessibility tree instead. Needs OpenCV, NumPy and SciPy.
"""
import sys, math, json
import cv2, numpy as np
from scipy.optimize import curve_fit

video = sys.argv[1]
args = sys.argv[2:]
band = (300, 620)
amp = 60.0
if '--band' in args:
    i = args.index('--band'); band = (float(args[i + 1]), float(args[i + 2]))
if '--amp' in args:
    amp = float(args[args.index('--amp') + 1])

cap = cv2.VideoCapture(video)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append((cap.get(cv2.CAP_PROP_POS_MSEC), cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)))
h, w = frames[0][1].shape
S = w / 402.0


def crop(g, x0, y0, x1, y1):
    return g[int(y0 * S):int(y1 * S), int(x0 * S):int(x1 * S)].astype(np.float32)


ref = crop(frames[0][1], 16, band[0], 300, band[1])
win = cv2.createHanningWindow(ref.shape[::-1], cv2.CV_32F)
rows = []
for pts, g in frames:
    shift = cv2.phaseCorrelate(ref, crop(g, 16, band[0], 300, band[1]), win)[0][1] / S
    xmark = 255 - crop(g, 356, 131, 371, 146).min()
    glyph = 255 - crop(g, 29, 131, 46, 146).min()
    rows.append(dict(ms=pts, shift=shift, xmark=xmark, glyph=glyph))


def spring(t, ts, w0, z, a):
    tau = np.maximum(t - ts, 0)
    wd = w0 * math.sqrt(max(1 - z * z, 1e-9))
    return a * (1 - np.exp(-z * w0 * tau) * (np.cos(wd * tau) + z * w0 / wd * np.sin(wd * tau)))


# Episodes: runs where the shift leaves its resting level by more than 2 pt.
episodes = []
level = rows[0]['shift']
i = 0
while i < len(rows):
    if abs(rows[i]['shift'] - level) > 2:
        start = max(0, i - 3)
        j = i
        while j < len(rows) and not (abs(rows[j]['shift'] - rows[min(j + 8, len(rows) - 1)]['shift']) < 0.3 and rows[j]['ms'] - rows[i]['ms'] > 600):
            j += 1
        end = min(j + 2, len(rows) - 1)
        episodes.append((start, end, level))
        level = rows[end]['shift']
        i = end + 1
    else:
        i += 1

out = []
for start, end, base in episodes:
    seg = rows[start:end + 1]
    t0 = seg[0]['ms'] / 1000
    t = np.array([r['ms'] / 1000 - t0 for r in seg])
    y = np.array([r['shift'] - base for r in seg])
    a = amp if y[-1] > 0 else -amp
    keep = t <= 0.7
    try:
        p, _ = curve_fit(lambda t, ts, w0, z: spring(t, ts, w0, z, a), t[keep], y[keep], p0=[0.05, 17, 0.8], bounds=([0, 3, 0.3], [0.5, 60, 1.0]))
        res = y[keep] - spring(t[keep], *p, a)
        fit = dict(start_ms=round(p[0] * 1000, 1), omega=round(p[1], 2), zeta=round(p[2], 3), stiffness_m1=round(p[1] ** 2, 1),
                   damping_m1=round(2 * p[1] * p[2], 2), rms_pt=round(float(np.sqrt(np.mean(res ** 2))), 3), n=int(keep.sum()))
    except Exception as error:  # noqa: BLE001
        fit = dict(error=str(error))
    ts = fit.get('start_ms', 0) / 1000
    table = [dict(ms=round((r['ms'] / 1000 - t0 - ts) * 1000), shift=round(r['shift'] - base, 2), xmark=int(r['xmark']), glyph=int(r['glyph'])) for r in seg]
    peak = max(table, key=lambda r: abs(r['shift']))
    out.append(dict(video_ms=round(seg[0]['ms']), amplitude=a, fit=fit, peak=peak, table=table))

print(json.dumps(dict(video=video, frames=len(frames), fps=round(len(frames) / (frames[-1][0] / 1000), 1), episodes=out), indent=1))
