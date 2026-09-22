"""The detector for #35: word-highlight colour left on the screen by a word the highlight has left.

    python3 test/manual-test/leading-strip.py SCREENSHOT [LINE_PX]

Finds every connected region of the dark theme's word colour and sorts it:

- **word**: a region whose tallest vertical run is at least 80 % of a line box,
  which is the word the highlight is on;
- **STALE**: anything shorter that is not a counter inside a word (the amber an
  `e` or a `q` encloses), which is a strip a moved highlight left behind.

Exit 1 (RED) when there is a stale strip, 0 (GREEN) when every region is a
whole word, 2 (INVALID) when there is no word colour at all: the run never
reached the word it was meant to hold, so it measured nothing.

LINE_PX is the line box in device pixels: 102 for WebKit's serif at Font Size
28 on a 3x screen (34 CSS px), the default. The colour is the dark theme's
`rgba(255, 176, 0, 0.85)` over the page or the Utterance tint, (219, 152, 3) and
(226, 157, 2) in a simulator screenshot; nothing else on a dark reading page is
that colour.
"""
import sys

from PIL import Image

path = sys.argv[1]
LINE = int(sys.argv[2]) if len(sys.argv) > 2 else 102
im = Image.open(path).convert('RGB')
W, H = im.size
px = im.load()
assert px is not None


# The blue is what tells the word colour from React Native's LogBox "!" icon,
# which sits at the bottom of the screen after any app warning (README,
# Pitfalls): 2 to 5 in the word in a simulator's PNG, 48 all over the icon,
# edges included. A JPEG, such as a screenshot sent from a phone, blurs the
# word's blue up to 54, so it is let in there.
BLUE = 60 if path.lower().endswith(('.jpg', '.jpeg')) else 30


def amber(c):
    r, g, b = c
    return 175 < r < 245 and 110 < g < 180 and b < BLUE


# Vertical runs of amber in every column; runs in neighbouring columns that
# overlap vertically are one region. A glyph inside a word breaks its runs, so a
# region's height is its tallest run.
runs = []
for x in range(W):
    y = 0
    while y < H:
        if amber(px[x, y]):
            y0 = y
            while y < H and amber(px[x, y]):
                y += 1
            runs.append((x, y0, y - 1))
        y += 1

parent = list(range(len(runs)))


def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
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
    r['x0'] = min(r['x0'], x)
    r['x1'] = max(r['x1'], x)
    r['y0'] = min(r['y0'], y0)
    r['y1'] = max(r['y1'], y1)
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
