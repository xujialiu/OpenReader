#!/usr/bin/env python3
"""Opacity control for the reader's painted horizontal title band.

Compares two screenshots of the SAME bar at the SAME scroll position taken with
DIFFERENT real document text hidden behind it. An opaque page-colour background
leaves only the system material's uniform shimmer; even a faintly translucent
background would show the hidden glyph shapes as structured differences. The
region below the band (where the visible text differs by design) is the control
that proves the comparator works.

    python3 title-opacity-diff.py A.png B.png \
        --bar-frame 0,62,402,54 --window-width-pt 402 \
        [--band-x0 64 --band-x1 336] [--report OUT]

Paired images must share dimensions (BLOCKED otherwise). Scale derives from the
PNG width against --window-width-pt. Exit 0 OPAQUE, 1 STRUCTURE-FOUND,
69 BLOCKED. `--self-test` runs deterministic synthetic controls in-process.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


def diff_band(a_path, b_path, bar_frame, window_w_pt, band_x0=64.0, band_x1=336.0,
              report=None):
    bx, by, bw, bh = bar_frame
    out = {'a': str(a_path), 'b': str(b_path),
           'barFramePt': [bx, by, bw, bh]}
    code = 69
    try:
        ia = Image.open(a_path).convert('L')
        ib = Image.open(b_path).convert('L')
        if ia.size != ib.size:
            raise ValueError(f'paired image dimensions differ: {ia.size} vs {ib.size}')
        scale = ia.width / window_w_pt
        if not (0.5 <= scale <= 10.0):
            raise ValueError(f'implausible derived scale {scale}')
        out['scale'] = round(scale, 4)
        pa, pb = ia.load(), ib.load()
        y0 = int(by * scale)
        y1 = int((by + bh) * scale)
        x0, x1 = int(band_x0 * scale), int(band_x1 * scale)
        mx = tot = n = structured = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                d = abs(pa[x, y] - pb[x, y])
                tot += d
                n += 1
                mx = max(mx, d)
                if d > 16:
                    structured += 1
        below_mx = 0
        for y in range(y1, min(y1 + int(34 * scale), ia.height)):
            for x in range(x0, x1):
                below_mx = max(below_mx, abs(pa[x, y] - pb[x, y]))
        out.update({'bandMaxDiff': mx, 'bandMeanDiff': round(tot / n, 3),
                    'bandStructuredPixels': structured, 'belowBandMaxDiff': below_mx})
        if structured == 0 and mx <= 16:
            if below_mx > 16:
                out['outcome'] = 'OPAQUE'
                code = 0
            else:
                # The comparator is not proven on this pair: the visible page below
                # the band did not differ, so a clean band proves nothing.
                out['outcome'] = 'BLOCKED'
                out['reason'] = 'comparator unproven: below-band region shows no difference'
        else:
            out['outcome'] = 'STRUCTURE-FOUND'
            code = 1
    except (OSError, ValueError) as error:
        out['outcome'] = 'BLOCKED'
        out['reason'] = str(error)
    if report:
        report = Path(report)
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    return out, code


SCALE = 3
WIN_W = 402
BAR = (0, 62, 402, 54)


def _shot(path, band_extra=None, below_shift=0, size=(WIN_W * SCALE, 874 * SCALE)):
    im = Image.new('L', size, 255)
    d = ImageDraw.Draw(im)
    # A text line below the band (moves between captures by default).
    d.rectangle([80 * SCALE, 120 * SCALE + below_shift, 320 * SCALE, 128 * SCALE + below_shift], fill=20)
    # Hidden content behind the band (differs between the pair when translucent).
    if band_extra:
        d.rectangle([90 * SCALE, 70 * SCALE, 100 * SCALE, 112 * SCALE], fill=40)
    im.save(path)


def self_test():
    outcomes = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        a = tmp / 'a.png'
        _shot(a)
        b_clean = tmp / 'b-clean.png'
        _shot(b_clean, below_shift=6)
        b_leak = tmp / 'b-leak.png'
        _shot(b_leak, band_extra=True, below_shift=6)
        b_same = tmp / 'b-same.png'
        _shot(b_same)
        small = tmp / 'small.png'
        _shot(small, size=(300, 400))

        rep, code = diff_band(a, b_clean, BAR, WIN_W)
        outcomes.append(('clean pair', rep['outcome'], code,
                         'ok' if rep['outcome'] == 'OPAQUE' and code == 0 else 'MISMATCH'))
        rep, code = diff_band(a, b_leak, BAR, WIN_W)
        outcomes.append(('hidden structure', rep['outcome'], code,
                         'ok' if rep['outcome'] == 'STRUCTURE-FOUND' and code == 1 else 'MISMATCH'))
        rep, code = diff_band(a, b_same, BAR, WIN_W)
        outcomes.append(('unproven pair', rep['outcome'], code,
                         'ok' if rep['outcome'] == 'BLOCKED' and code == 69 else 'MISMATCH'))
        rep, code = diff_band(a, small, BAR, WIN_W)
        outcomes.append(('dimension mismatch', rep['outcome'], code,
                         'ok' if rep['outcome'] == 'BLOCKED' and code == 69 else 'MISMATCH'))
    for name, outcome, code, verdict in outcomes:
        print(f'self-test {name}: outcome={outcome} exit={code} {verdict}')
    all_ok = all(v == 'ok' for _, _, _, v in outcomes)
    print('SELF-TEST-OK' if all_ok else 'SELF-TEST-FAILED')
    return 0 if all_ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('a', nargs='?')
    ap.add_argument('b', nargs='?')
    ap.add_argument('--bar-frame',
                    help='measured native bar frame x,y,w,h in pt')
    ap.add_argument('--window-width-pt', type=float,
                    help='native window width in pt; scale derives from the PNG width')
    ap.add_argument('--band-x0', type=float, default=64.0)
    ap.add_argument('--band-x1', type=float, default=336.0)
    ap.add_argument('--report')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())
    if not (args.a and args.b):
        ap.error('two screenshots are required without --self-test')
    if not (args.bar_frame and args.window_width_pt):
        ap.error('--bar-frame and --window-width-pt are required without --self-test')
    bar_frame = tuple(float(v) for v in args.bar_frame.split(','))
    if len(bar_frame) != 4:
        ap.error('--bar-frame wants x,y,w,h')
    _, code = diff_band(args.a, args.b, bar_frame, args.window_width_pt,
                        args.band_x0, args.band_x1, args.report)
    sys.exit(code)


if __name__ == '__main__':
    main()
