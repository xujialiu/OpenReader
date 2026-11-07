#!/usr/bin/env python3
"""#350 fixture-local pixel assertion. No native operation; see the sibling recipe."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
from PIL import Image, ImageOps

CFI = 'epubcfi(/6/2!/4/4,/1:33,/1:37)'
# Actual painted first hope, not the Drawer query; originals stay outside Git.
REFERENCE_SHA256 = '7121fa7e13f6ef4c28b7f28e9362f6bd6fcd600ae7e1b7bc17bdaefa49141458'
REFERENCE_CROP = [84, 775, 144, 84]
BLUE = (204, 221, 237)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def numbers(value, count, positive=False):
    require(isinstance(value, list) and len(value) == count, 'Missing coordinate/size array')
    require(all(type(n) in (int, float) and math.isfinite(n) and (n > 0 if positive else n >= 0)
                for n in value), 'Coordinates/sizes must be finite and nonnegative (sizes positive)')
    return value


def read_json(path):
    return json.loads(Path(path).read_text().removeprefix('PROBE '))


def image(path):
    with Image.open(path) as raw:
        orientation = raw.getexif().get(274, 1)
        require(orientation in range(1, 9), 'Invalid EXIF orientation')
        require('A' not in raw.getbands() or raw.getchannel('A').getextrema() == (255, 255),
                'Transparent active image is not a painted control')
        return ImageOps.exif_transpose(raw).convert('RGB'), orientation


def crop(im, rect):
    x, y, w, h = numbers(rect, 4)
    require(all(int(n) == n for n in rect) and w > 0 and h > 0 and
            x + w <= im.width and y + h <= im.height, 'Crop outside oriented image or not integer pixels')
    return im.crop((int(x), int(y), int(x + w), int(y + h)))


def pixels(im):
    return list(im.get_flattened_data())


def ink(im):
    return {(i % im.width, i // im.width) for i, p in enumerate(pixels(im)) if max(p) < 100}


def blue(p):
    return max(abs(p[i] - BLUE[i]) for i in range(3)) <= 12


def paint(im, reference):
    require(im.size == reference.size, 'Different glyph raster size; no scaling/warping allowed')
    expected, actual = ink(reference), ink(im)
    require(len(expected) >= 20 and .02 < len(expected) / (im.width * im.height) < .35,
            'Reference lacks useful word glyphs')
    # At most one oriented pixel of rounding; no OCR, search, resize or arbitrary registration.
    best = max((len(actual & shifted) / len(actual | shifted), dx, dy)
               for dx in (-1, 0, 1) for dy in (-1, 0, 1)
               for shifted in [{(x + dx, y + dy) for x, y in expected}])
    require(best[0] >= .94, 'Wrong/missing/moved/occluded hope glyphs')
    dx, dy = best[1:]
    mask = [(x + dx, y + dy) for y in range(reference.height) for x in range(reference.width)
            if blue(reference.getpixel((x, y))) and 0 <= x + dx < im.width and 0 <= y + dy < im.height]
    require(len(mask) / (im.width * im.height) > .55, 'Reference lacks a calibrated painted band')
    blue_share = sum(blue(im.getpixel(p)) for p in mask) / len(mask)
    white_share = sum(min(im.getpixel(p)) >= 245 for p in mask) / len(mask)
    require(blue_share >= .995 or (blue_share <= .005 and white_share >= .995),
            'Ambiguous/partial paint or occlusion; not an app failure')
    return {'paint': 'painted' if blue_share >= .995 else 'unpainted',
            'glyphIoU': round(best[0], 6), 'roundingPixels': [dx, dy],
            'blueShare': round(blue_share, 6), 'whiteShare': round(white_share, 6)}


def checkpoint(c, root, reference):
    im, exif = image(root / c['image'])
    w, h = numbers(c['nativeWindow'], 2, True)
    require(numbers(c['imagePixels'], 2, True) == list(im.size), 'Actual active image dimensions mismatch')
    scale = numbers([c['scale']], 1, True)[0]
    require(abs(w * scale - im.width) <= 1 and abs(h * scale - im.height) <= 1,
            'Measured window/image scale mismatch')
    require(c['orientation'] == ('portrait' if h > w else 'landscape') and c['exifOrientation'] == exif,
            'Native or EXIF orientation mismatch')
    require(type(c['activeDisplay']) is int and c['activeDisplay'] in (1, 3) and
            type(c['captureDisplay']) is int and c['captureDisplay'] == c['activeDisplay'], 'Wrong/missing active display')
    require(c['domOrigin'] == 'reader-viewport' and isinstance(c['mappingEvidence'], str) and
            c['mappingEvidence'].strip() and isinstance(c['windowEvidence'], str) and c['windowEvidence'].strip(),
            'Require independently qualified native window and reader-viewport mapping')
    ox, oy = numbers(c['webViewOffset'], 2)
    selection = read_json(root / c['selection'])
    require(len(selection['ranges']) == 1, 'Require one selected range')
    r = selection['ranges'][0]
    require(r['cfi'] == CFI and r['text'] == 'hope' and r['section'] == 0 and
            r['start'] == 33 and r['end'] == 37 and type(r['backward']) is bool and
            [r['anchor'], r['focus']] == ([37, 33] if r['backward'] else [33, 37]), 'Wrong/missing fixture range')
    require(r['rectCount'] == 1 and len(r['rects']) == 1, 'Require one exposed word rect')
    vx, vy = numbers(selection['viewport'], 2, True)
    x, y, rw, rh = numbers(r['rects'][0], 4)
    require(rw > 0 and rh > 0 and x + rw <= vx and y + rh <= vy and ox + vx <= w and oy + vy <= h,
            'DOM rect/viewport outside measured native WebView mapping')
    expected_crop = [(x + ox) * scale, (y + oy) * scale, rw * scale, rh * scale]
    roi = crop(im, c['cropPixels'])
    blank = crop(im, c['blankPixels'])
    require(blank.width * blank.height >= 100 and sum(min(p) >= 245 for p in pixels(blank)) /
            (blank.width * blank.height) >= .99, 'Adjacent blank Document control is not white/unobscured')
    bx, by, bw, _ = c['blankPixels']; cx, cy, cw, _ = c['cropPixels']
    require(bx >= cx + cw and bx + bw <= cx + cw + 100 * scale and abs(by - cy) <= scale,
            'Blank control must be adjacent to the same word band')
    require(all(abs(a - b) <= 1 for a, b in zip(c['cropPixels'], expected_crop)), 'Crop/mapping mismatch')
    state = read_json(root / c['lookup']); state = state.get('value', state)
    require(state['gate'] is None and state['loading'] is False and state['error'] is None and
            state['selection']['text'] == 'hope' and state['selection']['mode'] == 'dictionary' and
            type(state['selection']['attempt']) is int and state['selection']['attempt'] >= 0 and
            state['selection']['selecting'] is False and isinstance(state['result']['text'], str) and
            state['result']['text'].strip() and state['result']['source'] and
            state['traffic']['installed'] is True, 'Missing normal lookup/result/traffic control')
    requests = state['traffic']['requests']
    require(len(requests) == 1 and requests[0]['status'] == 200 and requests[0]['abortedAt'] is None and
            requests[0]['failedAt'] is None, 'Require exactly one successful, non-aborted lookup')
    numbers([selection['at'], state['observedAt'], requests[0]['startedAt'], requests[0]['responseAt']], 4, True)
    require(requests[0]['startedAt'] <= requests[0]['responseAt'] <= state['observedAt'] and
            selection['at'] <= state['observedAt'], 'Invalid receipt time ordering')
    identity = {key: r[key] for key in ('cfi', 'text', 'section', 'start', 'end', 'anchor', 'focus', 'backward')}
    control = [identity, state['selection'], state['result'], requests]
    return paint(roi, reference), control, selection['at'], hashlib.sha256((root / c['image']).read_bytes()).hexdigest()


def compare(pair, root, baseline_only=False):
    require(pair['kind'] in ('host-synthetic', 'host-replay', 'native'), 'Invalid evidence kind')
    ref = pair['reference']; ref_path = root / ref['image']
    ref_hash = hashlib.sha256(ref_path.read_bytes()).hexdigest()
    if pair['kind'] != 'host-synthetic':
        require(ref_hash == REFERENCE_SHA256 and ref['cropPixels'] == REFERENCE_CROP,
                'Reference must be the qualified actual painted first hope capture')
    reference = crop(image(ref_path)[0], ref['cropPixels'])
    require(paint(reference, reference)['paint'] == 'painted', 'Invalid painted reference')
    before, bc, bt, bh = checkpoint(pair['before'], root, reference)
    require(before['paint'] == 'painted', 'Before control is not painted')
    prefix = 'NATIVE' if pair['kind'] == 'native' else 'HOST'
    if baseline_only:
        return {'status': prefix + '_PAINTED_BASELINE_ONLY', 'before': before,
                'sha256': {'reference': ref_hash, 'before': bh}, 'limit': 'Baseline only; NOT fold acceptance.'}
    after, ac, at, ah = checkpoint(pair['after'], root, reference)
    require(bc == ac and at > bt, 'Range/direction/task/result/traffic changed or stale after receipt')
    require(max(abs(a - b) for a, b in zip(pair['before']['nativeWindow'], pair['after']['nativeWindow'])) > 1,
            'No actual native window change beyond rounding')
    require(pair['before']['activeDisplay'] != pair['after']['activeDisplay'], 'No D1/D3 fold transition')
    return {'status': prefix + ('_PAINT_PRESERVED' if after['paint'] == 'painted' else '_PAINT_LOST'),
            'kind': pair['kind'], 'before': before, 'after': after,
            'sha256': {'reference': ref_hash, 'before': bh, 'after': ah},
            'limit': 'Metadata requires raw native calibration/receipts; pixels do not prove handles or gesture usability.'}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def main():
    try:
        parser = Parser(description=__doc__)
        parser.add_argument('pair', type=Path)
        parser.add_argument('--expect', required=True, choices=['painted'])
        parser.add_argument('--baseline-only', action='store_true', help='Before-fold control only, never acceptance')
        args = parser.parse_args()
        result = compare(read_json(args.pair), args.pair.parent, args.baseline_only)
        print(json.dumps(result, allow_nan=False))
        return 0 if args.baseline_only or result['after']['paint'] == 'painted' else 1
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, OverflowError, OSError) as error:
        print(json.dumps({'status': 'BLOCKED', 'reason': str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
