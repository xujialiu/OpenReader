"""Frame by frame: where the Library's first row is, whether the search field shows, and what a catch of the bounce does (#338).

  python3 -I frame-track.py VIDEO TOP.png OUT.csv [--from S --to S]   one pass over a recording, one CSV row per frame
  python3 -I frame-track.py --catches OUT.csv [LIMIT_PT]               every bounce in the CSV, with its catch
  python3 -I frame-track.py --series OUT.csv FROM_S TO_S               the frames of a window, with step and speed

TOP.png is the page at rest at its top with search hidden (first row at y 128 pt), as for bounce.py. The first row is
matched the way bounce.py matches it (the whole row, score >= 0.985, 20 pt above to 500 pt below its rest place) and
the field the way field-visible.py scores it (at least 15 uniform pixel rows in the 100-187 pt band, with the app's own
bar on screen), in one pass, so a 3 minute recording takes about 2 minutes. The CSV holds `millis,y_pt,score,
field_rows,bar` with absolute video times; y_pt is the first row's offset from its rest place in points (positive: the
list is past its top) and is empty when the row is not on screen (the coast of a flick crosses the 20 pt window in
less than one frame).

--catches finds each bounce (a peak at least 40 pt past the top) and prints its peak, the longest hold after the
peak (the list standing still while a finger rests on it: the recorder writes a frame only when the screen changes,
so a hold is a run of identical offsets or one long gap), the first three moves after the hold, and the largest field
row count in the bounce's frames. A step over LIMIT_PT in those three moves (default 60: a finger flicking at 3000
pt/s moves 50 pt a frame and the list follows it rubber-banded, while the fault of #338 round 2 was 119 pt in one
frame) is marked JUMP, a field with the app's bar on screen is marked FIELD. Exit 1 when any bounce is marked, 0 when
none is, 2 when the CSV has no bounce. A pull that commits, and a search that stays open, are marked FIELD too, and
a hold is a bounce as well: the episode of a committed search (a first row 54 pt down for seconds) is listed, and its
Close is a step of 54 pt that --catches does not mark when it comes after the first three moves. Read the end of
a pull's frames with --series.
What it cannot tell: which catch a bounce is (read them in order against the probe's log), a catch whose first frames
are dropped by the recorder, or any screen but the iPhone 17's (1206x2622, 3 px a point).
"""
import csv
import sys


def track(video, top, out, args):
    import cv2
    import numpy as np

    cv2.setNumThreads(2)
    t0 = float(args[args.index('--from') + 1]) * 1000 if '--from' in args else 0.0
    t1 = float(args[args.index('--to') + 1]) * 1000 if '--to' in args else 1e12
    reference = cv2.cvtColor(cv2.imread(top), cv2.COLOR_BGR2GRAY)
    x0, x1, y0, y1 = 60, 900, 420, 600  # the first row at rest, in pixels
    template = reference[y0:y1, x0:x1]
    above, below, match = 60, 1500, 0.985

    def field_rows(image):
        band = image[300:561, 600:1101]
        background = np.median(image[300:561, 6:51], axis=1)
        middle = np.median(band, axis=1)
        uniform = (np.abs(band - middle[:, None]) <= 2).mean(axis=1) >= 0.95
        return int((uniform & (np.abs(middle - background) >= 6)).sum())

    def app_bar_shown(image):
        return image[186:318, 60:192].std() >= 20 and image[222:285, 519:687].std() >= 60

    capture = cv2.VideoCapture(video)
    rows = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        millis = capture.get(cv2.CAP_PROP_POS_MSEC)
        if not t0 <= millis <= t1:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        low, high = max(0, y0 - above), min(gray.shape[0], y1 + below)
        scores = cv2.matchTemplate(gray[low:high, x0 - 10:x1 + 10], template, cv2.TM_CCOEFF_NORMED)[:, 10]
        where = int(np.argmax(scores))
        y = (low + where - y0) / 3.0 if scores[where] >= match else None
        wide = gray.astype(np.int16)
        rows.append((millis, y, float(scores[where]), field_rows(wide), int(app_bar_shown(wide))))
    with open(out, 'w') as sink:
        sink.write('millis,y_pt,score,field_rows,bar\n')
        for millis, y, score, field, bar in rows:
            sink.write('%.1f,%s,%.3f,%d,%d\n' % (millis, '' if y is None else '%.1f' % y, score, field, bar))
    print('frames=%d written=%d' % (int(capture.get(cv2.CAP_PROP_FRAME_COUNT)), len(rows)))


