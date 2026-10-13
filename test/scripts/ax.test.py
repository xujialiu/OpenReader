"""Host-only tests: python3 test/scripts/ax.test.py. Never contacts a simulator."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "ax", Path(__file__).resolve().parents[1] / "manual-test/kit/ax.py"
)
ax = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ax)


class ReadTreeTests(unittest.TestCase):
    def test_success_has_a_deadline(self):
        reply = subprocess.CompletedProcess([], 0, '[{"type":"Sheet"}]', '')
        with patch.object(ax, 'axe_binary', return_value='/fake/axe'), patch.object(ax.subprocess, 'run', return_value=reply) as run:
            self.assertEqual(ax.read_tree('owned-device'), [{'type': 'Sheet'}])
            self.assertEqual(run.call_args.kwargs.get('timeout'), 20)

    def test_remote_session_error_is_visible_and_actionable(self):
        reply = subprocess.CompletedProcess([], 1, '', 'Error: Timed out creating the simulator remote automation session')
        with patch.object(ax, 'axe_binary', return_value='/fake/axe'), patch.object(ax.subprocess, 'run', return_value=reply):
            with self.assertRaises(SystemExit) as error:
                ax.read_tree('owned-device')
            self.assertIn('remote automation session', str(error.exception))
            self.assertIn('consent-recovery.md', str(error.exception))

    def test_hung_read_is_bounded_not_retried(self):
        with patch.object(ax, 'axe_binary', return_value='/fake/axe'), patch.object(ax.subprocess, 'run', side_effect=subprocess.TimeoutExpired('axe', 20)) as run:
            with self.assertRaises(SystemExit) as error:
                ax.read_tree('owned-device')
            self.assertIn('20 seconds', str(error.exception))
            self.assertEqual(run.call_count, 1)

    def test_invalid_json_is_not_an_empty_tree(self):
        reply = subprocess.CompletedProcess([], 0, 'not JSON', '')
        with patch.object(ax, 'axe_binary', return_value='/fake/axe'), patch.object(ax.subprocess, 'run', return_value=reply):
            with self.assertRaises(SystemExit) as error:
                ax.read_tree('owned-device')
            self.assertIn('invalid JSON', str(error.exception))


if __name__ == '__main__':
    unittest.main()
