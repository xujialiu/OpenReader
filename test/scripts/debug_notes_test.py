"""The kit's Debug Note scripts (#305) against a copied Debug Log written in the app's format.
Never contacts a device."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
NOTES = ROOT / 'test/manual-test/kit/debug-notes.py'
TIMELINE = ROOT / 'test/manual-test/kit/debug-log-timeline.py'

OLDER = '\n'.join([
    '2026-10-20 13:50:00.001 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, native 1.0.0 (9), Debug Mode on',
    '2026-10-20 13:51:00.000 +08:00 [app] app active',
    '2026-10-20 13:52:10.500 +08:00 [reading] note: The reading is waiting for more of it',
    '2026-10-20 13:54:00.000 +08:00 [reading] play at utterance 40 with fish',
]) + '\n'
NEWER = '\n'.join([
    '2026-10-20 14:03:32.345 +08:00 [debug-note] 2026-10-20 14:03:12.345 +08:00 "The Count of Monte Cristo" (5f1c9a2b): the highlight fell behind',
    '2026-10-20 14:03:32.350 +08:00 [hx] playing=true app=active utterance=41 known=120 section=7 rendered=8/40 level=word seeking=false resume=null note=null',
    '2026-10-20 14:05:20.000 +08:00 [reading] pause at utterance 52',
    '2026-10-20 14:09:00.000 +08:00 [debug-note] 2026-10-20 14:08:40.002 +08:00 "The Count of Monte Cristo" (5f1c9a2b): (no comment)',
]) + '\n'


def run(*args):
    return subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True, timeout=20)


class DebugNoteScripts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.log = Path(self.temp.name) / 'debug-log'
        self.log.mkdir()
        # Written out of order, as a listing may return them: the scripts read oldest first.
        (self.log / 'debug-log-000012.txt').write_text(NEWER)
        (self.log / 'debug-log-000011.txt').write_text(OLDER)
        (self.log / 'version.txt').write_text('1.0.0 (9)-beta12')

    def tearDown(self):
        self.temp.cleanup()

    def test_lists_every_debug_note_with_its_own_time_and_not_the_players_notes(self):
        result = run(NOTES, self.log)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), [
            'Debug Log written by 1.0.0 (9)-beta12',
            '2026-10-20 14:03:12.345 +08:00  "The Count of Monte Cristo" (5f1c9a2b): the highlight fell behind',
            '2026-10-20 14:08:40.002 +08:00  "The Count of Monte Cristo" (5f1c9a2b): (no comment)',
        ])
        self.assertIn('2 Debug Notes', result.stderr)

    def test_says_so_when_there_is_none(self):
        (self.log / 'debug-log-000012.txt').unlink()
        result = run(NOTES, self.log)
        self.assertEqual(result.returncode, 1)
        self.assertIn('no Debug Note', result.stderr)

    def test_timeline_around_a_copied_time_takes_ten_minutes_before_and_two_after(self):
        # What the author copied: the time, then his comment.
        result = run(TIMELINE, self.log, '--around', '2026-10-20 14:03:12.345 +08:00 the highlight fell behind')
        self.assertEqual(result.returncode, 0, result.stderr)
        shown = [line.split(' [')[1].split(']')[0] for line in result.stdout.splitlines()]
        # 13:53:12.345 to 14:05:12.345: the play at 13:54, the note and its status line; not the
        # player's note at 13:52 nor the pause at 14:05:20.
        self.assertEqual(shown, ['reading', 'debug-note', 'hx'])

    def test_timeline_around_takes_other_windows_in_minutes(self):
        result = run(TIMELINE, self.log, '--around', '2026-10-20 14:03:12', '--before', '1', '--after', '6')
        self.assertEqual(result.returncode, 0, result.stderr)
        shown = [line.split(' [')[1].split(']')[0] for line in result.stdout.splitlines()]
        self.assertEqual(shown, ['debug-note', 'hx', 'reading', 'debug-note'])

    def test_timeline_refuses_an_around_that_is_not_a_time(self):
        result = run(TIMELINE, self.log, '--around', 'yesterday afternoon')
        self.assertEqual(result.returncode, 2)
        self.assertIn('YYYY-MM-DD HH:MM', result.stderr)


if __name__ == '__main__':
    unittest.main()
