#!/usr/bin/env python3
"""HOST controls only; fake pixels/metadata never certify a native fold."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
TOOL = Path(__file__).with_name('duo-selection-paint.py')
SPEC = importlib.util.spec_from_file_location('duo_selection_paint', TOOL)
PAINT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PAINT)


class DuoSelectionPaintTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='duo-selection-paint-host-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        image = Image.new('RGB', (160, 120), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 30, 69, 59), fill=(204, 221, 237))
        draw.text((15, 35), 'hope', fill='black')
        image.save(self.root / 'positive.png')
        image.save(self.root / 'before.png')
        after = Image.new('RGB', (220, 120), 'white')
        after.paste(image.crop((10, 30, 70, 60)), (50, 30))
        after.save(self.root / 'after.png')
        selection = {'at': 1, 'viewport': [160, 120], 'ranges': [{
            'section': 0, 'text': 'hope', 'cfi': PAINT.CFI, 'start': 33, 'end': 37,
            'anchor': 33, 'focus': 37, 'backward': False, 'rects': [[10, 30, 60, 30]], 'rectCount': 1}]}
        lookup = {'observedAt': 2, 'gate': None, 'loading': False, 'error': None,
                  'selection': {'attempt': 0, 'mode': 'dictionary', 'selecting': False, 'text': 'hope'},
                  'result': {'source': 'dictionary', 'text': 'A definition'},
                  'traffic': {'installed': True, 'requests': [{'startedAt': 1, 'responseAt': 2,
                              'status': 200, 'abortedAt': None, 'failedAt': None}]}}
        self.pair = {'kind': 'host-synthetic', 'reference': {
            'image': 'positive.png', 'cropPixels': [10, 30, 60, 30]}, 'before': {}, 'after': {}}
        for name, width, x in [('before', 160, 10), ('after', 220, 50)]:
            s = copy.deepcopy(selection); s['viewport'][0] = width; s['ranges'][0]['rects'][0][0] = x
            s['at'] = 1 if name == 'before' else 3
            l = copy.deepcopy(lookup); l['observedAt'] = s['at'] + 1
            (self.root / f'{name}-selection.json').write_text('PROBE ' + json.dumps(s))
            (self.root / f'{name}-lookup.json').write_text(json.dumps({'value': l}))
            self.pair[name] = {'image': f'{name}.png', 'selection': f'{name}-selection.json',
                'lookup': f'{name}-lookup.json', 'nativeWindow': [width, 120], 'imagePixels': [width, 120],
                'scale': 1, 'orientation': 'landscape', 'exifOrientation': 1, 'activeDisplay': 1 if name == 'before' else 3,
                'captureDisplay': 1 if name == 'before' else 3, 'cropPixels': [x, 30, 60, 30], 'blankPixels': [x + 65, 30, 10, 10],
                'domOrigin': 'reader-viewport', 'webViewOffset': [0, 0], 'mappingEvidence': 'HOST fake calibration',
                'windowEvidence': 'HOST fake native bounds'}

    def check(self, pair=None):
        return PAINT.compare(self.pair if pair is None else pair, self.root)

    def mutate_receipt(self, checkpoint, key, mutate):
        p = self.root / self.pair[checkpoint][key]
        d = PAINT.read_json(p); mutate(d.get('value', d)); p.write_text(json.dumps(d))

    def test_preserved_and_removed_paint(self):
        self.assertEqual(self.check()['status'], 'HOST_PAINT_PRESERVED')
        p = self.root / 'after.png'
        with Image.open(p) as im:
            im = im.convert('RGB'); im.putdata([((255, 255, 255) if b > 150 and r < 240 else (r, g, b))
                                               for r, g, b in im.get_flattened_data()]); im.save(p)
        self.assertEqual(self.check()['status'], 'HOST_PAINT_LOST')

    def test_before_fold_control_is_explicit_and_not_acceptance(self):
        pair = copy.deepcopy(self.pair); del pair['after']
        path = self.root / 'baseline.json'; path.write_text(json.dumps(pair))
        r = subprocess.run([sys.executable, str(TOOL), str(path), '--expect', 'painted', '--baseline-only'],
                           capture_output=True, text=True, check=False)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout)['status'], 'HOST_PAINTED_BASELINE_ONLY')
        with self.assertRaises(KeyError): self.check(pair)

    def test_invalid_geometry_and_missing_metadata_are_blocked(self):
        for key, value in [('scale', 3), ('scale', float('nan')), ('imagePixels', [220, 119]),
                           ('captureDisplay', 1), ('orientation', 'portrait'), ('webViewOffset', [-1, 0]),
                           ('cropPixels', [219, 30, 60, 30]), ('cropPixels', [50, -1, 60, 30]),
                           ('domOrigin', 'iframe'), ('mappingEvidence', ''), ('nativeWindow', [160, 120])]:
            pair = copy.deepcopy(self.pair); pair['after'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError): self.check(pair)
        for key in self.pair['after']:
            pair = copy.deepcopy(self.pair); del pair['after'][key]
            with self.subTest(missing=key), self.assertRaises((ValueError, KeyError)): self.check(pair)

    def test_wrong_range_direction_text_or_traffic_is_blocked(self):
        for key, value in [('cfi', ''), ('cfi', 'epubcfi(wrong)'), ('backward', True), ('text', 'wish'), ('section', 1)]:
            original = (self.root / 'after-selection.json').read_text()
            self.mutate_receipt('after', 'selection', lambda d: d['ranges'][0].update(
                {key: value, **({'anchor': 37, 'focus': 33} if key == 'backward' else {})}))
            with self.subTest(key=key), self.assertRaises(ValueError): self.check()
            (self.root / 'after-selection.json').write_text(original)
        self.mutate_receipt('after', 'lookup', lambda d: d['traffic']['requests'].append(d['traffic']['requests'][0]))
        with self.assertRaises(ValueError): self.check()

    def test_wrong_word_blank_occlusion_partial_paint_and_bad_baseline_are_blocked(self):
        for mode in ('wrong-word', 'blank', 'occluded', 'partial', 'baseline', 'washed-screen', 'transparent'):
            self.setUp()
            p = self.root / ('before.png' if mode == 'baseline' else 'after.png')
            with Image.open(p) as im:
                im = im.convert('RGB'); draw = ImageDraw.Draw(im)
                if mode in ('wrong-word', 'blank'):
                    draw.rectangle((50, 30, 109, 59), fill='white')
                    if mode == 'wrong-word': draw.text((55, 35), 'wish', fill='black')
                elif mode == 'baseline': im.putdata([
                    ((255, 255, 255) if b > 150 and r < 240 else (r, g, b)) for r, g, b in im.get_flattened_data()])
                elif mode == 'occluded': draw.rectangle((50, 30, 70, 59), fill='gray')
                elif mode == 'washed-screen': draw.rectangle((115, 30, 124, 39), fill=(204, 221, 237))
                elif mode == 'transparent': im = im.convert('RGBA'); im.putalpha(0)
                else: draw.rectangle((100, 30, 109, 59), fill='white')
                im.save(p)
            with self.subTest(mode=mode), self.assertRaises(ValueError): self.check()

    def test_exif_orientation_and_one_pixel_rounding(self):
        p = self.root / 'after.png'
        with Image.open(p) as im:
            raw = im.transpose(Image.Transpose.ROTATE_90)
            exif = raw.getexif(); exif[274] = 6; raw.save(p, exif=exif)
        self.pair['after']['exifOrientation'] = 6
        self.assertEqual(self.check()['status'], 'HOST_PAINT_PRESERVED')
        self.pair['after']['cropPixels'][0] += 1
        self.assertEqual(self.check()['after']['roundingPixels'], [-1, 0])

    def test_unchanged_window_missing_range_and_unpainted_reference_are_blocked(self):
        pair = copy.deepcopy(self.pair); pair['after'] = copy.deepcopy(pair['before'])
        pair['after']['selection'] = 'same-size-selection.json'; pair['after']['lookup'] = 'after-lookup.json'
        s = PAINT.read_json(self.root / 'before-selection.json'); s['at'] = 3
        (self.root / 'same-size-selection.json').write_text(json.dumps(s))
        with self.assertRaisesRegex(ValueError, 'window change'): self.check(pair)
        pair = copy.deepcopy(self.pair); pair['after']['activeDisplay'] = pair['after']['captureDisplay'] = 1
        with self.assertRaisesRegex(ValueError, 'D1/D3'): self.check(pair)
        self.mutate_receipt('after', 'selection', lambda d: d['ranges'][0].pop('cfi'))
        with self.assertRaises(KeyError): self.check()
        Image.new('RGB', (160, 120), 'white').save(self.root / 'positive.png')
        with self.assertRaises(ValueError): self.check()

    def test_cli_invalid_and_missing_arguments_are_blocked(self):
        for args in [[], ['missing.json', '--expect', 'unpainted'], ['missing.json', '--expect', 'painted']]:
            r = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, check=False)
            self.assertEqual(r.returncode, 2); self.assertEqual(json.loads(r.stdout)['status'], 'BLOCKED')

    @unittest.skipUnless(os.environ.get('DUO_PAINT_ARCHIVE_PAIR'), 'optional archived controls not configured')
    def test_actual_archived_positive_and_negative(self):
        p = Path(os.environ['DUO_PAINT_ARCHIVE_PAIR'])
        pair = PAINT.read_json(p)
        self.assertEqual(pair['kind'], 'host-replay')
        result = PAINT.compare(pair, p.parent)
        self.assertEqual(result['status'], 'HOST_PAINT_LOST')
        self.assertEqual(result['before']['paint'], 'painted')
        self.assertEqual(result['after']['paint'], 'unpainted')


if __name__ == '__main__':
    unittest.main()
