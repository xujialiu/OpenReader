"""Readiness CLI against fake native tools; no simulator is contacted."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
READY = ROOT / 'test/manual-test/kit/ios_ready.py'


class ReadyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        tools = self.path / 'bin'
        tools.mkdir()
        fake = f'''#!{sys.executable}
import json,os,sys,time
from pathlib import Path
args=sys.argv[1:]
root=Path(os.environ['FAKE_ROOT'])
mode=(root/'mode').read_text() if (root/'mode').exists() else 'ok'
with (root/'calls').open('a') as log: log.write(json.dumps([Path(sys.argv[0]).name,*args])+'\\n')
if Path(sys.argv[0]).name == 'node':
 print(json.dumps({{'type':'string','value':'wrong' if mode=='bad-cdp' else 'openreader-ios-ready'}}))
elif args[:3]==['simctl','list','devices']:
 print(json.dumps({{'devices':{{'runtime':[{{'udid':'owned-device','name':'Owned Fixture','state':'Shutdown' if mode=='off' else 'Booted','isAvailable':True}}]}}}}))
elif args[:2]==['simctl','bootstatus']:
 pass
elif args[:3]==['simctl','io','owned-device']:
 if mode=='hang': time.sleep(60)
 if mode=='broken': raise SystemExit(1)
 Path(args[-1]).write_bytes(b'\\x89PNG\\r\\n\\x1a\\nfixture')
else:
 raise SystemExit(2)
'''
        for name in ('xcrun', 'node'):
            (tools / name).write_text(fake)
            (tools / name).chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.path), FAKE_ROOT=str(self.path), PATH=str(tools) + os.pathsep + os.environ['PATH'])
        self.env.pop('OPENREADER_IOS_SLOT', None)
        self.output = self.path / 'attempt'

    def tearDown(self):
        self.temp.cleanup()

    def run_ready(self, *args):
        return subprocess.run([sys.executable, str(READY), 'owned-device', str(self.output), '--timeout', '2', *args], env=self.env, capture_output=True, text=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]

    def test_healthy_device_and_app_pass(self):
        result = self.run_ready('--metro', 'http://127.0.0.1:8081')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any(call[0] == 'node' for call in self.calls()))
        self.assertEqual(json.loads((self.output / 'readiness.json').read_text())['outcome'], 'ready')

    def test_unbooted_device_is_blocked_not_booted_implicitly(self):
        (self.path / 'mode').write_text('off')
        result = self.run_ready()
        self.assertEqual(result.returncode, 69, result.stderr)
        self.assertEqual(len(self.calls()), 1)

    def test_hung_screenshot_has_a_deadline_and_does_not_retry_itself(self):
        (self.path / 'mode').write_text('hang')
        result = self.run_ready()
        self.assertEqual(result.returncode, 69, result.stderr)
        self.assertEqual(sum(call[1:3] == ['simctl', 'io'] for call in self.calls()), 1)
        self.assertTrue(list(self.output.glob('ready-*/screenshot.json')))

    def recovery(self, fixes):
        script = self.path / 'recovery.sh'
        script.write_text(f'''#!/bin/bash
printf 'recovered\\n' >> "$FAKE_ROOT/recoveries"
{'printf ok > "$FAKE_ROOT/mode"' if fixes else ':'}
''')
        return str(script)

    def test_one_explicit_recovery_then_health_recheck(self):
        (self.path / 'mode').write_text('broken')
        result = self.run_ready('--recover-script', self.recovery(True))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.path / 'recoveries').read_text().splitlines(), ['recovered'])
        self.assertTrue((self.output / 'recovery-used.json').exists())

    def test_repeated_failure_cannot_run_a_second_recovery(self):
        (self.path / 'mode').write_text('broken')
        script = self.recovery(False)
        self.assertEqual(self.run_ready('--recover-script', script).returncode, 69)
        self.assertEqual(self.run_ready('--recover-script', script).returncode, 69)
        self.assertEqual((self.path / 'recoveries').read_text().splitlines(), ['recovered'])

    def test_a_cdp_process_exiting_zero_is_not_proof_the_app_answered(self):
        (self.path / 'mode').write_text('bad-cdp')
        result = self.run_ready('--metro', 'http://127.0.0.1:8081')
        self.assertEqual(result.returncode, 69, result.stderr)
        self.assertIn('CDP', result.stderr)


if __name__ == '__main__':
    unittest.main()
