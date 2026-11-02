"""search-frame-log.py METRO_LOG [FROM_BYTE [TO_BYTE]] [--opens] [--reversals]   (#341 verification, 2026-11-02)

Reads the UI-thread frame log of Library Search's field out of a Metro log and prints, per motion, the gaps between frames, the first
`lift` values and every gap over 25 ms. A recording cannot say whether the app's first frame jumped: `simctl io recordVideo` stamps
frames with a jitter of about 17 ms and drops some. The app's own frames can, with this temporary instrumentation (never commit it;
`git checkout -- src/app/library-search-field.tsx` afterwards and check that `curl -s 'http://localhost:PORT/index.bundle?platform=ios&dev=true&minify=false' | grep -c '\\[FRAME\\]'` reads 0):

    import { useFrameCallback } from 'react-native-reanimated';      // beside the other imports
    ...
    const dbgPrev = useSharedValue(-2);                                // in LibrarySearchField, after the shared values
    useFrameCallback((frame) => {
      'worklet';
      const l = lift.get();
      if (l !== dbgPrev.get()) {
        dbgPrev.set(l);
        console.log('[FRAME]', Math.round(frame.timestamp * 10) / 10, Math.round((frame.timeSincePreviousFrame ?? 0) * 10) / 10,
          l.toFixed(4), shown.get().toFixed(3), close.get());
      }
    });

One line per UI frame in which `lift` changed: the frame's timestamp (the host's uptime in ms, `time.clock_gettime(time.CLOCK_UPTIME_RAW)` in
Python, so a Mac key or a touch can be stamped on the same clock), the gap since the previous UI frame, `lift`, `shown` and `close`.
Start Metro with its output in a file and note the file's size before a run (`wc -c`); FROM_BYTE and TO_BYTE bound what is read.

--opens       every open and close: the first two logged `lift` values, the gap before the first logged frame, the largest later gap, the peak,
              Close's frame, and the residual in points (of 60) of the configured spring (mass 1, stiffness 350, damping 30) on the clamped clock
              of `held-spring.ts` (each frame advances the spring by at most 1/60 s; only its start is free), with a free fit's omega and zeta. It
              counts the opens above a spring from rest: a first value over 0.0411 or a second over 0.1388, one and two 60 Hz frames of the
              spring. On beta1 (Reanimated's own spring) 19 of 39 opens were above it, with values up to 0.41; on beta2 (the held spring) 0 of 47: 25
              with the software keyboard, 4 first opens after a launch, 6 with Reduce Motion on, 12 without a keyboard (the
              `showSoftInputOnFocus={false}` stand-in), however long the hold before the first frame (to 457 ms).
--reversals   every opening turned back (an Escape: rises from rest to a peak under 0.999, then falls) and every fade turned back (a Cmd+F:
              falls from 1 to a trough over 0.003, then rises): the lift at the turn, the hold (the time from the turning frame to the next
              logged frame, in which the field waits for the keyboard to change hands), the largest step after the turn and whether Close had
              appeared. A gap in a motion's log can also be idle time between two motions, so a hold is read here, not from the gap list.
"""
import math
import re
import sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = {a for a in sys.argv[1:] if a.startswith('--')}
log = args[0]
start = int(args[1]) if len(args) > 1 else 0
end = int(args[2]) if len(args) > 2 else None
data = open(log, 'rb').read()[start:end].decode('utf8', 'replace')
rows = [tuple(float(x) for x in m.groups())
        for m in re.finditer(r'\[FRAME\]\s+([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)', data)]
groups = []
for row in rows:
    if groups and row[0] - groups[-1][-1][0] < 600:
        groups[-1].append(row)
    else:
        groups.append([row])

FRAME = 1000 / 60
W0 = math.sqrt(350.0)
Z0 = 30 / (2 * W0)
ONE, TWO = 0.0411, 0.1388


def spring(t, ts, w0=W0, z=Z0):
    import numpy as np
    tau = np.maximum(np.asarray(t) - ts, 0)
    wd = w0 * math.sqrt(max(1 - z * z, 1e-9))
    return 1 - np.exp(-z * w0 * tau) * (np.cos(wd * tau) + z * w0 / wd * np.sin(wd * tau))


