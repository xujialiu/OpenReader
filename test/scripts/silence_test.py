"""Host-only tests of real silence entries, isolated HOME and fake Apple tools.

Synthetic plist transitions exercise the recorder, not a native reset or audio.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'test/manual-test/kit'
DEVICE = '11111111-1111-1111-1111-111111111111'
OTHER = '22222222-2222-2222-2222-222222222222'
sys.path.insert(0, str(KIT))
spec = importlib.util.spec_from_file_location('silence_observe', KIT / 'silence-observe.py')
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class SilenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.home = Path(self.temporary.name)
        self.audio = self.audio_path(DEVICE)
        self.audio.parent.mkdir(parents=True)
        self.write_audio(0)
        tools = self.home / 'bin'
        tools.mkdir()
        fake = f'''#!{sys.executable}
import json,os,plistlib,sys,time
from pathlib import Path
a=sys.argv[1:]; name=Path(sys.argv[0]).name
home=Path(os.environ['HOME'])
with (home/'calls').open('a') as f: f.write(json.dumps([name,*a])+'\\n')
mode=os.environ.get('FAKE_MODE','')
if name=='xcrun':
 if a[:3]!=['simctl','list','devices']: raise SystemExit(90)
 if mode=='tool-failure' or (mode=='end-failure' and len((home/'calls').read_text().splitlines())==2):
  print('listing unavailable'); raise SystemExit(1)
 if mode=='hang': time.sleep(60)
 if mode=='malformed-list': print('{{'); raise SystemExit(0)
 state='Shutdown' if mode=='shutdown' else 'Booted'
 devices=[{{'udid':{DEVICE!r},'name':'Fixture','state':state,'isAvailable':True}}]
 if mode=='two-devices': devices.append({{'udid':{OTHER!r},'name':'Other','state':'Booted','isAvailable':True}})
 if '--json' in a: print(json.dumps({{'devices':{{'runtime':devices}}}}))
 else:
  for d in devices: print(f"{{d['name']}} ({{d['udid']}}) ({{d['state']}})")
elif name=='plutil':
 if mode=='plutil-failure': raise SystemExit(1)
 p=Path(a[-1])
 if not p.is_relative_to(home): raise SystemExit(93)
 try: data=plistlib.loads(p.read_bytes())
 except Exception: raise SystemExit(1)
 if a[:4]==['-replace','sim_volume','-integer','0']:
  data['sim_volume']=0; p.write_bytes(plistlib.dumps(data))
 elif a==['-extract','sim_volume','raw','-o','-',str(p)]:
  if 'sim_volume' not in data: raise SystemExit(1)
  value=data['sim_volume']
  print(str(value).lower() if type(value) is bool else value)
 else: raise SystemExit(91)
else: raise SystemExit(92)
'''
        # Explicit denials prevent a future shell regression from reaching
        # host-volume/defaults/audio tools even while this test goes red.
        for name in ('xcrun', 'plutil', 'osascript', 'defaults', 'afplay', 'xcodebuild'):
            tool = tools / name
            tool.write_text(fake)
            tool.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), PATH=str(tools) + os.pathsep + os.environ['PATH'],
                        PYTHONDONTWRITEBYTECODE='1')
        self.env.pop('OPENREADER_IOS_SLOT', None)

    def tearDown(self):
        self.temporary.cleanup()

    def audio_path(self, device):
        return self.home / f'Library/Developer/CoreSimulator/Devices/{device}/data/var/run/simulatoraudio/audiosettings.plist'

    def write_audio(self, volume):
        self.audio.write_bytes(plistlib.dumps({'sim_volume': volume, 'sim_output_device_uid': 'fixture-route',
                                               'sim_input_device_uid': 'fixture-input', 'sim_ringer_state': 1}))

    def shell_check(self, device=DEVICE):
        # The marker stands in for Play; it must never run after a refusal.
        return subprocess.run(['bash', '-c', 'bash "$1" check "${@:3}" && touch "$2"',
                               'test', str(KIT / 'silence.sh'), str(self.home / 'would-play'), *([device] if device else [])],
                              env=self.env, text=True, capture_output=True, timeout=3)

    def record(self, label='checkpoint', seconds=0, extra=()):
        return subprocess.run([sys.executable, str(KIT / 'silence-observe.py'), DEVICE, str(self.home / label),
                               '--seconds', str(seconds), '--interval', '.25', '--label', label, *extra],
                              env=self.env, text=True, capture_output=True, timeout=4)

    def result(self, label='checkpoint'):
        return json.loads((self.home / label / 'result.json').read_text())

    def calls(self):
        path = self.home / 'calls'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_real_check_accepts_zero_and_is_read_only(self):
        raw = self.audio.read_bytes()
        reply = self.shell_check()
        self.assertEqual(reply.returncode, 0, reply.stderr)
        self.assertIn('sim_volume=0', reply.stdout)
        self.assertTrue((self.home / 'would-play').exists())
        self.assertEqual(self.audio.read_bytes(), raw)

    def test_real_check_fails_closed_for_nonzero_missing_malformed_and_tool_errors(self):
        cases = ('nonzero', 'missing-file', 'missing-key', 'malformed', 'invalid-value', 'plutil-failure', 'tool-failure', 'shutdown')
        for case in cases:
            with self.subTest(case=case):
                self.env.pop('FAKE_MODE', None)
                self.write_audio(0)
                if case == 'nonzero': self.write_audio(60)
                elif case == 'missing-file': self.audio.unlink()
                elif case == 'missing-key': self.audio.write_bytes(plistlib.dumps({}))
                elif case == 'malformed': self.audio.write_bytes(b'not a plist')
                elif case == 'invalid-value': self.write_audio('unknown')
                else: self.env['FAKE_MODE'] = case
                before = self.audio.read_bytes() if self.audio.exists() else None
                reply = self.shell_check()
                self.assertNotEqual(reply.returncode, 0, reply.stdout)
                self.assertFalse((self.home / 'would-play').exists(), case)
                self.assertEqual(self.audio.read_bytes() if self.audio.exists() else None, before)
                if case == 'nonzero':
                    self.assertEqual(reply.returncode, 2)
                    self.assertIn('volume 60', reply.stderr)

    def test_real_set_only_changes_named_device_volume(self):
        other = self.audio_path(OTHER)
        other.parent.mkdir(parents=True)
        other.write_bytes(self.audio.read_bytes())
        untouched = hashlib.sha256(other.read_bytes()).hexdigest()
        self.write_audio(60)
        reply = subprocess.run(['bash', str(KIT / 'silence.sh'), 'set', DEVICE], env=self.env,
                               capture_output=True, text=True, timeout=3)
        self.assertEqual(reply.returncode, 0, reply.stderr)
        values = plistlib.loads(self.audio.read_bytes())
        self.assertEqual(values, {'sim_volume': 0, 'sim_output_device_uid': 'fixture-route',
                                  'sim_input_device_uid': 'fixture-input', 'sim_ringer_state': 1})
        self.assertEqual(hashlib.sha256(other.read_bytes()).hexdigest(), untouched)
        self.assertEqual(self.shell_check().returncode, 0)
        self.assertTrue(all(call[0] in ('plutil', 'xcrun') for call in self.calls()))

    def test_real_check_refuses_ambiguous_automatic_device_selection(self):
        self.env['FAKE_MODE'] = 'two-devices'
        reply = self.shell_check(device=None)
        self.assertEqual(reply.returncode, 2)
        self.assertFalse((self.home / 'would-play').exists())

    def test_observer_retains_raw_hash_route_file_times_and_boot_checkpoints(self):
        before = self.audio.read_bytes()
        reply = self.record()
        self.assertEqual(reply.returncode, 0, reply.stderr)
        result = self.result()
        self.assertEqual(result['outcome'], 'zero-in-sampled-plists')
        self.assertEqual(result['samples'], 1)
        self.assertFalse(result['zeroToNonzeroObserved'])
        output = self.home / 'checkpoint'
        entry = json.loads((output / 'samples.jsonl').read_text())
        self.assertEqual((output / entry['raw']).read_bytes(), before)
        self.assertEqual(entry['sha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(entry['outputDeviceUID'], 'fixture-route')
        self.assertEqual(entry['before'], entry['after'])
        self.assertEqual(entry['before']['mtimeNs'], self.audio.stat().st_mtime_ns)
        self.assertEqual(self.audio.read_bytes(), before)
        for label in ('boot-start', 'boot-end'):
            self.assertEqual(json.loads((output / f'{label}.json').read_text())['device']['state'], 'Booted')
        self.assertEqual(self.calls(), [['xcrun', 'simctl', 'list', 'devices', '--json']] * 2)
        self.assertFalse((self.home / 'Library/Caches/OpenReader/ios-verification.lock').exists())

    def test_observer_initial_nonzero_is_not_called_a_reset(self):
        self.write_audio(60)
        reply = self.record()
        self.assertEqual(reply.returncode, 3, reply.stderr)
        self.assertEqual(self.result()['outcome'], 'nonzero-observed')
        self.assertFalse(self.result()['zeroToNonzeroObserved'])
        self.assertEqual(plistlib.loads(self.audio.read_bytes())['sim_volume'], 60)

    def test_observer_stops_at_first_synthetic_zero_to_nonzero_transition(self):
        output = self.home / 'transition'
        process = subprocess.Popen([sys.executable, str(KIT / 'silence-observe.py'), DEVICE, str(output),
                                    '--seconds', '2', '--interval', '.25', '--label', 'transition'],
                                   env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 2
            while not (output / 'sample-0000.plist').exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue((output / 'sample-0000.plist').exists(), 'first zero sample missing')
            # Atomic replacement is the controlled fixture input, NOT a device reset.
            temporary = self.audio.with_suffix('.next')
            temporary.write_bytes(plistlib.dumps({'sim_volume': 60, 'sim_output_device_uid': 'fixture-route'}))
            temporary.replace(self.audio)
            _, err = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 3, err)
            self.assertTrue(self.result('transition')['zeroToNonzeroObserved'])
            entries = [json.loads(line) for line in (output / 'samples.jsonl').read_text().splitlines()]
            self.assertEqual([entry['volume'] for entry in entries], [0, 60])
        finally:
            if process.poll() is None: process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()

    def test_observer_blocks_invalid_or_missing_plists_and_preserves_bad_bytes(self):
        for index, raw in enumerate((b'broken', b'<?xml version="1.0"?><plist>', plistlib.dumps({}),
                                     plistlib.dumps({'sim_volume': '0', 'sim_output_device_uid': 'route'}))):
            with self.subTest(raw=raw):
                self.audio.write_bytes(raw)
                label = f'invalid-{index}'
                reply = self.record(label)
                self.assertEqual(reply.returncode, 69, reply.stderr)
                self.assertEqual(self.result(label)['outcome'], 'blocked')
                self.assertEqual((self.home / label / 'sample-0000.plist').read_bytes(), raw)
        self.audio.unlink()
        self.assertEqual(self.record('missing').returncode, 69)
        self.assertEqual(self.result('missing')['outcome'], 'blocked')

    def test_observer_rejects_racing_file_identity(self):
        changed = self.audio.stat()
        with patch.object(observer, 'identity', side_effect=[{'inode': 1}, {'inode': 1}, {'inode': 2}]):
            entry = observer.sample(self.audio, self.home, 0)
        self.assertFalse(entry['valid'])
        self.assertIn('changed during the read', entry['error'])
        self.assertEqual(self.audio.stat(), changed)

    def test_observer_fails_closed_for_broken_listing_and_bounded_timeout(self):
        for mode in ('tool-failure', 'malformed-list', 'shutdown', 'hang'):
            self.env['FAKE_MODE'] = mode
            reply = self.record(mode, extra=('--command-timeout', '.1'))
            self.assertEqual(reply.returncode, 69, reply.stderr)
            self.assertEqual(self.result(mode)['outcome'], 'blocked')
            self.assertEqual(self.result(mode)['samples'], 0)
            if mode == 'hang':
                command = json.loads((self.home / mode / 'boot-start-command.json').read_text())
                self.assertEqual(command['outcome'], 'timeout')

    def test_observer_end_checkpoint_failure_cannot_pass_the_window(self):
        self.env['FAKE_MODE'] = 'end-failure'
        reply = self.record()
        self.assertEqual(reply.returncode, 69, reply.stderr)
        self.assertEqual(self.result()['outcome'], 'blocked')
        self.assertEqual(self.result()['samples'], 1)
        self.assertTrue((self.home / 'checkpoint/sample-0000.plist').exists())
        self.assertIn('boot-end failed', self.result()['reason'])

    def test_observer_cancellation_retains_partial_samples_and_nonpassing_result(self):
        output = self.home / 'cancelled'
        process = subprocess.Popen([sys.executable, str(KIT / 'silence-observe.py'), DEVICE, str(output),
                                    '--seconds', '10', '--interval', '.25', '--label', 'cancelled'],
                                   env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 2
            while not (output / 'sample-0000.plist').exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue((output / 'sample-0000.plist').exists())
            process.send_signal(signal.SIGTERM)
            _, err = process.communicate(timeout=2)
            self.assertEqual(process.returncode, 143, err)
            self.assertEqual(self.result('cancelled')['outcome'], 'cancelled')
            self.assertEqual(self.result('cancelled')['exitCode'], 143)
            self.assertTrue((output / 'samples.jsonl').read_text())
        finally:
            if process.poll() is None: process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()

    def test_observer_refuses_existing_output_and_unbounded_parameters(self):
        self.assertEqual(self.record().returncode, 0)
        raw = (self.home / 'checkpoint/result.json').read_bytes()
        self.assertEqual(self.record().returncode, 2)
        self.assertEqual((self.home / 'checkpoint/result.json').read_bytes(), raw)
        for name, value in (('--seconds', 'nan'), ('--seconds', '601'), ('--interval', '0'), ('--command-timeout', 'inf')):
            reply = self.record('bad-parameters', extra=(name, value))
            self.assertEqual(reply.returncode, 2, reply.stderr)
        self.assertFalse((self.home / 'bad-parameters').exists())


if __name__ == '__main__':
    unittest.main()