def load(path):
    rows = list(csv.DictReader(open(path)))
    return ([float(r['millis']) / 1000 for r in rows], [float(r['y_pt']) if r['y_pt'] else None for r in rows],
            [int(r['field_rows']) for r in rows], [int(r['bar']) for r in rows])


def catches(path, limit):
    t, y, field, bar = load(path)
    episodes, current, last = [], [], None
    for i in range(len(t)):
        if y[i] is None:
            continue
        if last is not None and t[i] - last > 1.2 and current:
            episodes.append(current)
            current = []
        current.append(i)
        last = t[i]
    if current:
        episodes.append(current)
    found, marked = 0, 0
    for episode in episodes:
        ys = [y[i] for i in episode]
        if max(ys) < 40:
            continue
        found += 1
        peak = max(range(len(episode)), key=lambda k: ys[k])
        best = (0.0, None, None)
        k = peak
        while k < len(episode) - 1:
            j = k
            while j + 1 < len(episode) and abs(ys[j + 1] - ys[k]) < 0.7:
                j += 1
            if t[episode[j]] - t[episode[k]] > best[0] and ys[k] > 3:
                best = (t[episode[j]] - t[episode[k]], k, j)
            k = j + 1 if j > k else k + 1
        held, start, end = best
        moves, step = '', 0.0
        if end is not None:
            after = [(ys[a] - ys[a - 1], (t[episode[a]] - t[episode[a - 1]]) * 1000) for a in range(end + 1, min(end + 4, len(episode)))]
            if after:
                moves = ', '.join('%+.1f pt in %.0f ms' % m for m in after)
                step = max(abs(m[0]) for m in after)
        rows = [field[i] for i in episode if bar[i]]
        most = max(rows) if rows else 0
        flags = (' JUMP' if step > limit else '') + (' FIELD' if most >= 15 else '')
        marked += bool(flags)
        print('bounce %d: video %.2f-%.2f s, peak %.1f pt, held %.3f s at %s, first three moves after the hold: %s, field rows max %d%s' % (
            found, t[episode[0]], t[episode[-1]], ys[peak], held, '%.1f' % ys[start] if start is not None else 'n/a',
            moves or 'n/a', most, flags))
    print('bounces=%d marked=%d (JUMP: a step over %.0f pt in the first three frames after the hold; FIELD: 15 or more field rows)' % (found, marked, limit))
    return 2 if not found else (1 if marked else 0)


def series(path, first, last):
    t, y, field, bar = load(path)
    previous = None
    print('   t(s)  dt(ms) offset  step  pt/s  field_rows bar')
    for i in range(len(t)):
        if not first <= t[i] <= last:
            continue
        if y[i] is None:
            print('%8.3f      -  (no match)           fr=%d bar=%d' % (t[i], field[i], bar[i]))
            previous = None
        elif previous is None:
            print('%8.3f      - %7.1f                 fr=%d bar=%d' % (t[i], y[i], field[i], bar[i]))
            previous = (t[i], y[i])
        else:
            dt, step = (t[i] - previous[0]) * 1000, y[i] - previous[1]
            print('%8.3f %7.1f %7.1f %5.1f %5.0f      fr=%d bar=%d' % (t[i], dt, y[i], step, step / (dt / 1000) if dt else 0, field[i], bar[i]))
            previous = (t[i], y[i])


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == '--catches':
        sys.exit(catches(sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 60.0))
    elif len(sys.argv) >= 5 and sys.argv[1] == '--series':
        series(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
    elif len(sys.argv) >= 4 and not sys.argv[1].startswith('--'):
        track(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        sys.exit(__doc__)
