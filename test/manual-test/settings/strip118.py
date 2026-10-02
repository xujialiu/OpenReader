# STALE-STRIP DETECTOR FOR #118's colours — adapted from
# test/manual-test/scrolling-and-theme/leading-strip.py, whose predicate is the
# OLD dark word colour. Same region logic: vertical runs of the word mark's
# composite colour, grouped into regions; a region whose tallest run is at
# least 80 % of the line box is the word; anything else (not inside a word) is
# a strip a moved highlight left behind.
#
#   python3 strip118.py SHOT.png WORD_RGB LINE_PX [TOL]
#
# Exit 1 RED (stale strip), 0 GREEN, 2 INVALID (no word colour at all).
import sys
from PIL import Image

path = sys.argv[1]
word = tuple(int(sys.argv[2].lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
LINE = int(sys.argv[3])
TOL = int(sys.argv[4]) if len(sys.argv) > 4 else 10

im = Image.open(path).convert('RGB')
W, H = im.size
px = im.load()

def is_word(c):
    return abs(c[0]-word[0]) <= TOL and abs(c[1]-word[1]) <= TOL and abs(c[2]-word[2]) <= TOL

runs = []
for x in range(W):
    y = 0
    while y < H:
        if is_word(px[x, y]):
            y0 = y
            while y < H and is_word(px[x, y]):
                y += 1
            runs.append((x, y0, y - 1))
        y += 1

parent = list(range(len(runs)))
def find(i):
    while parent[i] != i:
        parent[parent[i]] = parent[parent[i]]
        i = parent[i]
    return i
by_x = {}
for i, (x, y0, y1) in enumerate(runs):
    by_x.setdefault(x, []).append(i)
for i, (x, y0, y1) in enumerate(runs):
    for j in by_x.get(x - 1, []):
        _, a0, a1 = runs[j]
        if a0 <= y1 and y0 <= a1:
            parent[find(i)] = find(j)

regions = {}
for i, (x, y0, y1) in enumerate(runs):
    r = regions.setdefault(find(i), {'x0': x, 'x1': x, 'y0': y0, 'y1': y1, 'n': 0, 'tallest': 0})
    r['x0'] = min(r['x0'], x); r['x1'] = max(r['x1'], x)
    r['y0'] = min(r['y0'], y0); r['y1'] = max(r['y1'], y1)
    r['n'] += y1 - y0 + 1
    r['tallest'] = max(r['tallest'], y1 - y0 + 1)

kept = [r for r in regions.values() if r['n'] >= 40 and r['x1'] - r['x0'] >= 6]
words = [r for r in kept if r['tallest'] >= LINE * 0.8]
def inside(r, w):
    return w['x0'] <= r['x0'] and r['x1'] <= w['x1'] and w['y0'] <= r['y0'] and r['y1'] <= w['y1']
stale = [r for r in kept if r not in words and not any(inside(r, w) for w in words)]
for r in sorted(words + stale, key=lambda r: (r['y0'], r['x0'])):
    print('%s: y %d..%d (tallest run %d px), x %d..%d' % ('word' if r in words else 'STALE', r['y0'], r['y1'], r['tallest'], r['x0'], r['x1']))
if not stale and not words:
    print('INVALID', path)
    sys.exit(2)
print('RED' if stale else 'GREEN', path)
sys.exit(1 if stale else 0)
