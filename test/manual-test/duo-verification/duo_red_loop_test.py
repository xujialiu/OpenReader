#!/usr/bin/env python3
"""HOST only: execute the actual shell driver's shared receipt/verdict path."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import shlex
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

    def test_cleanup_window_selector_passes_title_as_argument(self):
        source = DRIVER.read_text()
        marker = "WIDC=\"$(python3 - \"$clean/windows.json\" \"$HUB_WINDOW_TITLE\" <<'WINDOW'"
        self.assertIn(marker, source)
        program = source.split("<<'WINDOW'\n", 1)[1].split('\nWINDOW', 1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            windows = Path(tmp) / 'windows.json'
            windows.write_text(json.dumps({'result': {'windows': [
                {'id': 7, 'title': 'owned-window – iOS 27.1'},
                {'id': 8, 'title': 'other-window – iOS 27.1'},
            ]}}))
            run = subprocess.run(['python3', '-', str(windows), 'owned-window'], input=program,
                                 capture_output=True, text=True, timeout=5)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout.strip(), '7')

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

    def retained_phase_files(self, directory, index):
        directory.mkdir(parents=True)
        helper = AREA / 'duo-loop-verdict.py'
        for phase, tag, paint in [('baseline', 'press', 'press'), ('outward', 'd3', 'd3'), ('return', 'return', 'ret')]:
            if phase not in CAPTURED['cycles'][index]:
                continue
            p = CAPTURED['cycles'][index][phase]
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

    def test_live_cleanup_parse_failure_cannot_omit_red(self):
        helper = AREA / 'duo-loop-verdict.py'
        for cleanup in ['truncated', 'unreadable']:
            with self.subTest(cleanup=cleanup), tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                first, second = out / 'cycle-1', out / 'cycle-2'
                self.retained_phase_files(first, 3)
                if cleanup == 'truncated':
                    (first / 'cleanup.json').write_text('{truncated')
                else:
                    (first / 'cleanup.json').mkdir()
                cycle = subprocess.run(['python3', str(helper), 'cycle', str(first), CAPTURED['baselineLibraryHash'], '2'],
                                       capture_output=True, text=True, timeout=5)
                self.retained_phase_files(second, 0)
                (second / 'cleanup.json').write_text('{"verified":true}')
                subprocess.run(['python3', str(helper), 'cycle', str(second), CAPTURED['baselineLibraryHash'], '0'],
                               check=True, capture_output=True, timeout=5)
                summary = subprocess.run(['python3', str(helper), 'summary', str(out), '1', 'HOST_REPLAY'],
                                         capture_output=True, text=True, timeout=5)
                self.assertEqual(summary.returncode, 1, summary.stdout + cycle.stderr)
                result = json.loads((out / 'summary.json').read_text())
                self.assertEqual((result['attemptedCycles'], result['appFailedCycles'], result['validCycles']), (2, 1, 1))
                self.assertTrue(result['uncertainties'])
                self.assertEqual(cycle.returncode, 0, cycle.stderr)

    def test_summary_represents_attempts_without_cycle_verdict(self):
        helper = AREA / 'duo-loop-verdict.py'
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.retained_phase_files(out / 'cycle-1', 3)
            (out / 'cycle-1/cleanup.json').write_text('{"verified":true}')
            (out / 'cycle-2').mkdir()
            run = subprocess.run(['python3', str(helper), 'summary', str(out), '1', 'HOST_REPLAY'],
                                 capture_output=True, text=True, timeout=5)
            self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
            result = json.loads((out / 'summary.json').read_text())
            self.assertEqual(result['attemptedCycles'], 2)
            self.assertEqual(result['appFailedCycles'], 1)
            self.assertEqual(result['validCycles'], 0)
            self.assertTrue(result['uncertainties'])

    def test_actual_live_shell_stops_on_cycle_aggregator_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            templates = root / 'templates'
            self.retained_phase_files(templates / '1', 3)
            self.retained_phase_files(templates / '2', 0)
            (templates / '1/cleanup.json').write_text('{truncated')
            (templates / '2/cleanup.json').write_text('{"verified":true}')
            out = root / 'run'
            out.mkdir()
            loop = DRIVER.read_text().split('CYCLE=0\n', 1)[1]
            script = 'set -uo pipefail\n' + '\n'.join([
                'RUN=' + shlex.quote(str(out)), 'ORACLE=' + shlex.quote(str(AREA / 'duo-loop-verdict.py')),
                'TEMPLATES=' + shlex.quote(str(templates)), 'MAX_CYCLES=1; CYCLE=0; PIN=HOST-NOT-NATIVE',
                'note(){ echo "HOST SHELL SEAM: $*"; }',
                'libhash(){ echo ' + CAPTURED['baselineLibraryHash'] + '; }',
                'run_cycle(){ cp "$TEMPLATES/$CYCLE/"* "$RUN/cycle-$CYCLE/"; }',
                'cleanup_cycle(){ [ "$CYCLE" != 1 ]; }',
                'python3(){ if [ "$2" = cycle ] && [ "$CYCLE" = 1 ]; then return 77; fi; command python3 "$@"; }',
            ]) + '\n' + loop
            run = subprocess.run(['bash', '-c', script], capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
            result = json.loads((out / 'summary.json').read_text())
            self.assertEqual(result['attemptedCycles'], 1)
            self.assertEqual(result['appFailedCycles'], 1)
            self.assertTrue(result['uncertainties'])
            self.assertFalse((out / 'cycle-2').exists())

    def test_replay_malformed_attempt_does_not_erase_prior_red(self):
        m = copy.deepcopy(CAPTURED)
        m['cycles'] = [m['cycles'][3], None]
        result = self.replay(m, 1, 'APP_RED')
        self.assertEqual((result['attemptedCycles'], result['appFailedCycles'], result['controlFailedCycles']), (2, 1, 1))
        self.assertTrue(result['uncertainties'])
        m['cycles'] = [CAPTURED['cycles'][0], None]
        result = self.replay(m, 2, 'CONTROL_INCOMPLETE')
        self.assertEqual((result['attemptedCycles'], result['validCycles']), (2, 1))

    def test_restricted_capture_binds_one_invocation_and_png_clock_interval(self):
        # HOST fake executor only; executes the real shell capture function, never a native tool.
        from PIL import Image
        function = DRIVER.read_text().split('restricted_capture(){', 1)[1].split('# Measurement only.', 1)[0]
        function = 'restricted_capture(){' + function
        for fault in ['honest', 'future-stale-pair', 'future-log', 'future-png', 'old-png',
                      'mismatched-stamps', 'mismatched-attachments', 'stale-receipt', 'missing-receipt', 'duplicate-receipt',
                      'preexisting-raw-aliases', 'mismatched-raw-alias-stamps', 'parent-alias-honest']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                capture, kit, out = root / 'capture', root / 'kit', root / 'run'
                capture.mkdir(); kit.mkdir(); (out / 'cycle-1').mkdir(parents=True)
                if fault == 'future-stale-pair':
                    old = capture / 'attachments-99999999-old'
                    old.mkdir()
                    for name, size in [('outer', (1398, 2034)), ('inner', (2006, 2852))]:
                        Image.new('RGB', size, 'blue').save(old / (name + '.png'))
                    log = capture / 'test-99999999-old.log'
                    log.write_text('restricted-v2 owned-panels-only started\nscreen 0 captured\nscreen 1 captured\n')
                    for path in [log, old, *old.glob('*.png')]:
                        os.utime(path, (time.time() + 60, time.time() + 60))
                if fault in ['preexisting-raw-aliases', 'mismatched-raw-alias-stamps']:
                    # Advertised aliases exist BEFORE capture-start; canonical B targets do not.
                    (capture / 'result-20261108-135959-11111.xcresult').symlink_to(
                        capture / 'result-20261108-140000-12345.xcresult', target_is_directory=True)
                    log_stamp = '20261108-135958-22222' if fault == 'mismatched-raw-alias-stamps' else '20261108-135959-11111'
                    (capture / ('test-' + log_stamp + '.log')).symlink_to(capture / 'test-20261108-140000-12345.log')
                if fault == 'parent-alias-honest':
                    (root / 'parent-alias').symlink_to(root, target_is_directory=True)
                fake = kit / 'run-probe.sh'
                fake.write_text("""#!/bin/bash
