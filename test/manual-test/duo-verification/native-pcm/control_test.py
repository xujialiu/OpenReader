#!/usr/bin/env python3
"""HOST ONLY: fake in-process file peer, no native tools/audio/app control."""
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from control import SCHEMA, atomic_json, directory, export_capture, request


class NativePCMControlTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='openreader-pcm-control-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.container = self.root / 'container'
        self.run = 'host-353'
        self.directory = directory(self.container, self.run)
        self.directory.mkdir(parents=True)
        self.ready = {'schema': SCHEMA, 'run': self.run, 'simulatorOnly': True,
                      'clock': {'wallMs': time.time() * 1000}, 'expiresAfterSeconds': 120}
        atomic_json(self.directory / 'ready.json', self.ready)

    def peer(self):
        stop = threading.Event()
        received = []

        def run():
            seen = 0
            while not stop.wait(.002):
                try:
                    command = json.loads((self.directory / 'command.json').read_text())
                except FileNotFoundError:
                    continue
                if command['seq'] <= seen:
                    continue
                seen = command['seq']
                received.append(command)
                atomic_json(self.directory / f'answer-{seen}.json', {
                    'schema': SCHEMA, 'run': self.run, 'seq': seen, 'answer': {'hostFake': True}})
        thread = threading.Thread(target=run)
        thread.start()
        self.addCleanup(lambda: (stop.set(), thread.join(timeout=1)))
        return received

    def test_round_trip_is_fresh_monotonic_and_does_not_replay_deleted_commands(self):
        received = self.peer()
        first = request(self.container, self.run, 'describe')
        self.assertEqual(first['seq'], 1)
        self.assertFalse((self.directory / 'command.json').exists())
        second = request(self.container, self.run, 'state')
        self.assertEqual(second['seq'], 2)
        self.assertEqual([row['do'] for row in received], ['describe', 'state'])

    def test_fixed_fields_bounds_tokens_and_expiry_fail_closed_before_native_action(self):
        for action, fields in [('eval', {}), ('state', {'code': 'not allowed'}),
                               ('anchor', {'label': 'arbitrary'}),
                               ('arm', {'maximumSeconds': 11, 'sourceIdentity': '0x1', 'engineIdentity': '0x2',
                                        'readingToken': 'host', 'attribution': 'sole-current-reading-no-other-audio'})]:
            with self.assertRaises(ValueError):
                request(self.container, self.run, action, fields)
        with self.assertRaises(ValueError):
            directory(self.container, '../escape')
        self.ready['clock']['wallMs'] -= 121000
        (self.directory / 'ready.json').unlink()
        atomic_json(self.directory / 'ready.json', self.ready)
        with self.assertRaisesRegex(ValueError, 'expired'):
            request(self.container, self.run, 'describe')
        self.assertFalse((self.directory / 'command.json').exists())

    def test_missing_fresh_answer_times_out_without_claiming_command_did_not_run(self):
        with self.assertRaisesRegex(TimeoutError, 'may already have executed'):
            request(self.container, self.run, 'describe', timeout=.03)
        self.assertTrue((self.directory / 'command.json').exists())
        self.assertEqual(json.loads((self.directory / 'sender-seq.json').read_text()), 1)

    def test_export_preserves_raw_originals_and_rejects_checksum_tampering(self):
        pcm = b'\x00\x00\x80\x3f' * 4  # external synthetic float32 fixture, never played
        capture = {'schema': SCHEMA, 'run': self.run, 'pcmSHA256': hashlib.sha256(pcm).hexdigest(),
                   'status': 'INCOMPLETE'}
        (self.directory / 'capture.f32le').write_bytes(pcm)
        atomic_json(self.directory / 'capture.json', capture)
        before = {file.name: file.read_bytes() for file in self.directory.iterdir()}
        result = export_capture(self.container, self.run, self.root / 'private-export')
        self.assertEqual(result['status'], 'INCOMPLETE')
        self.assertEqual((self.root / 'private-export/capture.f32le').read_bytes(), pcm)
        self.assertEqual({file.name: file.read_bytes() for file in self.directory.iterdir()}, before)
        with self.assertRaisesRegex(ValueError, 'New private'):
            export_capture(self.container, self.run, self.root / 'private-export')
        (self.directory / 'capture.f32le').write_bytes(pcm + b'tampered')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            export_capture(self.container, self.run, self.root / 'tampered-export')
        self.assertFalse((self.root / 'tampered-export').exists())

    def test_export_refuses_a_git_directory(self):
        forbidden = self.root / 'checkout'
        forbidden.mkdir()
        (forbidden / '.git').write_text('host-only fixture')
        with self.assertRaisesRegex(ValueError, 'Git'):
            export_capture(self.container, self.run, forbidden / 'speech')


if __name__ == '__main__':
    unittest.main(verbosity=2)
