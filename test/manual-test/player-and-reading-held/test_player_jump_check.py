"""The native-pixel analyser must report points, regardless of screenshot scale."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


class PlayerJumpCheckTests(unittest.TestCase):
    def measure(self, scale, displacement):
        with tempfile.TemporaryDirectory() as directory:
            for index, offset in enumerate((displacement, 0), start=1):
                frame = Image.new('RGB', (160, 140), 'black')
                draw = ImageDraw.Draw(frame)
                draw.rectangle((22, 82, 31, 91), fill='white')
                draw.rectangle((82, 82 + offset, 91, 91 + offset), fill='white')
                frame.resize((160 * scale, 140 * scale), Image.Resampling.NEAREST).save(
                    Path(directory) / f'{index:04d}.png'
                )
            return subprocess.run(
                [sys.executable, str(Path(__file__).with_name('player-jump-check.py')),
                 str(Path(directory) / '*.png'), '160', '20,80,34,94', '80,80,94,94'],
                capture_output=True, text=True, timeout=10,
            )

    def test_stationary_at_every_scale(self):
        for scale in (1, 2, 3):
            with self.subTest(scale=scale):
                result = self.measure(scale, 0)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('shift = 0..0 pt', result.stdout)

    def test_two_points_stay_within_three_point_tolerance(self):
        for scale in (1, 2, 3):
            with self.subTest(scale=scale):
                result = self.measure(scale, -2)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('shift = -2..0 pt', result.stdout)

    def test_original_twenty_two_point_jump_is_measured_at_every_scale(self):
        for scale in (1, 2, 3):
            with self.subTest(scale=scale):
                result = self.measure(scale, -22)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn('shift = -22..0 pt', result.stdout)
                self.assertIn('mover missing: []', result.stdout)


if __name__ == '__main__':
    unittest.main()