def opens_and_closes():
    import numpy as np
    from scipy.optimize import least_squares
    opens, closes = [], []
    for g in groups:
        if len(g) < 12:
            continue
        lifts = np.array([r[2] for r in g])
        if lifts[0] < 0.5 and lifts.max() > 0.9:
            stop = next((i for i in range(3, len(g)) if lifts[i] < lifts[i - 1] - 0.02), len(g))
            opens.append(g[:stop])
        elif lifts[0] > 0.5 and lifts.min() < 0.05 and lifts[-1] < 0.1:
            closes.append(g)

    def clock(g):
        t = [FRAME / 1000]
        for a, b in zip(g, g[1:]):
            t.append(t[-1] + min(b[0] - a[0], FRAME) / 1000)
        return np.array(t)

    def fit(g, y):
        t = clock(g)
        one = least_squares(lambda p: spring(t, p[0]) - y, [0.0], bounds=([-0.05], [0.05]))
        free = least_squares(lambda p: spring(t, p[0], p[1], p[2]) - y, [0.0, W0, Z0], bounds=([-0.05, 5, 0.3], [0.05, 60, 0.99]))
        return float(np.sqrt(np.mean(one.fun ** 2))) * 60, free.x[1], free.x[2]

    above = 0
    print(f'{len(opens)} opens, {len(closes)} closes')
    for i, g in enumerate(opens, 1):
        l = [r[2] for r in g]
        gaps = [b[0] - a[0] for a, b in zip(g, g[1:])]
        over = l[0] > ONE + 1e-4 or l[1] > TWO + 1e-4
        above += over
        rms, om, ze = fit(g, np.array(l))
        close_at = next((round(r[0] - g[0][0], 1) for r in g if r[4] >= 1), None)
        print(f'open {i:2d}: first {l[0]:.4f} second {l[1]:.4f}{"  ABOVE" if over else ""} | gap before first {g[0][1]:5.1f} ms, later max gap {max(gaps):5.1f} ms | '
              f'peak {max(l):.4f} | Close frame {close_at} ms | fit rms {rms:.3f} pt, free omega {om:.2f} zeta {ze:.3f}')
    print(f'opens above a spring from rest (first > {ONE} or second > {TWO}): {above} of {len(opens)}')
    for i, g in enumerate(closes, 1):
        l = [r[2] for r in g]
        gaps = [b[0] - a[0] for a, b in zip(g, g[1:])]
        rms, om, ze = fit(g, 1 - np.array(l))
        print(f'close {i:2d}: first {l[0]:.4f} second {l[1]:.4f} | gap before first {g[0][1]:5.1f} ms, later max gap {max(gaps):5.1f} ms | lowest {min(l):.4f} | fit rms {rms:.3f} pt')


def reversals():
    opening, fade = [], []
    for g in groups:
        l = [r[2] for r in g]
        if len(g) < 8:
            continue
        if l[0] < 0.1:
            k = next((i for i in range(len(l) - 1) if l[i + 1] < l[i] - 0.004), None)
            if k is not None and 0.003 < l[k] < 0.999 and min(l[k:]) < 0.01:
                steps = [abs(l[i + 1] - l[i]) for i in range(k + 1, min(len(l) - 1, k + 12))]
                opening.append((l[k], g[k + 1][0] - g[k][0], max(steps, default=0), max(r[4] for r in g[:k + 1])))
                continue
        if l[0] > 0.8:
            k = next((i for i in range(len(l) - 1) if l[i + 1] > l[i] + 0.004), None)
            if k is not None and l[k] > 0.003 and max(l[k:]) > 0.9:
                steps = [abs(l[i + 1] - l[i]) for i in range(k + 1, min(len(l) - 1, k + 12))]
                fade.append((l[k], g[k + 1][0] - g[k][0], max(steps, default=0), max(r[4] for r in g)))
    print(f'{len(opening)} openings turned back, {len(fade)} fades turned back')
    for name, found in (('opening', opening), ('fade', fade)):
        for i, (v, hold, step, close) in enumerate(found, 1):
            print(f'{name} {i:2d}: turned at lift {v:.3f}; hold {hold:6.1f} ms; largest step after {step:.4f} ({step * 60:.2f} pt); Close shown {int(close)}')


if '--opens' in flags:
    opens_and_closes()
if '--reversals' in flags:
    reversals()
if not flags:
    for index, group in enumerate(groups):
        if len(group) < 3:
            continue
        t0 = group[0][0]
        gaps = [round(b[0] - a[0], 1) for a, b in zip(group, group[1:])]
        lifts = [row[2] for row in group]
        direction = 'open' if lifts[-1] > lifts[0] else 'close'
        big = [(round(group[i][0] - t0), group[i][2], gaps[i - 1]) for i in range(1, len(group)) if gaps[i - 1] > 25]
        print(f'#{index} {direction} n={len(group)} span {round(group[-1][0] - t0)} ms; first gap {group[0][1]} ms; '
              f'first lifts {[round(x, 3) for x in lifts[:5]]}; max gap {max(gaps) if gaps else 0}; gaps over 25 ms {big}')
