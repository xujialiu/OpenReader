#!/usr/bin/env python3
"""#69: what colour is the sentence/word `::highlight()` painted on screen, and
is the word's own text light (dark theme) or dark (light theme)?

    python3 test/manual-test/highlight-colour.py dark|light SCREENSHOT.png...

Dark is checked against exact, opaque values (`themeCss`'s own constants):
sentence `#434665`, word `#4456de`, page `#111114`, text `#e6e6ea` — tolerance
3 per channel, since the rules declare flat colours with no alpha. Light's
highlight is translucent (`rgba(255,196,0,0.22)` / `rgba(255,168,0,0.62)` over
whatever the page underneath is), so it is found by a looser warm-amber
heuristic instead (R notably above B, both above the neutral page/text tones)
and reported rather than asserted to an exact hex.

For each theme, reports each highlight colour's bounding box (a fill ratio
near 1.0 inside it is a solid rectangle, not scattered false matches) and
samples a handful of pixels strictly inside the WORD box that do not match the
box colour itself — the letters — printing their mean colour so it can be read
off as "light" or "dark" by eye against the two page constants also printed.

This is a read-only measurement; it draws no conclusion beyond the numbers.
"""
import sys
import numpy as np
from PIL import Image

DARK = {
    'word': (0x44, 0x56, 0xDE),
    'sentence': (0x43, 0x46, 0x65),
    'page': (0x11, 0x11, 0x14),
    'text': (0xE6, 0xE6, 0xEA),
}
TOL = 3


def mask_exact(px, colour, tol=TOL):
    return np.abs(px.astype(int) - np.array(colour)).max(axis=2) <= tol


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    area = (x1 - x0 + 1) * (y1 - y0 + 1)
    fill = mask[y0:y1 + 1, x0:x1 + 1].sum() / area
    return x0, y0, x1, y1, int(mask.sum()), fill


def sample_letters(px, box, box_colour, tol=TOL):
    x0, y0, x1, y1, _, _ = box
    region = px[y0:y1 + 1, x0:x1 + 1]
    not_box = ~mask_exact(region, box_colour, tol)
    ys, xs = np.nonzero(not_box)
    if len(xs) == 0:
        return None
    pts = region[ys, xs]
    return tuple(int(v) for v in pts.mean(axis=0)), len(xs)


def report_dark(path):
    px = np.asarray(Image.open(path).convert('RGB'))
    print(f'{path}: {px.shape[1]}x{px.shape[0]}')
    boxes = {}
    for name in ('sentence', 'word'):
        b = bbox(mask_exact(px, DARK[name]))
        boxes[name] = b
        if b is None:
            print(f'  {name} {DARK[name]}: NOT FOUND')
        else:
            x0, y0, x1, y1, n, fill = b
            print(f'  {name} rgb{DARK[name]}: bbox=({x0},{y0})-({x1},{y1}) {x1-x0+1}x{y1-y0+1} pixels={n} fill={fill:.2f}')
    word = boxes.get('word')
    if word:
        letters, n = sample_letters(px, word, DARK['word']) or (None, 0)
        print(f'  letters inside the word box (n={n}): mean rgb={letters}')
        print(f'  for reference: DARK_TEXT=rgb{DARK["text"]} (expected, light) DARK_PAGE=rgb{DARK["page"]} (not expected here)')
    # A plain, unhighlighted page pixel and a plain text pixel, sampled well
    # away from any highlight, to confirm the rest of the page is unaffected.
    page_mask = mask_exact(px, DARK['page'])
    pb = bbox(page_mask)
    if pb:
        print(f'  page background rgb{DARK["page"]}: pixels={pb[4]} fill(bbox)={pb[5]:.2f} (a big, mostly-solid area is expected: most of the page)')


AMBER_LO = np.array([150, 60, 0])
AMBER_HI = np.array([255, 230, 190])


def report_light(path):
    px = np.asarray(Image.open(path).convert('RGB')).astype(int)
    print(f'{path}: {px.shape[1]}x{px.shape[0]}')
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    warm = (r > 190) & (r - b > 40) & (g > 120) & (b < 210)
    bbx = bbox(warm)
    if not bbx:
        print('  No amber-ish region found')
        return
    x0, y0, x1, y1, n, fill = bbx
    print(f'  amber-ish region: bbox=({x0},{y0})-({x1},{y1}) {x1-x0+1}x{y1-y0+1} pixels={n} fill={fill:.2f}')
    # Centre pixel and a small neighbourhood, plus the letters (non-warm
    # pixels strictly inside the box).
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    print(f'  centre pixel rgb={tuple(px[cy, cx])}')
    region = px[y0:y1 + 1, x0:x1 + 1]
    rr, gg, bb = region[..., 0], region[..., 1], region[..., 2]
    not_warm = ~((rr > 190) & (rr - bb > 40) & (gg > 120) & (bb < 210))
    ys, xs = np.nonzero(not_warm)
    if len(xs):
        letters = tuple(int(v) for v in region[ys, xs].mean(axis=0))
        print(f'  letters inside that box (n={len(xs)}): mean rgb={letters} (expected dark/near-black)')


def main():
    theme, paths = sys.argv[1], sys.argv[2:]
    if theme not in ('dark', 'light') or not paths:
        print(__doc__, file=sys.stderr)
        return 64
    for path in paths:
        (report_dark if theme == 'dark' else report_light)(path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
