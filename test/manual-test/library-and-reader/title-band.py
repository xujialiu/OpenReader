#!/usr/bin/env python3
"""Painted horizontal title-band analyser for the reader's navigation bar.

Asserts, from pixels alone (never accessibility frames or React props):
- the screen's modal colour is the expected page colour (a modal sheet's
  dimmer, or a wrongly staged theme, fails here instead of masquerading);
- the band behind the title holds the page colour with NO ink outside the
  title box (Back / More glass excluded by supplied x range);
- the band's colour has no fade/gradient ramp beyond the system material;
- the band ends at the native bar's own frame and the title sits inside it;
- with real document text scrolled to the boundary, ink starts right below it;
- optionally (with --rest-screenshot) the backing ends exactly where the
  page's reserved room starts at rest.

ALL geometry is supplied or measured for the runtime under test — nothing here
is a cross-runtime claim. Scale is derived from the screenshot width against
the native tree's Application width.

    python3 title-band.py SCREENSHOT TREE.json TITLE \
        --bar-frame 0,62,402,54 --band-x0 64 --band-x1 336 \
        --expect-page-rgb 255,255,255 [--rest-screenshot REST.png] [--report OUT]

`TREE.json` is an `axe describe-ui` JSON of the SAME screen. On iOS 26.5 /
iPhone 17 (qa366-phone) the measured bar is `RNSNavigationBar (0 62; 402 54)`;
other runtimes must pass their own measured frame. Exit 0 PASS, 1 FAIL,
69 BLOCKED. `--self-test` runs deterministic synthetic controls in-process.
"""
import argparse
import json
import math
import sys
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw


def _ax():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'kit'))
    import ax
    return ax


def heading_rect(tree, title):
    ax = _ax()
    nodes = [n for n, _, _ in ax.walk(tree)]
    width = ax.frame(next(n for n in nodes if n.get('type') == 'Application'))[2]
    titles = [n for n in nodes if n.get('type') == 'Heading' and n.get('AXLabel') == title]
    if not titles:
        raise ValueError('no Heading with the title text in the native tree')
    return ax.frame(min(titles, key=lambda n: ax.frame(n)[1])), width


