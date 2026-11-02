"""search-motion-episodes.py VIDEO [--band Y0 Y1] [--json OUT]   (#341 verification, 2026-11-02)

Per-episode numbers of the Library Search field's opens and closes, from a `simctl io recordVideo` recording of a Library at the top
of its list (light appearance: the darkness measures read an inverted dark page wrongly).

Same measurements as library-and-reader/search-motion.py (phase correlation of a band of rows against the first
frame, darkness of Close's xmark and of the magnifier region), but episodes are found from the magnifier's glyph
darkness crossing 128 (up = open, down = close), duplicates (identical consecutive frames) are dropped, and each
episode reports: motion start (first frame above 1 pt), peak and its time, 50 % / 90 % times, Close's appearance,
the glyph's fade, the largest step between consecutive unique frames, and the residual of the configured spring
(mass 1, stiffness 350, damping 30: w 18.71, z 0.802) with only its start time free, and of a fully free fit.
"""
import sys, math, json
import cv2, numpy as np
from scipy.optimize import curve_fit, least_squares

video = sys.argv[1]
args = sys.argv[2:]
band = (200.0, 420.0)
if '--band' in args:
    i = args.index('--band'); band = (float(args[i + 1]), float(args[i + 2]))
out_json = args[args.index('--json') + 1] if '--json' in args else None
amp = 60.0

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
prev = None
for pts, g in frames:
    band_img = crop(g, 16, band[0], 300, band[1])
    top = crop(g, 0, 60, 402, 200)          # the title bar and the field's area, for the duplicate test
    dup = prev is not None and float(np.mean(np.abs(top - prev))) < 0.05
    prev = top
    shift = cv2.phaseCorrelate(ref, band_img, win)[0][1] / S
    xmark = 255 - crop(g, 356, 131, 371, 146).min()
    glyph = 255 - crop(g, 29, 131, 46, 146).min()
    rows.append(dict(ms=pts, shift=shift, xmark=float(xmark), glyph=float(glyph), dup=dup))


def spring(t, ts, w0, z, a):
    tau = np.maximum(np.asarray(t) - ts, 0)
    wd = w0 * math.sqrt(max(1 - z * z, 1e-9))
    return a * (1 - np.exp(-z * w0 * tau) * (np.cos(wd * tau) + z * w0 / wd * np.sin(wd * tau)))


W0, Z0 = 18.71, 0.802

# Events: the glyph darkness crossing 128.
events = []
state = 'low' if rows[0]['glyph'] < 128 else 'high'
for i, r in enumerate(rows):
    if state == 'low' and r['glyph'] >= 128:
        events.append(('open', i)); state = 'high'
    elif state == 'high' and r['glyph'] < 128:
        events.append(('close', i)); state = 'low'

def kbshare(g_bgr):
    return None

# keyboard presence: re-read colour frames at the plateau (share of pixels in y 620..840 that are bluish-grey)
def keyboard_at(t_ms):
    c = cv2.VideoCapture(video)
    while True:
        ok, f = c.read()
        if not ok: return None
        if c.get(cv2.CAP_PROP_POS_MSEC) >= t_ms:
            S2 = f.shape[1] / 402.0
            reg = f[int(620 * S2):int(840 * S2), :, :].astype(np.float32)
            return round(float(((reg[:, :, 0] - reg[:, :, 2]) >= 5).mean()), 2)

report = []
for kind, i in events:
    t_cross = rows[i]['ms']
    lo = max(0, next((j for j in range(i, -1, -1) if rows[j]['ms'] < t_cross - 700), 0))
    hi = next((j for j in range(i, len(rows)) if rows[j]['ms'] > t_cross + 900), len(rows) - 1)
    seg = [r for r in rows[lo:hi + 1] if not r['dup']]
    base = np.median([r['shift'] for r in rows[lo:lo + 3]])
    a = amp if kind == 'open' else -amp
    # the resting level before: the list's shift in the first frames of the window
    pre = [r for r in seg if r['ms'] < t_cross - 600]
    level = float(np.median([r['shift'] for r in pre])) if pre else float(base)
    series = [(r['ms'], r['shift'] - level, r['xmark'], r['glyph']) for r in seg]
    start = next((s for s in series if abs(s[1]) > 1.0), None)
    if start is None:
        report.append(dict(kind=kind, error='no motion found')); continue
    t0 = start[0]
    rel = [(s[0] - t0, s[1], s[2], s[3]) for s in series if s[0] >= t0 - 50]
    peak = max(rel, key=lambda r: abs(r[1]))
    pk = abs(peak[1])
    t50 = next((r[0] for r in rel if abs(r[1]) >= 0.5 * amp), None)
    t90 = next((r[0] for r in rel if abs(r[1]) >= 0.9 * amp), None)
    close_on = next((r[0] for r in rel if r[2] > 128), None)
    close_off = next((r[0] for r in rel if r[2] < 128), None) if kind == 'close' else None
    g_first = next((r[0] for r in rel if r[3] > 40), None)
    steps = [abs(b[1] - a_[1]) for a_, b in zip(rel, rel[1:])]
    gaps = [b[0] - a_[0] for a_, b in zip(rel, rel[1:])]
    # fit windows: motion start - 40 ms to +700 ms
    win_rel = [r for r in rel if r[0] <= 700]
    tt = np.array([r[0] / 1000 for r in win_rel]); yy = np.array([r[1] for r in win_rel])
    res = {}
    try:
        f1 = least_squares(lambda p: spring(tt, p[0], W0, Z0, a) - yy, [0.0], bounds=([-0.1], [0.2]))
        res['fixed_spring'] = dict(start_ms=round(f1.x[0] * 1000, 1), rms=round(float(np.sqrt(np.mean(f1.fun ** 2))), 3))
        p, _ = curve_fit(lambda t, ts, w0, z: spring(t, ts, w0, z, a), tt, yy, p0=[0.0, 18.7, 0.8], bounds=([-0.1, 5, 0.3], [0.2, 60, 1.0]))
        r2 = yy - spring(tt, *p, a)
        res['free'] = dict(start_ms=round(p[0] * 1000, 1), omega=round(p[1], 2), zeta=round(p[2], 3), rms=round(float(np.sqrt(np.mean(r2 ** 2))), 3))
    except Exception as e:  # noqa: BLE001
        res['error'] = str(e)
    kbd = keyboard_at(t0 + 1200) if kind == 'open' else None
    report.append(dict(kind=kind, video_ms=round(t0), keyboard=kbd, peak=round(peak[1], 2), peak_ms=round(peak[0]), t50=None if t50 is None else round(t50),
                       t90=None if t90 is None else round(t90), glyph_first=g_first, close_on=None if close_on is None else round(close_on),
                       close_off=None if close_off is None else round(close_off), n=len(rel),
                       max_step=round(max(steps), 1) if steps else None, max_gap=round(max(gaps)) if gaps else None,
                       first_steps=[round(abs(r[1]), 1) for r in rel[:6]], first_ms=[round(r[0]) for r in rel[:6]], fits=res,
                       table=[(round(r[0]), round(r[1], 2), int(r[2]), int(r[3])) for r in rel if r[0] <= 700]))

if out_json:
    json.dump(dict(video=video, events=report), open(out_json, 'w'))
for r in report:
    print(json.dumps({k: v for k, v in r.items() if k != 'table'}))