python3 - "$3" "$HOST_CAPTURE_FAULT" <<'HOST'
import os, sys, time
from pathlib import Path
from PIL import Image
out, fault = Path(sys.argv[1]), sys.argv[2]
stamp = '20261108-140000-12345'
log = out / ('test-' + stamp + '.log')
result = out / ('result-' + stamp + '.xcresult')
result.mkdir(); (result / 'Info.plist').write_text('HOST ONLY')
log.write_text('restricted-v2 owned-panels-only started\\nscreen 0 captured\\nscreen 1 captured\\n')
(out / ('summary-' + stamp + '.json')).write_text('{"result":"Passed","failedTests":0,"passedTests":1}')
(out / ('export-' + stamp + '.log')).write_text('HOST export complete')
atts = out / ('attachments-' + ('different' if fault == 'mismatched-attachments' else stamp)); atts.mkdir()
for name, size in [('outer', (1398,2034)), ('inner', (2006,2852))]:
    path = atts / (name + '.png'); Image.new('RGB', size, 'white').save(path)
    if fault in ['old-png','future-png']:
        when = time.time() + (60 if fault == 'future-png' else -60); os.utime(path, (when,when))
if fault == 'future-log':
    when = time.time()+60; os.utime(log,(when,when))
if fault == 'mismatched-stamps': result = out / 'result-different.xcresult'
if fault == 'stale-receipt': log = out / 'test-old.log'; result = out / 'result-old.xcresult'
if fault in ['preexisting-raw-aliases', 'mismatched-raw-alias-stamps']:
    result = out / 'result-20261108-135959-11111.xcresult'
    log_stamp = '20261108-135958-22222' if fault == 'mismatched-raw-alias-stamps' else '20261108-135959-11111'
    log = out / ('test-' + log_stamp + '.log')