def analyse(png_path, tree, title, bar_frame, band_x0, band_x1, expect_rgb,
            rest_path=None, report=None):
    bar_x, bar_y, bar_w, bar_h = bar_frame
    rep = {'outcome': 'BLOCKED', 'screenshot': str(png_path), 'title': title,
           'barFramePt': [bar_x, bar_y, bar_w, bar_h]}
    checks = {}
    try:
        (tx, ty, tw, th), win_w = heading_rect(json.loads(Path(tree).read_text()), title)
        rep['titleRectPt'] = [round(tx, 2), round(ty, 2), round(tw, 2), round(th, 2)]
        rep['windowWidthPt'] = win_w
        image = Image.open(png_path).convert('RGB')
        scale = image.width / win_w
        if not (0.5 <= scale <= 10.0):
            raise ValueError(f'implausible derived scale {scale}')
        rep['scale'] = round(scale, 4)
        px = image.load()
        w, h = image.size

        rest_image = None
        if rest_path is not None:
            rest_image = Image.open(rest_path).convert('RGB')
            if rest_image.size != image.size:
                raise ValueError(f'paired rest screenshot dimensions {rest_image.size} '
                                 f'differ from the analysed capture {image.size}')

        modal = Counter(px[x, y] for y in range(0, h, 7) for x in range(0, w, 7))
        page = modal.most_common(1)[0][0]
        rep['modalColourRGB'] = list(page)
        rep['expectedPageRGB'] = list(expect_rgb)
        checks['pageColourMatchesExpected'] = all(
            abs(page[i] - expect_rgb[i]) <= 10 for i in range(3))

        x0, x1 = int(band_x0 * scale), int(band_x1 * scale)
        tpx = (math.floor((tx - 1.5) * scale), math.floor((ty - 1.5) * scale),
               math.ceil((tx + tw + 1.5) * scale), math.ceil((ty + th + 1.5) * scale))

        def ink_distance(p):
            return abs(p[0] - page[0]) + abs(p[1] - page[1]) + abs(p[2] - page[2])

        rows = {}
        for y in range(int((bar_y - 20) * scale), min(int((bar_y + bar_h + 42) * scale), h)):
            n = 0
            for x in range(x0, x1):
                if tpx[0] <= x < tpx[2] and tpx[1] <= y < tpx[3]:
                    continue
                if ink_distance(px[x, y]) > 60:
                    n += 1
            rows[y] = n

        runs, start = [], None
        for y in sorted(rows):
            if rows[y] <= 3:
                start = y if start is None else start
            else:
                if start is not None:
                    runs.append((start, y - 1))
                    start = None
        if start is not None:
            runs.append((start, max(rows)))
        band = max(runs, key=lambda r: r[1] - r[0], default=None)
        if band is None:
            raise ValueError('no uniform band rows found behind the title')
        y0p, y1p = band[0] / scale, (band[1] + 1) / scale
        rep['bandPt'] = [round(y0p, 2), round(y1p, 2)]
        rep['bandHeightPt'] = round(y1p - bar_y, 2)
        rep['rowInkOutsideTitleMax'] = max(rows[y] for y in range(band[0], band[1] + 1))

        title_ink = sum(1 for y in range(tpx[1], tpx[3]) for x in range(tpx[0], tpx[2])
                        if ink_distance(px[x, y]) > 60)
        rep['titleInkPx'] = title_ink

        def row_mean(y):
            cols = [px[x, y] for x in range(x0, x1)
                    if not (tpx[0] <= x < tpx[2] and tpx[1] <= y < tpx[3])]
            n = len(cols)
            return tuple(sum(c[i] for c in cols) / n for i in range(3))

        mid = (band[0] + band[1]) // 2
        means = [row_mean(y) for y in range(band[0], band[1] + 1)]
        lum = [m[0] for m in means]
        rep['bandMeanRGB'] = [round(v, 1) for v in row_mean(mid)]
        rep['luminanceRampMax'] = round(max(lum) - min(lum), 2)
        rep['bandVsPageDistance'] = round(sum(abs(a - b) for a, b in zip(page, row_mean(mid))), 2)

        below_rows = [rows[y] for y in range(band[1] + 1,
                                             min(band[1] + 1 + int(30 * scale), max(rows) + 1))]
        below = max(below_rows, default=0)
        rep['maxRowInkWithin30ptBelowBand'] = below
        rep['titleBandCenterDeltaPt'] = round(abs(ty + th / 2 - (bar_y + y1p) / 2), 2)

        # The paint assertion is over the native bar's own frame: every row of
        # [bar_y, bar_y + bar_h] must hold the page colour outside the title
        # box. (The maximal clean run may extend past the bar bottom when the
        # first text line happens to sit lower — that is layout, not paint.)
        covered_rows = [y for y in range(int(bar_y * scale), int((bar_y + bar_h) * scale))
                        if y in rows]
        covered_bad = max((rows[y] for y in covered_rows), default=999)
        rep['maxRowInkInsideNativeBar'] = covered_bad
        checks.update({
            'titleInsideBand': bar_y <= ty + 1 and ty + th <= y1p + 2,
            'titleHasInk': title_ink >= 150,
            'bandCoversNativeBar': covered_bad <= 3 and len(covered_rows) >= int(bar_h * scale) - 2,
            'bandTopAtBarFrame': y0p <= bar_y + 2.0,
            'noInkOutsideTitleInBand': rep['rowInkOutsideTitleMax'] <= 3,
            'noFadeRamp': rep['luminanceRampMax'] <= 16.0,
            'bandIsPageColour': rep['bandVsPageDistance'] <= 24.0,
            'textReachesBoundary': below >= 8,
        })
        if rest_image is not None:
            rpx = rest_image.load()
            rmode = Counter(rpx[x, y] for y in range(0, rest_image.height, 7)
                            for x in range(0, rest_image.width, 7))
            rpage = rmode.most_common(1)[0][0]

            def r_ink_distance(p):
                return abs(p[0] - rpage[0]) + abs(p[1] - rpage[1]) + abs(p[2] - rpage[2])

            first = None
            # The rest reference must show the same chrome (title) state; its own
            # title glyphs (approximated by the analysed title box, extended to
            # cover descender/antialias bleed) are chrome, not page content, and
            # are excluded from the scan like the band ink.
            scan_from = max(bar_y, ty - 2)
            for y in range(int(scan_from * scale), min(int((bar_y + 240) * scale), rest_image.height)):
                n = 0
                for x in range(x0, x1):
                    if tpx[0] <= x < tpx[2]:
                        continue
                    if r_ink_distance(rpx[x, y]) > 60:
                        n += 1
                if n > 50:
                    first = y / scale
                    break
            rep['restContentTopPt'] = round(first, 2) if first is not None else None
            checks['backingEndsAtReservedRoom'] = (first is not None
                                                   and abs(first - y1p) <= 1.5)
    except (OSError, ValueError, StopIteration, KeyError) as error:
        rep['outcome'] = 'BLOCKED'
        rep['reason'] = str(error)
        if report:
            report = Path(report)
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(json.dumps(rep, indent=2))
        print(json.dumps(rep, indent=2))
        return rep, 69

    rep['checks'] = checks
    rep['outcome'] = 'PASS' if all(checks.values()) else 'FAIL'
    failed = [k for k, v in checks.items() if not v]
    if failed:
        rep['failedChecks'] = failed
    if report:
        report = Path(report)
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))
    return rep, {'PASS': 0, 'FAIL': 1, 'BLOCKED': 69}[rep['outcome']]


# --- synthetic self-test (deterministic, host-only) -------------------------

SCALE = 3
WIN_W, WIN_H = 402, 874
BAR = (0, 62, 402, 54)
BAND_X0, BAND_X1 = 64, 336
LIGHT = (255, 255, 255)
TITLE = 'Cradle - 01 (Will Wight)'
TITLE_BOX = (108.3, 73.7, 185.0, 20.7)  # x, y, w, h in pt


