# Hitches in a scroll, from a `simctl io recordVideo` recording.
#
#   python3 test/manual-test/frame-gaps.py VIDEO [RECORDING_START_UNIX_SECONDS]
#
# A simctl recording holds a frame only when the screen changed, so while the
# page moves, the time between two frames is how long the screen stood still.
# The reader's text area (below the header, above the player) is compared frame
# to frame; frames that differ are grouped into scroll episodes (0.4 s without
# change ends one), and every gap over 50 ms inside an episode is printed, with
# its wall time when the recording's start is given. Each flick's first frame
# comes 62-67 ms after the last with nothing else running (2026-09-28), so a
# gap of that size at a flick's start is the gesture, not a hitch. What it
# cannot tell: why a frame was late, or whether a person would notice it.
import sys
import cv2
import numpy as np

path = sys.argv[1]
start = float(sys.argv[2]) if len(sys.argv) > 2 else None
capture = cv2.VideoCapture(path)
previous = None
rows = []  # (seconds into the recording, points moved up, mean difference)
while True:
    ok, frame = capture.read()
    if not ok:
        break
    t = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame[int(h * 0.12):int(h * 0.62), int(w * 0.05):int(w * 0.95)], cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (gray.shape[1] // 2, gray.shape[0] // 2)).astype(np.float32)
    moved, difference = 0.0, 0.0
    if previous is not None:
        difference = float(np.mean(np.abs(gray - previous)))
        if difference > 1.0:
            (_, shift), _ = cv2.phaseCorrelate(previous, gray)
            moved = -shift * 2 / 3  # a 3x screen analysed at half size
    rows.append((t, moved, difference))
    previous = gray
if not rows:
    sys.exit('No frames in ' + path)
print(f'frames={len(rows)} duration={rows[-1][0]:.2f}s')
changed = [i for i in range(1, len(rows)) if rows[i][2] > 1.0]
episodes, current = [], []
for i in changed:
    if current and rows[i][0] - rows[current[-1]][0] > 0.4:
        episodes.append(current)
        current = []
    current.append(i)
if current:
    episodes.append(current)
gaps_all = []
for episode in episodes:
    times = [rows[i][0] for i in episode]
    gaps = np.diff(times) if len(times) > 1 else np.array([0.0])
    gaps_all += list(gaps)
    wall = f' wall={start + times[0]:.2f}' if start else ''
    print(f'episode {times[0]:.2f}-{times[-1]:.2f}s frames={len(episode)} fps={len(episode) / max(times[-1] - times[0], 1e-3):.0f} '
          f'max gap={gaps.max() * 1000:.0f}ms >34ms={int((gaps > 0.034).sum())}{wall}')
    for a, b in zip(episode, episode[1:]):
        gap = rows[b][0] - rows[a][0]
        if gap > 0.05:
            wall = f' wall={start + rows[b][0]:.2f}' if start else ''
            print(f'  gap {gap * 1000:.0f}ms before {rows[b][0]:.3f}s (moved {rows[a][1]:.1f} -> {rows[b][1]:.1f} pt a frame){wall}')
if gaps_all:
    g = np.array(gaps_all)
    print(f'all episodes: gaps={len(g)} median={np.median(g) * 1000:.1f}ms p95={np.percentile(g, 95) * 1000:.1f}ms '
          f'max={g.max() * 1000:.0f}ms >50ms={int((g > 0.05).sum())} >100ms={int((g > 0.1).sum())}')
