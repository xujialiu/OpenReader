#!/usr/bin/env python3
"""Synthetic image controls for the #354 measurement tool, never native proof."""
import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True

MODULE = Path(__file__).with_name('duo-preview-compare.py')
SPEC = importlib.util.spec_from_file_location('duo_preview_compare', MODULE)
COMPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPARE)


class DuoPreviewCompareTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='duo-preview-host-')
        self.addCleanup(self.directory.cleanup)
        self.before = Path(self.directory.name) / 'before.png'
        self.opened = Path(self.directory.name) / 'opened.png'
        self.image = Image.new('RGB', (100, 100), 'white')
        ImageDraw.Draw(self.image).text((15, 15), 'hope', fill='black')
        self.image.save(self.before)
        opened = self.image.copy()
        ImageDraw.Draw(opened).rectangle((0, 60, 99, 99), fill='gray')
        opened.save(self.opened)
        checkpoint = {'passageCFI': 'epubcfi(test)', 'appearance': {'fontSize': 16},
                      'window': [100, 100], 'pose': 'outer-upright', 'region': [10, 10, 40, 30], 'paused': True}
        self.pair = {'before': dict(checkpoint, appearanceOpen=False),
                     'opened': dict(checkpoint, appearanceOpen=True), 'cropPixels': [10, 10, 40, 30]}

    def test_unchanged_exposed_crop_with_real_image_difference_elsewhere(self):
        result = COMPARE.compare_preview(self.before, self.opened, self.pair)
        self.assertEqual(result['status'], 'PIXELS_IDENTICAL')
        self.assertEqual(result['changedPixels'], 0)
        self.assertIn('Metadata is a tester assertion', result['limit'])

    def test_darkened_crop_is_not_silently_passed(self):
        dimmed = Image.open(self.opened).convert('RGB')
        ImageDraw.Draw(dimmed).rectangle((10, 10, 49, 39), fill=(160, 160, 160))
        dimmed.save(self.opened)
        result = COMPARE.compare_preview(self.before, self.opened, self.pair)
        self.assertEqual(result['status'], 'PIXELS_DIFFER_REVIEW_REQUIRED')
        self.assertGreater(result['changedPixels'], 0)
        self.assertTrue(all(value < 0 for value in result['signedMeanRGBDelta']))

    def test_unmatched_passage_font_pose_or_two_opened_images_are_invalid(self):
        for field, changed in [('passageCFI', 'elsewhere'), ('appearance', {'fontSize': 18}),
                               ('pose', 'inner'), ('appearanceOpen', False), ('paused', False)]:
            pair = copy.deepcopy(self.pair)
            pair['opened'][field] = changed
            with self.subTest(field=field), self.assertRaises(ValueError):
                COMPARE.compare_preview(self.before, self.opened, pair)

    def test_invalid_crop_and_identical_whole_images_are_not_opening_controls(self):
        pair = copy.deepcopy(self.pair)
        pair['cropPixels'] = [95, 95, 10, 10]
        with self.assertRaisesRegex(ValueError, 'outside'):
            COMPARE.compare_preview(self.before, self.opened, pair)
        with self.assertRaisesRegex(ValueError, 'Whole images identical'):
            COMPARE.compare_preview(self.before, self.before, self.pair)


if __name__ == '__main__':
    unittest.main()
