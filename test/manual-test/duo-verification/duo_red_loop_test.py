#!/usr/bin/env python3
"""HOST only: execute the actual shell driver's shared receipt/verdict path."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

AREA = Path(__file__).resolve().parent
DRIVER = AREA / 'duo-red-loop.sh'
CAPTURED = json.loads((AREA / 'fixtures/duo-loop-public-receipts.json').read_text())


class DuoRedLoopTest(unittest.TestCase):
    def replay(self, manifest, code, outcome):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'receipts.json'
            source.write_text(json.dumps(manifest))
            run = subprocess.run(['bash', str(DRIVER), '--replay', str(source), str(root / 'out')],
                                 capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, code, run.stdout + run.stderr)
            summary = json.loads((root / 'out/summary.json').read_text())
            self.assertEqual(summary['exitCode'], code)
            self.assertEqual(summary['outcome'], outcome)
            self.assertEqual(summary['kind'], 'HOST_REPLAY')
            self.assertIn(f'outcome={outcome} exitCode={code}', run.stdout)
            self.assertIn(f'outcome={outcome} exitCode={code}', (root / 'out/loop.log').read_text())
            return summary

    def clean(self):
        m = copy.deepcopy(CAPTURED)
        m['cycles'] = m['cycles'][:1]
        m['maxCycles'] = 1
        return m

    def test_captured_four_cycles_one_red_is_nonzero_at_max_cycles(self):
        s = self.replay(CAPTURED, 1, 'APP_RED')
        self.assertEqual((s['attemptedCycles'], s['validCycles'], s['appFailedCycles']), (4, 4, 1))
        self.assertEqual(s['stopReason'], 'max-valid-cycles-reached')
        self.assertEqual(s['cycles'][-1]['caseVerdict'], 'RED-outward-range-drop')

    def test_valid_clean_positive(self):
        self.replay(self.clean(), 0, 'PASS')

    def test_live_phase_cycle_and_summary_cli_use_the_same_oracle(self):
        helper = AREA / 'duo-loop-verdict.py'
        for index, code in [(0, 0), (3, 1)]:
            with self.subTest(capturedCycle=index + 1), tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                directory = out / 'cycle-1'
                directory.mkdir()
                cycle = CAPTURED['cycles'][index]
                for phase, tag, paint in [('baseline', 'press', 'press'), ('outward', 'd3', 'd3'), ('return', 'return', 'ret')]:
                    if phase not in cycle:
                        continue
                    p = cycle[phase]
                    if not p['selection']['ranges']:
                        paint = 'd3null'
                    for name, value in [(f'selection-{tag}.txt', p['selection']), (f'state-{tag}.json', p['state']),
                                        (f'paint-{paint}.json', p['paint'])]:
                        (directory / name).write_text(json.dumps(value))
                    (directory / f'library-{phase}.txt').write_text(p['libraryHash'])
                    run = subprocess.run(['python3', str(helper), 'phase', str(directory), phase,
                                          CAPTURED['baselineLibraryHash'], str(p['after']), str(p['before'])],
                                         capture_output=True, text=True, timeout=5)
                    self.assertEqual(run.returncode, 1 if index == 3 and phase == 'outward' else 0, run.stderr)
                (directory / 'cleanup.json').write_text('{"verified":true}')
                run = subprocess.run(['python3', str(helper), 'cycle', str(directory), CAPTURED['baselineLibraryHash'], '0'],
                                     capture_output=True, text=True, timeout=5)
                self.assertEqual(run.returncode, 0, run.stderr)
                run = subprocess.run(['python3', str(helper), 'summary', str(out), '1', 'HOST_REPLAY'], capture_output=True, text=True, timeout=5)
                self.assertEqual(run.returncode, code, run.stderr)
                self.assertEqual(json.loads((out / 'summary.json').read_text())['exitCode'], code)

    def test_cleanup_cli_requires_fresh_empty_state_and_successful_restore(self):
        helper = AREA / 'duo-loop-verdict.py'
        for fault in [None, 'selection', 'stale', 'restore', 'operation', 'malformed']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp) / 'cleanup'
                directory.mkdir()
                initial = {'value': {'traffic': {'installed': True}}}
                state = {'value': {'observedAt': 150, 'selection': None, 'result': None, 'gate': None,
                                   'traffic': None, 'error': None, 'loading': False}}
                selection = {'at': 150, 'ranges': []}
                restore = {'type': 'string', 'value': 'DuoAcceptance lookup traffic restored'}
                if fault == 'selection': selection['ranges'] = [{}]
                if fault == 'stale': state['value']['observedAt'] = 99
                if fault == 'restore': restore = {'type': 'undefined'}
                for name, value in [('initial.json', initial), ('state.json', state),
                                    ('selection.txt', selection), ('restore.json', restore)]:
                    (directory / name).write_text(json.dumps(value))
                if fault == 'malformed': (directory / 'selection.txt').write_text('{truncated')
                run = subprocess.run(['python3', str(helper), 'cleanup', str(directory), '100', '200',
                                      '1' if fault == 'operation' else '0'], capture_output=True, text=True, timeout=5)
                self.assertEqual(run.returncode, 0 if fault is None else 2, run.stderr)
                self.assertEqual(json.loads((directory.parent / 'cleanup.json').read_text())['verified'], fault is None)

    def test_exact_range_invariants_on_both_paths(self):
        for phase in ['outward', 'return']:
            for field, value in [('cfi', 'epubcfi(/wrong)'), ('backward', True),
                                 ('text', 'wrong'), ('section', 1), ('start', 32), ('focus', 36)]:
                with self.subTest(phase=phase, field=field):
                    m = self.clean()
                    m['cycles'][0][phase]['selection']['ranges'][0][field] = value
                    self.replay(m, 1, 'APP_RED')

    def test_lookup_request_result_and_library_invariants(self):
        for phase in ['outward', 'return']:
            for change in ['duplicate', 'aborted', 'failed', 'status', 'task', 'result', 'library']:
                with self.subTest(phase=phase, change=change):
                    m = self.clean()
                    p = m['cycles'][0][phase]
                    st = p['state']['value']
                    if change == 'duplicate':
                        st['traffic']['requests'] *= 2
                    elif change in ['aborted', 'failed']:
                        st['traffic']['requests'][0][change + 'At'] = st['observedAt']
                    elif change == 'status':
                        st['traffic']['requests'][0]['status'] = 500
                    elif change == 'task':
                        st['selection']['attempt'] += 1
                    elif change == 'result':
                        st['result']['text'] += ' changed'
                    else:
                        p['libraryHash'] = 'a' * 64
                    self.replay(m, 1, 'APP_RED')

    def test_invalid_baseline_never_compares_missing_values_equal(self):
        for key in ['selection', 'state', 'paint', 'libraryHash']:
            with self.subTest(key=key):
                m = self.clean()
                del m['cycles'][0]['baseline'][key]
                self.replay(m, 2, 'CONTROL_INCOMPLETE')
        m = self.clean()
        m['cycles'][0]['baseline']['state']['value']['result'] = None
        m['cycles'][0]['outward']['state']['value']['result'] = None
        self.replay(m, 2, 'CONTROL_INCOMPLETE')

    def test_missing_stale_malformed_ambiguous_and_control_failures(self):
        for phase in ['baseline', 'outward', 'return']:
            for change in ['missing', 'stale-selection', 'stale-state', 'future', 'malformed', 'pixels',
                           'handles', 'input', 'capture', 'request-field', 'library']:
                with self.subTest(phase=phase, change=change):
                    m = self.clean()
                    p = m['cycles'][0][phase]
                    if change == 'missing':
                        del p['selection']
                    elif change == 'stale-selection':
                        p['selection']['at'] = p['after'] - 1
                    elif change == 'stale-state':
                        p['state']['value']['observedAt'] = p['after'] - 1
                    elif change == 'future':
                        p['state']['value']['observedAt'] = p['before'] + 1
                    elif change == 'malformed':
                        p['selection'] = 'truncated {'
                    elif change == 'pixels':
                        p['paint']['washShare'] = .2
                    elif change == 'handles':
                        p['paint']['handleClusters'] = 1
                    elif change in ['input', 'capture']:
                        p[change + 'Verified'] = False
                    elif change == 'request-field':
                        del p['state']['value']['traffic']['requests'][0]['status']
                    else:
                        p['libraryHash'] = ''
                    s = self.replay(m, 2, 'CONTROL_INCOMPLETE')
                    self.assertEqual(s['validCycles'], 0)

    def test_range_drop_and_paint_only_red_paths(self):
        for phase in ['outward', 'return']:
            for drop in [True, False]:
                with self.subTest(phase=phase, drop=drop):
                    m = self.clean()
                    p = m['cycles'][0][phase]
                    p['paint']['washShare'] = 0
                    if drop:
                        p['selection']['ranges'] = []
                        p['paint'] = {'mode': 'whole', 'washShare': 0}
                    self.replay(m, 1, 'APP_RED')

    def test_cleanup_uncertainty_is_sticky_and_preserves_red(self):
        m = self.clean()
        m['cycles'][0]['cleanup'] = {'verified': False, 'reason': 'restore failed'}
        s = self.replay(m, 2, 'CONTROL_INCOMPLETE')
        self.assertEqual(s['cycles'][0]['caseVerdict'], 'RETURN-PASS')
        m = copy.deepcopy(CAPTURED)
        m['cycles'][-1]['cleanup'] = {'verified': False}
        s = self.replay(m, 1, 'APP_RED')
        self.assertEqual(s['appFailedCycles'], 1)
        self.assertTrue(s['uncertainties'])

    def test_total_control_budget_does_not_reset_after_positive(self):
        m = copy.deepcopy(CAPTURED)
        m['cycles'] = [copy.deepcopy(m['cycles'][0]) for _ in range(4)]
        for i in [0, 2]:
            m['cycles'][i]['outward']['captureVerified'] = False
        s = self.replay(m, 2, 'CONTROL_INCOMPLETE')
        self.assertEqual((s['attemptedCycles'], s['validCycles'], s['controlFailedCycles']), (3, 1, 2))
        self.assertEqual(s['stopReason'], 'control-failures')

    def test_two_same_path_reds_stop_without_becoming_pass(self):
        m = copy.deepcopy(CAPTURED)
        m['cycles'] = [copy.deepcopy(m['cycles'][3]) for _ in range(3)]
        s = self.replay(m, 1, 'APP_RED')
        self.assertEqual(s['attemptedCycles'], 2)
        self.assertEqual(s['stopReason'], 'two-reds-same-path')

    def test_replay_never_calls_native_tools_or_overwrites_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tools = root / 'bin'
            tools.mkdir()
            sentinel = root / 'native-called'
            for name in ['xcrun', 'orca', 'node']:
                tool = tools / name
                tool.write_text(f'#!/bin/sh\necho {name} >> "{sentinel}"\nexit 99\n')
                tool.chmod(0o755)
            source = root / 'receipts.json'
            source.write_text(json.dumps(CAPTURED))
            out = root / 'out'
            env = {**os.environ, 'PATH': str(tools) + os.pathsep + os.environ['PATH']}
            command = ['bash', str(DRIVER), '--replay', str(source), str(out)]
            run = subprocess.run(command, env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(run.returncode, 1, run.stderr)
            self.assertFalse(sentinel.exists())
            original = (out / 'summary.json').read_bytes()
            run = subprocess.run(command, env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(run.returncode, 2)
            self.assertEqual((out / 'summary.json').read_bytes(), original)
            self.assertFalse(sentinel.exists())

    def test_phase_cli_rejects_missing_malformed_or_ambiguous_raw_answers(self):
        helper = AREA / 'duo-loop-verdict.py'
        for answer in [None, '{truncated', '{}\\n{}', 'LOG HX PROBE {"ranges":[]} garbage']:
            with self.subTest(answer=answer), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                if answer is not None:
                    (directory / 'selection-press.txt').write_text(answer)
                run = subprocess.run(['python3', str(helper), 'phase', str(directory), 'baseline',
                                      CAPTURED['baselineLibraryHash'], '100', '200'],
                                     capture_output=True, text=True, timeout=5)
                self.assertEqual(run.returncode, 2, run.stderr)
                self.assertEqual(json.loads((directory / 'verdict-baseline.json').read_text())['outcome'],
                                 'CONTROL_INCOMPLETE')

    def test_incomplete_empty_and_invalid_manifest_are_nonzero(self):
        m = self.clean()
        del m['cycles'][0]['return']
        self.replay(m, 2, 'CONTROL_INCOMPLETE')
        for m in [{}, [], {**self.clean(), 'cycles': [None]}, {**self.clean(), 'cycles': []}, {**self.clean(), 'maxCycles': 5}]:
            self.replay(m, 2, 'CONTROL_INCOMPLETE')


if __name__ == '__main__':
    unittest.main()
