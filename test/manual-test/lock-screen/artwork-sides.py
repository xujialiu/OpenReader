#!/usr/bin/env python3
# Sample the Now Playing artwork's square on a LockScreenProbe screenshot (#119):
# where the picture sits inside the square, and what colour the side bands are —
# the question "does iOS draw a tall Cover's transparent sides as transparent,
# black, white, or its own material" is answered from these numbers.
#
#   python3 test/manual-test/lock-screen/artwork-sides.py SCREENSHOT.png [--json]
#
# SCREENSHOT.png is the lock-screen_N attachment a `run-probe.sh LockScreenProbe
# … --expect-player` run exports (the script finds the card itself; it takes no
# geometry). The screenshot is 3× (1206×2622 on the 402×874 pt devices).
#
# What it does: scans rows for the artwork square (the large, near-uniform,
# lighter-than-wallpaper rounded rect in the upper half), measures the drawn
# picture's strip inside it by scanning a row where the picture is darker than
# the side bands, then samples the left band, the right band and the picture.
# Prints each sample's RGB and a short reading (band vs wallpaper, vs white,
# vs black, vs the picture).
#
# What it cannot prove: that the bands are *transparent* rather than an opaque
# colour that happens to match the system's artwork material. Transparent is
# established by the bands matching the material that sits behind the artwork
# (light grey in light mode) and differing from the wallpaper beside the card;
# the distinction between "transparent over a material" and "painted with the
# material's colour" is iOS's own compositing, which a screenshot cannot see.
# A pure-white or pure-black Cover would also defeat the strip detection: check
# the printed strip bounds against the screenshot before trusting the numbers.
#
# Since #119c the tall Cover sits on an OPAQUE BLACK square, so the bands read
# near-black and the light-band path above cannot see them. First answer, then:
# two near-black column clusters (the bands) with a mostly non-black middle (the
# drawn picture) between them. The script reports the bands, the picture strip's
# aspect and the wallpaper beside the card. It cannot distinguish an opaque black
# fill from transparency onto a black surface — that is decided by the wallpaper
# beside the card NOT being black, which it prints. A black Cover defeats the
# middle-picture test and falls through to the older paths, which then fail
# honestly (2026-10-01, #119c).
#
# A SQUARE artwork (the #119 icon case) has no strip to isolate: when no row
# yields two light runs, the script checks the square's left and right edge
# columns instead — if they are light on (almost) every row, the artwork's own
# background fills the square edge to edge and the answer is "no side bands",
# with the four corners' colours sampled (2026-10-01, #119b).

import argparse
import json
import sys

from PIL import Image

THIRD = 3  # screenshots are 3×


def row_light_edges(im, y, thresh=400, step=2):
    """x positions where a row crosses the light/dark threshold."""
    w = im.size[0]
    out, prev = [], None
    for x in range(0, w, step):
        p = im.getpixel((x, y))
        light = sum(p[:3]) > thresh
        if prev is not None and light != prev:
            out.append(x)
        prev = light
    return out