if fault == 'parent-alias-honest':
    parent = out.parent / 'parent-alias' / out.name
    result, log = parent / result.name, parent / log.name
line = f'Artifacts: {out} (result: {result}, log: {log})'
if fault != 'missing-receipt': print(line)
if fault == 'duplicate-receipt': print(line)
HOST
""")
                script = 'set -uo pipefail\n' + '\n'.join([
                    'RUN=' + shlex.quote(str(out)), 'CAPDIR=' + shlex.quote(str(capture)),
                    'KIT=' + shlex.quote(str(kit)), 'ORACLE=' + shlex.quote(str(AREA / 'duo-loop-verdict.py')),
                    'CYCLE=1; UDID=HOST-NOT-NATIVE', function, 'restricted_capture d3'])
                env = {**os.environ, 'HOST_CAPTURE_FAULT': fault}
                run = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True, timeout=15)
                if fault in ['honest', 'future-stale-pair', 'parent-alias-honest']:
                    self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
                    with Image.open(out / 'cycle-1/d3-inner-oriented.png') as image:
                        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255), 'stale painted image substituted')
                else:
                    self.assertNotEqual(run.returncode, 0, fault + ': ' + run.stdout + run.stderr)

    def test_invalid_native_cli_arguments_are_control_errors(self):
        for args in [[], ['owned', 'metro', 'out'], ['', 'metro', 'out', 'pin', 'capture', 'press'],
                     ['owned', 'metro', 'out', 'pin', 'capture', 'press', '5']]:
            with self.subTest(args=args):
                run = subprocess.run(['bash', str(DRIVER), *args], capture_output=True, text=True, timeout=5)
                self.assertEqual(run.returncode, 2, run.stdout + run.stderr)

    def test_incomplete_empty_and_invalid_manifest_are_nonzero(self):
        m = self.clean()
        del m['cycles'][0]['return']
        self.replay(m, 2, 'CONTROL_INCOMPLETE')
        for m in [{}, [], {**self.clean(), 'cycles': [None]}, {**self.clean(), 'cycles': []}, {**self.clean(), 'maxCycles': 5}]:
            self.replay(m, 2, 'CONTROL_INCOMPLETE')


if __name__ == '__main__':
    unittest.main()
