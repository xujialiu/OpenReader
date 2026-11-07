#!/usr/bin/env python3
"""#354: paired, registered Appearance-open pixel measurement, not UI acceptance.

python3 duo-preview-compare.py BEFORE.png OPENED.png PAIR.json
PAIR has before/opened checkpoints and a shared pixel crop [x,y,width,height].
Each checkpoint: passageCFI, appearance, window, pose, region, paused,
appearanceOpen. Region is the SAME visible glyph/blank-background sample in
both images, documented by the tester. No automatic shifting/scaling, guessed
3x scale, OCR, or comparison of two already-open Drawers.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageOps


def compare_preview(before_path, opened_path, pair):
    before, opened = pair['before'], pair['opened']
    for field in ['passageCFI', 'appearance', 'window', 'pose', 'region']:
        if not before.get(field) or before[field] != opened.get(field):
            raise ValueError('Unmatched/missing checkpoint: ' + field)
    if before.get('paused') is not True or opened.get('paused') is not True:
        raise ValueError('Pause before the opening comparison; highlights must not advance')
    if before.get('appearanceOpen') is not False or opened.get('appearanceOpen') is not True:
        raise ValueError('Require a closed-to-open Appearance control, not two Drawer-open images')
    a = ImageOps.exif_transpose(Image.open(before_path)).convert('RGB')
    b = ImageOps.exif_transpose(Image.open(opened_path)).convert('RGB')
    if a.size != b.size:
        raise ValueError('Different active-display dimensions; register a same-pose pair first')
    if ImageChops.difference(a, b).getbbox() is None:
        raise ValueError('Whole images identical: no retained opening control')
    crop = pair['cropPixels']
    if len(crop) != 4 or any(type(n) is not int for n in crop):
        raise ValueError('cropPixels requires four integers, x y width height')
    x, y, width, height = crop
    if min(x, y) < 0 or min(width, height) <= 0 or x + width > a.width or y + height > a.height:
        raise ValueError('Crop outside the actual active-display image')
    box = (x, y, x + width, y + height)
    a, b = a.crop(box), b.crop(box)
    differences = ImageChops.difference(a, b)
    histogram = differences.histogram()
    pixels = width * height
    means = [sum(value * histogram[channel * 256 + value] for value in range(256)) / pixels for channel in range(3)]
    # Signed means distinguish darkening from lightening, not their cause.
    def channel_mean(image):
        counts = image.histogram()
        return [sum(value * counts[channel * 256 + value] for value in range(256)) / pixels for channel in range(3)]
    am, bm = channel_mean(a), channel_mean(b)
    red, green, blue = differences.split()
    maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    changed = pixels - maximum.histogram()[0]
    return {
        'status': 'PIXELS_IDENTICAL' if changed == 0 else 'PIXELS_DIFFER_REVIEW_REQUIRED',
        'cropPixels': crop, 'changedPixels': changed, 'totalPixels': pixels,
        'meanAbsoluteRGBDelta': means, 'signedMeanRGBDelta': [v - u for u, v in zip(am, bm)],
        'limit': 'Only the registered crop is measured. Review native images for actual glyph visibility, opening height, occlusion and a reversible font change. Metadata is a tester assertion, not independently proved by pixels.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('opened', type=Path)
    parser.add_argument('pair', type=Path)
    args = parser.parse_args()
    try:
        result = compare_preview(args.before, args.opened, json.loads(args.pair.read_text()))
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({'status': 'INVALID_CONTROL', 'error': str(error)}))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result['status'] == 'PIXELS_IDENTICAL' else 1


if __name__ == '__main__':
    raise SystemExit(main())
