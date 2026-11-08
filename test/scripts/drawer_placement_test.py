#!/usr/bin/env python3
"""Host checks for the screenshot oracle, not native Drawer behavior."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

from PIL import Image

PATH = Path(__file__).resolve().parents[1] / 'manual-test/library-and-reader/drawer-placement.py'
SPEC = importlib.util.spec_from_file_location('drawer_placement', PATH)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class DrawerPlacementOracleTests(unittest.TestCase):
    def measure(self, rectangle=None, scale=2, window=(820, 1180)):
        image = Image.new('RGB', (820 * scale, 1180 * scale), 'white')
        if rectangle:
            image.paste((244, 244, 246), tuple(int(point * scale) for point in rectangle))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'screen.png'
            image.save(path)
            return probe.measure_image(path, *window)

    def test_reported_detached_card_goes_red(self):
        result = self.measure((120, 585, 700, 910))
        self.assertEqual(result['drawer'], {'x': 120, 'y': 585, 'width': 580, 'height': 325})
        self.assertEqual(result['bottomGap'], 270)
        self.assertEqual(probe.placement_signal(result, 1180), ('RED', 59))

    def test_top_near_status_bar_is_not_rejected_as_missing_sheet(self):
        # The first oracle incorrectly filtered out every sheet starting above 60 pt.
        result = self.measure((0, 42, 820, 1180))
        self.assertEqual(result['drawer']['height'], 1138)
        self.assertEqual(result['bottomGap'], 0)
        self.assertEqual(probe.placement_signal(result, 1180)[0], 'GREEN')
        # That narrow GREEN does not say the page-sized result meets the height/preview spec.

    def test_native_candidate_gap_is_measured_not_rounded_away(self):
        result = self.measure((120, 538, 700, 1128))
        self.assertEqual(result['drawer']['height'], 590)
        self.assertEqual(result['bottomGap'], 52)

    def test_scale_comes_from_native_window_not_assumed_three_x(self):
        result = self.measure((120, 585, 700, 910), scale=1)
        self.assertEqual(result['screenshotScale'], 1)
        self.assertEqual(result['bottomGap'], 270)

    def test_wrong_window_capture_scale_blocks(self):
        with self.assertRaisesRegex(ValueError, 'incompatible scales'):
            self.measure((120, 585, 700, 910), window=(1180, 820))

    def test_absent_drawer_blocks_instead_of_passing(self):
        with self.assertRaisesRegex(ValueError, 'no large Drawer-colored region'):
            self.measure()

    def test_narrow_fitted_shape_is_outside_wide_screenshot_oracle(self):
        with self.assertRaisesRegex(ValueError, 'no large Drawer-colored region'):
            self.measure((360, 585, 460, 650))


if __name__ == '__main__':
    unittest.main()