def dominant(im, box):
    """Median colour of a box, per channel."""
    raw = im.crop(box).tobytes()
    px = sorted((raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 3))
    return px[len(px) // 2]


def black(p):
    """Near-black: every channel under 30."""
    return p[0] < 30 and p[1] < 30 and p[2] < 30


def black_band_square(im, w, h):
    """A tall picture centred on an opaque black square (#119c): two near-black
    column clusters — the bands — with a mostly non-black middle between them.
    Returns (left, right, top, bottom, strip_l, strip_r, left_band, right_band)
    or None. The corner radius keeps a band column off-black on the rounded
    corners, so the cluster test wants 75% black rows, not all."""
    y0, y1 = int(h * 0.22), int(h * 0.68)
    step = 6
    rows = range(y0, y1, step)
    n = len(rows)
    cols = [x for x in range(0, w, 2)
            if sum(1 for y in rows if black(im.getpixel((x, y)))) >= n * 0.75]
    if not cols:
        return None
    clusters = []
    for x in cols:
        if clusters and x - clusters[-1][-1] <= 8:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    big = [c for c in clusters if len(c) >= 30]
    if len(big) < 2:
        return None
    left_band, right_band = big[0], big[-1]
    left, right = left_band[0], right_band[-1]
    if right - left < w * 0.6:
        return None
    mx0, mx1 = left_band[-1] + 20, right_band[0] - 20
    if mx1 - mx0 < w * 0.3:
        return None
    total = mid_dark = 0
    for y in rows:
        for x in range(mx0, mx1, 8):
            total += 1
            if black(im.getpixel((x, y))):
                mid_dark += 1
    if mid_dark * 100 > total * 40:
        return None
    band_x = (left_band[0] + left_band[-1]) // 2
    y_mid = (y0 + y1) // 2
    top = y_mid
    while top > 0 and black(im.getpixel((band_x, top - 1))):
        top -= 2
    bottom = y_mid
    while bottom < h - 1 and black(im.getpixel((band_x, bottom + 1))):
        bottom += 2
    side = bottom - top
    if side < w * 0.5:
        return None
    ym = (top + bottom) // 2
    row = [im.getpixel((x, ym)) for x in range(left, right)]
    nz = [i for i, p in enumerate(row) if not black(p)]
    if not nz:
        return None
    return left, right, top, bottom, left + nz[0], left + nz[-1], left_band, right_band


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('screenshot')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    im = Image.open(args.screenshot).convert('RGB')
    w, h = im.size

    # The opaque black square first (#119c): with black bands the light-run
    # square finder below would take the drawn picture for the square.
    bb = black_band_square(im, w, h)
    if bb is not None:
        left, right, top, bottom, strip_l, strip_r, left_band, right_band = bb
        side = bottom - top
        ym = (top + bottom) // 2
        band = max(4 * THIRD, (left_band[-1] - left_band[0]) // 4)
        samples = {
            'square': {'left': left, 'right': right, 'top': top, 'bottom': bottom, 'side_px': side},
            'picture_strip': {'left': strip_l, 'right': strip_r,
                              'aspect': round((strip_r - strip_l) / side, 4),
                              'gap_left': strip_l - left, 'gap_right': right - strip_r},
            'left_band': dominant(im, (left_band[0] + band, top + side // 3, strip_l - band, bottom - side // 3)),
            'right_band': dominant(im, (strip_r + band, top + side // 3, right_band[-1] - band, bottom - side // 3)),
            'picture': dominant(im, (strip_l + band, top + side // 3, strip_r - band, bottom - side // 3)),
            'wallpaper_left_of_card': dominant(im, (max(0, left - 12 * THIRD), top + side // 3, left - 2 * THIRD, bottom - side // 3)),
        }
        lr = tuple((a + b) // 2 for a, b in zip(samples['left_band'], samples['right_band']))
        wp = samples['wallpaper_left_of_card']
        samples['reading'] = (
            f'opaque black square: bands {lr} (median of each band\'s middle third), picture strip aspect '
            f'{samples["picture_strip"]["aspect"]} (gaps {samples["picture_strip"]["gap_left"]}/'
            f'{samples["picture_strip"]["gap_right"]} px); wallpaper beside the card {wp} — '
            f'not black, so the bands are the artwork\'s own black fill, not the wallpaper '
            f'and not a material showing through'
        )
        if args.json:
            print(json.dumps(samples, indent=1))
        else:
            for k in ('square', 'picture_strip', 'left_band', 'right_band', 'picture',
                      'wallpaper_left_of_card', 'reading'):
                print(f'{k}: {samples[k]}')
        return 0

    # The artwork square: scan candidate rows in the upper-middle of the screen
    # for the longest run of "light" bounded left and right by darker wallpaper.
    best = None
    for y in range(int(h * 0.2), int(h * 0.65), 8):
        edges = row_light_edges(im, y)
        for i in range(0, len(edges) - 1, 2):
            left, right = edges[i], edges[i + 1]
            span = right - left
            if span > w * 0.6 and (best is None or span > best[2]):
                best = (y, left, span, right)
    if best is None:
        print('no artwork square found — is this a lock screen with a card?')
        return 1
    y_mid, left, span, right = best
    # Walk the square's vertical extent from the middle row, at a column over
    # the **side band** (a sixteenth of the span in from the card's left edge —
    # a 3:4 cover's band is 12.5 % wide, and anything deeper lands on the
    # picture): the centre column is the drawn picture, which can be dark
    # anywhere. A square artwork has no bands and the walk stops at its own
    # first dark pixel — the strip isolation then fails below, which is honest:
    # a square artwork has no side-band question.
    band_x = left + max(2 * THIRD, span // 16)
    top = y_mid
    while top > 0 and sum(im.getpixel((band_x, top - 1))) > 400:
        top -= 2
    bottom = y_mid
    while bottom < h - 1 and sum(im.getpixel((band_x, bottom + 1))) > 400:
        bottom += 2
    side = bottom - top

    # The drawn picture's strip: a row in the lower half (covers usually put
    # dark art low) where the picture is darker than the side bands: exactly two
    # light runs inside the square (the bands), and the dark gap between them is
    # the picture.
    strip_l = strip_r = None
    for y in range(top + side // 2, bottom - 8, 4):
        e = row_light_edges(im, y, thresh=400)
        runs = [(e[i], e[i + 1]) for i in range(0, len(e) - 1, 2)
                if e[i] >= left - 4 and e[i + 1] <= right + 4]
        if len(runs) == 2:
            l, r = runs[0][1], runs[1][0]
            if 0.3 < (r - l) / span < 0.95:
                strip_l, strip_r = l, r
                break
    if strip_l is None:
        # No two-runs row anywhere: a square artwork fills the square with its
        # own background. The edge columns decide: light on every row means the
        # artwork itself reaches the edges — no side bands to question. The row
        # range starts one corner radius in (side // 20): inside the rounded
        # corners the edge columns read the wallpaper, not the artwork.
        e1 = left + max(2 * THIRD, span // 128)
        e2 = right - max(2 * THIRD, span // 128)
        rows = range(top + max(THIRD, side // 20), bottom - max(THIRD, side // 20), 2)
        light_rows = sum(
            1 for y in rows
            if sum(im.getpixel((e1, y))) > 400 and sum(im.getpixel((e2, y))) > 400
        )
        if light_rows * 100 < len(rows) * 99:
            print('could not isolate the drawn picture inside the square — is the artwork itself light?')
            return 1
        inset = max(2 * THIRD, side // 25)
        corners = {
            'top_left': dominant(im, (left + inset, top + inset, left + 3 * inset, top + 3 * inset)),
            'top_right': dominant(im, (right - 3 * inset, top + inset, right - inset, top + 3 * inset)),
            'bottom_left': dominant(im, (left + inset, bottom - 3 * inset, left + 3 * inset, bottom - inset)),
            'bottom_right': dominant(im, (right - 3 * inset, bottom - 3 * inset, right - inset, bottom - inset)),
        }
        samples = {
            'square': {'left': left, 'right': right, 'top': top, 'bottom': bottom, 'side_px': side},
            'corners': corners,
            'reading': (
                f'square artwork fills the square (side {side}px, edge columns light on '
                f'{light_rows}/{len(rows)} rows): no side bands; '
                f'corners {corners}'
            ),
        }
        if args.json:
            print(json.dumps(samples, indent=1))
        else:
            for k in ('square', 'corners', 'reading'):
                print(f'{k}: {samples[k]}')
        return 0

    band = max(4 * THIRD, (strip_l - left) // 3)
    samples = {
        'square': {'left': left, 'right': right, 'top': top, 'bottom': bottom, 'side_px': side},
        'picture_strip': {'left': strip_l, 'right': strip_r,
                          'aspect': round((strip_r - strip_l) / side, 4)},
        'left_band': dominant(im, (left + band, top + side // 3, strip_l - band, bottom - side // 3)),
        'right_band': dominant(im, (strip_r + band, top + side // 3, right - band, bottom - side // 3)),
        'picture': dominant(im, (strip_l + band, top + side // 3, strip_r - band, bottom - side // 3)),
        'wallpaper_left_of_card': dominant(im, (max(0, left - 12 * THIRD), top + side // 3, left - 2 * THIRD, bottom - side // 3)),
    }
    lr = tuple((a + b) // 2 for a, b in zip(samples['left_band'], samples['right_band']))
    samples['bands_mean_rgb'] = lr
    wp = samples['wallpaper_left_of_card']
    neutral = max(lr) - min(lr) <= 4
    samples['reading'] = (
        f"bands {'neutral ' if neutral else ''}{lr}; wallpaper beside the card {wp}; "
        f"bands are {'much lighter than the wallpaper (a system material shows through, not the wallpaper)' if sum(lr) > sum(wp) + 120 else 'close to the wallpaper (transparency may reach it)'}; "
        f"pure white is (255,255,255), the island's black (0,0,0)"
    )

    if args.json:
        print(json.dumps(samples, indent=1))
    else:
        for k in ('square', 'picture_strip', 'left_band', 'right_band', 'picture',
                  'wallpaper_left_of_card', 'bands_mean_rgb', 'reading'):
            print(f'{k}: {samples[k]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
