"""search-frame-log.py METRO_LOG [FROM_BYTE]   (#341 verification, 2026-11-02)

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
Start Metro with its output in a file and note the file's size before a run (`wc -c`); FROM_BYTE skips what came before.

Measured with it (notes 2026-11-02, the tester's entry): the smooth opens and closes fit the configured spring exactly (omega 18.71, zeta
0.802), and about half of the opens start with a first step of `lift` 0.3 to 0.4 (22.4 pt three times, the value of a 64 ms step, Reanimated's
cap on one frame) in place of the 0.02 to 0.1 of a spring from rest.
"""
import re
import sys

log = sys.argv[1]
start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
data = open(log, 'rb').read()[start:].decode('utf8', 'replace')
rows = [tuple(float(x) for x in m.groups())
        for m in re.finditer(r'\[FRAME\]\s+([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)', data)]
groups = []
for row in rows:
    if groups and row[0] - groups[-1][-1][0] < 600:
        groups[-1].append(row)
    else:
        groups.append([row])
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
