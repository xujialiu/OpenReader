#!/usr/bin/env python3
"""Host safety checks only; do not claim keyboard or Mac UI acceptance."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'manual-test/library-and-reader/mac-drawer-escape.py'


class MacEscapeSafetyTests(unittest.TestCase):
    def test_owner_app_is_refused_before_any_gui_command(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'attempt'
            result = subprocess.run([sys.executable, str(SCRIPT), 'top.xujialiu.openreader',
                                     '1', str(output), '--state', 'expanded'],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 69)
            self.assertIn('only the separately approved drawerprobe', result.stderr)
            self.assertEqual(list(output.iterdir()), [])

    def test_existing_evidence_directory_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sentinel = output / 'before.json'
            sentinel.write_text('retained original evidence')
            result = subprocess.run([sys.executable, str(SCRIPT),
                                     'top.xujialiu.openreader.drawerprobe', '1', str(output),
                                     '--state', 'expanded'], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 69)
            self.assertIn('new artifact directory', result.stderr)
            self.assertEqual(sentinel.read_text(), 'retained original evidence')
            self.assertEqual(list(output.iterdir()), [sentinel])


if __name__ == '__main__':
    unittest.main()
