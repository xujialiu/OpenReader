"""The real shell entry with fake Apple tools. Never contacts a device."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / 'test/manual-test/kit/run-probe.sh'
DEVICE = '11111111-1111-1111-1111-111111111111'


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.output = self.path / 'probe'
        (self.output / 'ManualTests.xcodeproj').mkdir(parents=True)
        (self.output / 'probe.txt').write_text(f'SettingsVersionProbe from {ROOT}\n')
        audio = self.path / f'Library/Developer/CoreSimulator/Devices/{DEVICE}/data/var/run/simulatoraudio/audiosettings.plist'
        audio.parent.mkdir(parents=True)
        audio.touch()
        tools = self.path / 'bin'
        tools.mkdir()
        fake = f'''#!{sys.executable}
import json,os,sys,time
from pathlib import Path
a=sys.argv[1:]; name=Path(sys.argv[0]).name
root=Path(os.environ['FAKE_ROOT'])
with (root/'calls').open('a') as f: f.write(json.dumps([name,*a])+'\\n')
if name=='plutil':
 if '-extract' in a: print(0)
elif name=='xcrun':
 if a[:3]==['simctl','list','devices']:
  if '--json' in a: print(json.dumps({{'devices':{{'runtime':[{{'udid':{DEVICE!r},'name':'Fixture','state':'Booted','isAvailable':True}}]}}}}))
  else: print('Fixture ({DEVICE}) (Booted)')
 elif a[:2]==['simctl','bootstatus']: pass
 elif a[:2]==['simctl','io']: Path(a[-1]).write_bytes(b'\\x89PNG\\r\\n\\x1a\\nfixture')
 elif a[:2]==['simctl','terminate']: pass
 elif a[:3]==['xcresulttool','export','attachments']: pass
 elif a[:3]==['xcresulttool','get','test-results']:
  print(json.dumps({{'result':'Failed' if os.environ.get('FAKE_BAD_SUMMARY')=='1' else 'Passed','failedTests':1 if os.environ.get('FAKE_BAD_SUMMARY')=='1' else 0,'passedTests':1,'totalTestCount':2 if os.environ.get('FAKE_BAD_SUMMARY')=='1' else 1}}))
 else: raise SystemExit(2)
elif name=='xcodebuild':
 if a[-1]=='build-for-testing': print('** BUILD SUCCEEDED **'); raise SystemExit(0)
 if os.environ.get('FAKE_HANG')=='1': time.sleep(60)
 result=Path(a[a.index('-resultBundlePath')+1]); result.mkdir()
 if os.environ.get('FAKE_PARTIAL')!='1': (result/'Info.plist').write_text('complete')
 print('Executed 1 test, with 0 failures')
 print('** TEST SUCCEEDED **')
'''
        for name in ('xcrun', 'xcodebuild', 'plutil'):
            (tools / name).write_text(fake)
            (tools / name).chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.path), FAKE_ROOT=str(self.path), PATH=str(tools)+os.pathsep+os.environ['PATH'], OPENREADER_PROBE_BUILD_SECONDS='10', OPENREADER_PROBE_TEST_SECONDS='1')
        self.env.pop('OPENREADER_IOS_SLOT', None)

    def tearDown(self):
        self.temp.cleanup()

    def run_probe(self):
        process = subprocess.Popen(['bash', str(RUNNER), 'SettingsVersionProbe', DEVICE, str(self.output)], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            out, err = process.communicate(timeout=8)
            return process.returncode, out, err
        except subprocess.TimeoutExpired:
            self.fail('run-probe did not enforce its own deadline')
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            process.stdout.close()
            process.stderr.close()

    def calls(self):
        return [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]

    def test_build_and_test_have_separate_phases(self):
        status, _, err = self.run_probe()
        self.assertEqual(status, 0, err)
        self.assertEqual([call[-1] for call in self.calls() if call[0]=='xcodebuild'], ['build-for-testing','test-without-building'])
        self.assertEqual(len(list(self.output.glob('build-*.json'))), 1)
        self.assertEqual(len(list(self.output.glob('test-*.json'))), 1)

    def test_timeout_preserves_record_and_stops_target_app(self):
        self.env['FAKE_HANG'] = '1'
        status, _, err = self.run_probe()
        self.assertEqual(status, 124, err)
        self.assertTrue(any(call[1:3]==['simctl','terminate'] for call in self.calls()))
        self.assertFalse(any(call[1:3]==['xcresulttool','export'] for call in self.calls()))

    def test_zero_exit_and_one_passing_log_line_cannot_hide_a_failed_result(self):
        self.env['FAKE_BAD_SUMMARY'] = '1'
        status, _, _ = self.run_probe()
        self.assertEqual(status, 69)

    def test_partial_result_is_not_a_pass_and_is_not_exported(self):
        self.env['FAKE_PARTIAL'] = '1'
        status, _, _ = self.run_probe()
        self.assertNotEqual(status, 0)
        self.assertFalse(any(call[1:3]==['xcresulttool','export'] for call in self.calls()))


if __name__ == '__main__':
    unittest.main()