def _synthetic_tree():
    return {
        'type': 'Application', 'AXLabel': 'OpenReader',
        'frame': {'x': 0, 'y': 0, 'width': WIN_W, 'height': WIN_H},
        'children': [{'type': 'Heading', 'AXLabel': TITLE,
                      'frame': {'x': TITLE_BOX[0], 'y': TITLE_BOX[1],
                                'width': TITLE_BOX[2], 'height': TITLE_BOX[3]}}],
    }


def _synthetic_png(path, *, dimmer=False, band_leak=False):
    im = Image.new('RGB', (WIN_W * SCALE, WIN_H * SCALE), LIGHT)
    d = ImageDraw.Draw(im)
    if dimmer:
        im.paste((204, 204, 204), (0, 0, im.width, im.height))
    # Title ink inside the title box (a solid stand-in for glyphs).
    d.rectangle([TITLE_BOX[0] * SCALE, TITLE_BOX[1] * SCALE,
                 (TITLE_BOX[0] + TITLE_BOX[2]) * SCALE, (TITLE_BOX[1] + 8) * SCALE], fill=(20, 20, 20))
    if not dimmer and not band_leak:
        # A uniform page-colour band is implied by the background fill.
        pass
    if band_leak:
        # Document-text ink inside the band, outside the title box.
        d.rectangle([70 * SCALE, 90 * SCALE, 78 * SCALE, 110 * SCALE], fill=(60, 60, 60))
    # A body-text line right below the band (boundary at bar_y + bar_h = 116).
    d.rectangle([80 * SCALE, 118 * SCALE, 320 * SCALE, 126 * SCALE], fill=(30, 30, 30))
    im.save(path)


def self_test():
    outcomes = []

    def run_case(name, *, expect, dimmer=False, band_leak=False, tree=None,
                 bar_frame=BAR, expect_rgb=LIGHT, rest=None, want_exit):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            png = tmp / 'shot.png'
            _synthetic_png(png, dimmer=dimmer, band_leak=band_leak)
            tree_path = tmp / 'tree.json'
            tree_path.write_text(json.dumps(tree if tree is not None else _synthetic_tree()))
            rep, code = analyse(str(png), str(tree_path), TITLE, bar_frame,
                                BAND_X0, BAND_X1, expect_rgb, rest_path=rest)
        ok = rep['outcome'] == expect and code == want_exit
        outcomes.append((name, rep['outcome'], code, 'ok' if ok else 'MISMATCH'))
        return ok

    run_case('clean light band', expect='PASS', want_exit=0)
    run_case('ink inside band', expect='FAIL', band_leak=True, want_exit=1)
    run_case('dimmer rejected', expect='FAIL', dimmer=True, want_exit=1)
    run_case('missing heading', expect='BLOCKED',
             tree={'type': 'Application', 'AXLabel': 'OpenReader',
                   'frame': {'x': 0, 'y': 0, 'width': WIN_W, 'height': WIN_H}},
             want_exit=69)
    run_case('wrong expected colour', expect='FAIL',
             expect_rgb=(17, 17, 20), want_exit=1)
    run_case('wrong bar height', expect='FAIL',
             bar_frame=(0, 62, 402, 70), want_exit=1)
    for name, outcome, code, verdict in outcomes:
        print(f'self-test {name}: outcome={outcome} exit={code} {verdict}')
    all_ok = all(v == 'ok' for _, _, _, v in outcomes)
    print('SELF-TEST-OK' if all_ok else 'SELF-TEST-FAILED')
    return 0 if all_ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('screenshot', nargs='?')
    ap.add_argument('tree', nargs='?')
    ap.add_argument('title', nargs='?')
    ap.add_argument('--bar-frame',
                    help='measured native bar frame x,y,w,h in pt (no cross-runtime default)')
    ap.add_argument('--band-x0', type=float,
                    help='left edge of the ink scan, clear of the Back button glass (pt)')
    ap.add_argument('--band-x1', type=float,
                    help='right edge of the ink scan, clear of the More button glass (pt)')
    ap.add_argument('--expect-page-rgb',
                    help='the runtime page colour, e.g. 255,255,255 light / 17,17,20 dark')
    ap.add_argument('--rest-screenshot')
    ap.add_argument('--report')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())
    for required in (args.screenshot, args.tree, args.title):
        if not required:
            ap.error('screenshot, tree and title are required without --self-test')
    for opt in (args.bar_frame, args.band_x0, args.band_x1, args.expect_page_rgb):
        if opt is None:
            ap.error('--bar-frame, --band-x0, --band-x1 and --expect-page-rgb are required without --self-test')
    bar_frame = tuple(float(v) for v in args.bar_frame.split(','))
    if len(bar_frame) != 4:
        ap.error('--bar-frame wants x,y,w,h')
    expect_rgb = tuple(int(v) for v in args.expect_page_rgb.split(','))
    if len(expect_rgb) != 3:
        ap.error('--expect-page-rgb wants r,g,b')
    rep, code = analyse(args.screenshot, args.tree, args.title, bar_frame,
                        args.band_x0, args.band_x1, expect_rgb,
                        rest_path=args.rest_screenshot, report=args.report)
    sys.exit(code)


if __name__ == '__main__':
    main()
