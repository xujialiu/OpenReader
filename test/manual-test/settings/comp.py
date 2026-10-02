#!/usr/bin/env python3
"""Composite sampler for #118 page measurements.

  python3 comp.py SHOT.png PAGE_HEX EXPECTED:X1,Y1,X2,Y2 ... [--rects]
  python3 comp.py SHOT.png page=RRGGBB sentence=RRGGBB word=RRGGBB [x0 y0 x1 y1]

Classifies every pixel in the region (points, default whole screen) as page,
sentence-composite, word-composite or other (text), and reports each class's
share and mean colour. Tolerance 12 per channel.
"""
import sys
from PIL import Image

PT = 3.0

def hexrgb(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))

def mean_of(px, xs, ys):
    n = len(xs)
    if not n: return None
    return tuple(round(sum(px[x, y][c] for x, y in zip(xs, ys)) / n) for c in range(3))

def main():
    path = sys.argv[1]
    page = hexrgb(sys.argv[2])
    sentence = hexrgb(sys.argv[3])
    word = hexrgb(sys.argv[4])
    box = (0, 0, None, None)
    args = sys.argv[5:]
    if len(args) >= 4:
        box = (int(float(args[0]) * PT), int(float(args[1]) * PT),
               int(float(args[2]) * PT), int(float(args[3]) * PT))
    im = Image.open(path).convert('RGB')
    W, H = im.size
    x0, y0, x1, y1 = box
    x1 = x1 if x1 else W
    y1 = y1 if y1 else H
    px = im.load()
    TOL = 12
    def near(c, t): return abs(c[0]-t[0]) <= TOL and abs(c[1]-t[1]) <= TOL and abs(c[2]-t[2]) <= TOL
    counts = {'page': 0, 'sentence': 0, 'word': 0, 'other': 0}
    xs = {k: [] for k in counts}
    ys = {k: [] for k in counts}
    sent_rows = {}
    word_rows = {}
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            c = px[x, y]
            if near(c, word): k = 'word'
            elif near(c, sentence): k = 'sentence'
            elif near(c, page): k = 'page'
            else: k = 'other'
            counts[k] += 1
            xs[k].append(x); ys[k].append(y)
            if k in ('sentence', 'word'):
                rows = sent_rows if k == 'sentence' else word_rows
                rows.setdefault(y, [x, x])
                r = rows[y]
                r[0] = min(r[0], x); r[1] = max(r[1], x)
    total = sum(counts.values())
    out = [path.split('/')[-1]]
    for k in counts:
        m = mean_of(px, xs[k], ys[k])
        mtxt = '#%02x%02x%02x' % m if m else '-'
        out.append(f"{k} {100*counts[k]/total:5.1f}% mean={mtxt}")
    def band(rows):
        if not rows: return '-'
        ys_ = sorted(rows)
        top, bot = ys_[0], ys_[-1]
        # the widest row's extent
        widest = max(rows.values(), key=lambda r: r[1] - r[0])
        return f"y {top/PT:.1f}..{(bot+1)/PT:.1f}pt x {widest[0]/PT:.1f}..{(widest[1]+1)/PT:.1f}pt rows={len(ys_)}"
    out.append(f"sentence-band {band(sent_rows)}")
    out.append(f"word-band    {band(word_rows)}")
    print(' | '.join(out))
    # word inside sentence? compare word band rows within sentence band rows
    if sent_rows and word_rows:
        s0, s1 = min(sent_rows), max(sent_rows)
        w0, w1 = min(word_rows), max(word_rows)
        inside = s0 - 4 <= w0 and w1 <= s1 + 4
        print(f"word-inside-sentence: {inside} (sentence {s0/PT:.1f}..{(s1+1)/PT:.1f}, word {w0/PT:.1f}..{(w1+1)/PT:.1f})")

if __name__ == '__main__':
    main()
