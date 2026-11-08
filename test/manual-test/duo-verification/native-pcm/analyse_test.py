#!/usr/bin/env python3
"""HOST ONLY: actual analyser over external PCM copies, not native WSOLA/audio."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import numpy as np

from analyse import analyse, timeline_errors
from qualify_copies import qualify_copies


class NativePCMAnalysisTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='openreader-pcm-analysis-')
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.rate = 6000
        rng = np.random.default_rng(353)
        # Not a hash/block-identity oracle: gain, DC offset, arbitrary packet
        # boundaries and overlapping local correlations exercise waveform code.
        source = np.convolve(rng.normal(0, .05, self.rate * 3 + 8), np.ones(9) / 9, 'valid').astype('<f4')
        raw = source.tobytes()
        (self.root / 'clip.f32le').write_bytes(raw)
        self.reference = self.root / 'reference.json'
        self.reference.write_text(json.dumps({'pcm': 'clip.f32le', 'sampleRate': self.rate, 'channels': 1,
                                             'pcmSHA256': hashlib.sha256(raw).hexdigest()}))
        self.original = self.root / 'original'
        self.original.mkdir()
        self.output = (source[3000:12000] * .6 + .01).astype('<f4')
        receipt = {'schema': 'OpenReaderNativePCM-v1', 'run': 'host-only', 'failureBits': 0,
                   'status': 'CAPTURED_QUALIFICATION_PENDING', 'tapRemoved': True, 'quiescent': True,
                   'storage': 'float32-little-endian-interleaved', 'frameCount': len(self.output),
                   'format': {'sampleRate': self.rate, 'channels': 1, 'interleaved': False},
                   'machTimebase': {'numer': 1, 'denom': 1},
                   'anchors': [{'label': label, 'clock': {'beforeHostTime': str(tick), 'afterHostTime': str(tick)}}
                               for label, tick in [('measurement-start', 1100000000), ('measurement-end', 2400000000)]],
                   'volumeSamples': [{'outputVolume': 0}], 'records': []}
        offset = 0
        for frames in [600, 650, 550] * 5:
            receipt['records'].append({'frameOffset': offset, 'frames': frames,
                'sampleTimeValid': True, 'hostTimeValid': True, 'sampleTime': str(offset * 2),
                'timestampSampleRate': self.rate * 2,
                'hostTime': str(1000000000 + round(offset / self.rate * 1e9)), 'arrivalHostTime': '3000000000'})
            offset += frames
        self.assertEqual(offset, len(self.output))
        self.save(self.original, self.output, receipt)
        self.original_hashes = self.hashes(self.original)

    @staticmethod
    def hashes(directory):
        return {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in directory.iterdir()}

    @staticmethod
    def save(directory, pcm, receipt):
        raw = pcm.astype('<f4').tobytes()
        receipt['pcmSHA256'] = hashlib.sha256(raw).hexdigest()
        (directory / 'capture.f32le').write_bytes(raw)
        (directory / 'capture.json').write_text(json.dumps(receipt))

    def external_copy(self, name):
        target = self.root / name
        shutil.copytree(self.original, target)
        return target, json.loads((target / 'capture.json').read_text())

    def test_clean_gain_dc_arbitrary_frames_and_non_pcm_timestamp_rate_accept(self):
        result = analyse(self.original, self.reference)
        self.assertEqual(result['status'], 'HOST_1X_MATCH', result)
        self.assertGreater(len(result['matches']), 100)
        self.assertEqual(result['unresolved'], [])
        self.assertEqual(result['timelineErrors'], [])
        self.assertEqual(self.hashes(self.original), self.original_hashes)
        print('clean gain/DC + arbitrary frame lengths + timestamp units: HOST_1X_MATCH')

    def test_external_drop_repeat_and_equal_frame_repeat_skip_reject_not_aggregate_median(self):
        for kind in ('drop', 'repeat', 'equal_frame_repeat_skip'):
            target, receipt = self.external_copy(kind)
            point, count = 3600, 300  # 50ms event inside the bracketed measurement
            if kind == 'drop':
                mutated = np.r_[self.output[:point], self.output[point + count:], self.output[-count:]]
            elif kind == 'repeat':
                mutated = np.r_[self.output[:point], self.output[point - count:point], self.output[point:-count]]
            else:
                mutated = self.output.copy()
                mutated[point:point + count] = self.output[point - count:point]
            self.assertEqual(len(mutated), len(self.output))  # all end-to-end counts still green
            self.save(target, mutated, receipt)  # refresh hash: hash mismatch is NOT the oracle
            result = analyse(target, self.reference)
            self.assertEqual(result['status'], 'REJECT', kind)
            self.assertGreater(len(result['violations']), 0, kind)
            self.assertEqual(result['timelineErrors'], [], kind)
            print(kind + ': REJECT by local waveform, despite equal frame count and valid checksum')
        self.assertEqual(self.hashes(self.original), self.original_hashes)

    def test_external_physically_removed_and_inserted_samples_cannot_pass_count_gate(self):
        for name, mutated in [('physically_dropped', np.r_[self.output[:3600], self.output[3900:]]),
                              ('physically_repeated', np.r_[self.output[:3600], self.output[3300:3600], self.output[3600:]])]:
            target, receipt = self.external_copy(name)
            self.save(target, mutated, receipt)
            with self.assertRaisesRegex(ValueError, 'frame count'):
                analyse(target, self.reference)
        self.assertEqual(self.hashes(self.original), self.original_hashes)

    def test_timestamp_only_gap_rejects_intact_pcm(self):
        target, receipt = self.external_copy('timestamp_gap')
        receipt['records'][6]['hostTime'] = str(int(receipt['records'][6]['hostTime']) + 50000000)
        self.save(target, self.output, receipt)
        result = analyse(target, self.reference)
        self.assertEqual(result['status'], 'REJECT')
        self.assertTrue(any('host timestamp gap' in error for error in result['timelineErrors']))
        self.assertEqual(result['violations'], [])
        self.assertEqual(self.hashes(self.original), self.original_hashes)
        print('timestamp-only gap with unchanged PCM: REJECT')

    def test_missing_boundary_timestamp_flags_overflow_volume_cleanup_and_offset_are_not_passes(self):
        original = json.loads((self.original / 'capture.json').read_text())
        changes = [
            lambda r: r.update(failureBits=1),
            lambda r: r.update(tapRemoved=False),
            lambda r: r['records'][1].update(sampleTimeValid=False),
            lambda r: r['records'][1].update(frameOffset=0),
            lambda r: r['volumeSamples'][0].update(outputVolume=.6),
            lambda r: r['anchors'][0]['clock'].update(beforeHostTime='900000000'),
            lambda r: r['anchors'][1]['clock'].update(afterHostTime='2600000000'),
            lambda r: r['anchors'].pop(),
        ]
        for change in changes:
            receipt = copy.deepcopy(original)
            change(receipt)
            self.assertTrue(timeline_errors(receipt))

    def test_silence_ambiguity_and_nonunit_rate_stay_explicitly_unqualified(self):
        target, receipt = self.external_copy('silence')
        quiet = self.output.copy()
        quiet[3600:4200] = 0
        self.save(target, quiet, receipt)
        result = analyse(target, self.reference)
        self.assertNotEqual(result['status'], 'HOST_1X_MATCH')
        self.assertTrue(result['unresolved'])
        with self.assertRaisesRegex(ValueError, 'WSOLA'):
            analyse(self.original, self.reference, 1.5)
        source = np.frombuffer((self.root / 'clip.f32le').read_bytes(), dtype='<f4')
        repeated = np.tile(source, 2).astype('<f4').tobytes()
        (self.root / 'clip.f32le').write_bytes(repeated)
        ref = json.loads(self.reference.read_text())
        ref['pcmSHA256'] = hashlib.sha256(repeated).hexdigest()
        self.reference.write_text(json.dumps(ref))
        result = analyse(self.original, self.reference)
        self.assertEqual(result['status'], 'INCOMPLETE')
        self.assertTrue(result['unresolved'])

    def test_private_external_control_api_keeps_original_and_requires_actual_control_rejections(self):
        result = qualify_copies(self.original, self.reference, self.root / 'qualified-copies', 3600, 300)
        self.assertEqual(result['status'], 'HOST_EXTERNAL_CONTROLS_MATCH')
        self.assertEqual(result['controls'], {name: 'REJECT' for name in
            ('drop', 'repeat', 'equal_frame_repeat_skip', 'timestamp_gap')})
        self.assertEqual(self.hashes(self.original), self.original_hashes)
        details = json.loads((self.root / 'qualified-copies/equal_frame_repeat_skip-analysis.json').read_text())
        self.assertTrue(details['violations'])
        self.assertEqual(details['timelineErrors'], [])
        with self.assertRaisesRegex(ValueError, 'inside'):
            qualify_copies(self.original, self.reference, self.root / 'bad-position', 0, 300)
        self.assertFalse((self.root / 'bad-position').exists())

    def test_every_output_channel_is_qualified_and_original_checksums_are_enforced(self):
        target, receipt = self.external_copy('stereo')
        stereo = np.column_stack((self.output, self.output * .8))
        receipt['format']['channels'] = 2
        self.save(target, stereo, receipt)
        self.assertEqual(analyse(target, self.reference)['status'], 'HOST_1X_MATCH')
        stereo[3600:3900, 1] = stereo[3300:3600, 1]
        self.save(target, stereo, receipt)
        result = analyse(target, self.reference)
        self.assertEqual(result['status'], 'REJECT')
        self.assertTrue(any(row['channel'] == 1 for row in result['violations']))
        with (target / 'capture.f32le').open('ab') as file:
            file.write(b'bad')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            analyse(target, self.reference)


if __name__ == '__main__':
    unittest.main(verbosity=2)
