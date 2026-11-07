#!/usr/bin/env python3
"""#355 HOST helper tests: synthetic/replayed pixels and isolated fake Mac tools.

No installed app/container, GUI, Apple tool, audio or native bug path is used.
"""
import copy
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name('mac-selection-paint.py')
SPEC = importlib.util.spec_from_file_location('mac_selection_paint', SCRIPT)
LOOP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOOP)


def fixture_image(path, width=700, painted=True):
    image = Image.new('RGB', (width, 400), (17, 17, 20))
    draw = ImageDraw.Draw(image)
    if painted:
        draw.rectangle((8, 80, 84, 125), fill=(26, 42, 65))
    # Fixed bright glyph mask, not dependent on a host font installation.
    for x in [14, 32, 50, 68]:
        draw.rectangle((x, 86, x + 6, 117), fill=(197, 212, 237))
    draw.rectangle((300, 300, 330, 330), fill=(50, 110, 240))  # unrelated blue icon
    image.save(path)


def checkpoint(path, role, at, width, calibration, kind='host-synthetic'):
    return dict(kind=kind, role=role, capturedAt=at, captureId=role,
        image=str(path), imageSha256=LOOP.sha(path), imagePixels=[width, 400], scale=2,
        window=dict(pid=222, id=99, path='/fake/OpenReader.app', bundleId=LOOP.BUNDLE,
                    frontmost=True, keyWindow=True, x=10, y=20, width=width / 2, height=200),
        paused=True, version='1.0.4 (30)-beta17-debug', bundleSha256='a' * 64,
        range=dict(text='Even', section=0, cfi='epubcfi(/6/2!/4/4/1,0,4)', start=0, end=4,
                   anchor=0, focus=4, rects=[[0, 1, 2, 3]]), query='Even', service='Youdao', count=1,
        definitionSha256='b' * 64, calibrationSha256=calibration['imageSha256'])


class MacSelectionPaintOracleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mac-paint-host-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / 'baseline.png'
        self.control = self.root / 'control.png'
        self.after = self.root / 'after.png'
        fixture_image(self.base); fixture_image(self.control); fixture_image(self.after, 440)
        self.cal = dict(image=str(self.base), imageSha256=LOOP.sha(self.base), imagePixels=[700, 400],
                        scale=2, nativeSize=[350, 200], cropPixels=[8, 80, 77, 46], guardPixels=[90, 80, 20, 46])
        self.pair = dict(kind='host-synthetic', calibration=self.cal,
            baseline=checkpoint(self.base, 'baseline', 100, 700, self.cal),
            control=checkpoint(self.control, 'control', 101, 700, self.cal),
            after=checkpoint(self.after, 'after', 102, 440, self.cal))

    def test_synthetic_preserved_paint_is_green(self):
        result, code = LOOP.assert_pair(self.pair)
        self.assertEqual((result['status'], code), ('HOST_SYNTHETIC_PAINT_PRESERVED', 0))

    def test_paint_removed_external_copy_is_red_despite_blue_icon_and_retained_range(self):
        original_hash = LOOP.sha(self.base)
        fixture_image(self.after, 440, painted=False)
        self.pair['after']['imageSha256'] = LOOP.sha(self.after)
        result, code = LOOP.assert_pair(self.pair)
        self.assertEqual((result['status'], code), ('HOST_SYNTHETIC_PAINT_LOST', 1))
        self.assertEqual(result['measurements'][2]['blue'], 0)
        self.assertEqual(LOOP.sha(self.base), original_hash)

    def test_invalid_controls_are_blocked_not_app_failures(self):
        mutations = [
            ('range', lambda p: p['after'].pop('range')),
            ('CFI', lambda p: p['after']['range'].update(cfi='epubcfi(elsewhere)')),
            ('offset', lambda p: p['after']['range'].update(end=5)),
            ('window', lambda p: p['after']['window'].update(id=98)),
            ('PID', lambda p: p['after']['window'].update(pid=333)),
            ('path', lambda p: p['after']['window'].update(path='/wrong')),
            ('dimensions', lambda p: p['after'].update(imagePixels=[700, 400])),
            ('scale', lambda p: p['after'].update(scale=3)),
            ('calibration', lambda p: p['after'].update(calibrationSha256='f' * 64)),
            ('service', lambda p: p['after'].update(service='Free Dictionary API')),
            ('count', lambda p: p['after'].update(count=2)),
            ('query', lambda p: p['after'].update(query='hope')),
            ('result', lambda p: p['after'].update(definitionSha256='c' * 64)),
            ('active', lambda p: p['after']['window'].update(frontmost=False)),
            ('key', lambda p: p['after']['window'].update(keyWindow=False)),
            ('paused', lambda p: p['after'].update(paused=False)),
            ('capture', lambda p: p['after'].update(captureId='control')),
            ('stale', lambda p: p['after'].update(capturedAt=99)),
            ('no resize', lambda p: p['after']['window'].update(width=350)),
        ]
        for name, mutate in mutations:
            pair = copy.deepcopy(self.pair); mutate(pair)
            with self.subTest(name=name), self.assertRaises((ValueError, KeyError)):
                LOOP.assert_pair(pair)
        native = copy.deepcopy(self.pair); native['kind'] = 'native'
        for role in ['baseline', 'control', 'after']:
            native[role]['kind'] = 'native'
        with self.assertRaisesRegex(ValueError, 'Stale native capture'):
            LOOP.assert_pair(native, now=1000)

    def test_real_90_point_shrink_is_qualified_but_63_points_is_not(self):
        # Live handoff delivered 892→802 with a genuine edge drag. The old
        # >=100 guard rejected it despite stable range and registered glyphs.
        fixture_image(self.after, 520, painted=False)
        self.pair['after'] = checkpoint(self.after, 'after', 102, 520, self.cal)
        result, code = LOOP.assert_pair(self.pair)
        self.assertEqual((result['status'], code), ('HOST_SYNTHETIC_PAINT_LOST', 1))
        self.pair['after']['window']['width'] = 287
        with self.assertRaisesRegex(ValueError, 'No delivered native width shrink'):
            LOOP.assert_pair(self.pair)

    def test_missing_positive_occlusion_and_wrong_glyph_registration_block(self):
        fixture_image(self.control, painted=False)
        self.pair['control']['imageSha256'] = LOOP.sha(self.control)
        with self.assertRaisesRegex(ValueError, 'positive control'):
            LOOP.assert_pair(self.pair)
        fixture_image(self.control)
        self.pair['control']['imageSha256'] = LOOP.sha(self.control)
        image = Image.open(self.after).convert('RGB')
        ImageDraw.Draw(image).rectangle((8, 80, 84, 125), fill=(26, 42, 65))
        image.save(self.after)
        self.pair['after']['imageSha256'] = LOOP.sha(self.after)
        with self.assertRaisesRegex(ValueError, 'glyphs missing'):
            LOOP.assert_pair(self.pair)

    def test_existing_output_is_refused_without_overwriting_artifacts(self):
        sentinel = self.root / 'result.json'; sentinel.write_text('keep previous evidence')
        result = subprocess.run([sys.executable, str(SCRIPT), 'qualify', '/missing-replay', str(self.root)],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(sentinel.read_text(), 'keep previous evidence')

    def test_bounded_child_timeout_is_a_helper_failure(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            LOOP.child([sys.executable, '-c', 'import time; time.sleep(10)'], .05)

    def test_cli_red_exit_is_an_assertion_not_a_printed_diff(self):
        fixture_image(self.after, 440, painted=False)
        self.pair['after']['imageSha256'] = LOOP.sha(self.after)
        path = self.root / 'pair.json'; LOOP.save(path, self.pair)
        result = subprocess.run([sys.executable, str(SCRIPT), 'replay', str(path)], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn('HOST_SYNTHETIC_PAINT_LOST', result.stdout)


class MacSelectionPaintArchivedReplayTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('MAC_PAINT_RETEST'), 'Set MAC_PAINT_RETEST for read-only archived-image helper checks')
    def test_original_replay_and_paint_removed_external_copy(self):
        root = Path(os.environ['MAC_PAINT_RETEST'])
        source = root / 'm6-painted-before-raw.png'
        original_hash = LOOP.sha(source); original_stat = source.stat()
        with tempfile.TemporaryDirectory(prefix='mac-paint-archived-host-') as temp:
            out = Path(temp)
            result, code = LOOP.qualify(root, out)
            self.assertEqual((result['status'], code), ('HOST_REPLAY_QUALIFIED', 0))
            cal = LOOP.load(out / 'calibration.json')
            image = LOOP.pixels(cal['image'])
            band = LOOP.crop(image, cal['cropPixels'])
            before, glyph = LOOP.measure(band)
            removed = LOOP.mask(band, lambda r, g, b: 15 <= r <= 80 and b <= 120 and b - r >= 20 and b - g >= 12)
            band.paste((17, 17, 20), mask=removed)
            image.paste(band, tuple(cal['cropPixels'][:2]))
            external_copy = out / 'paint-removed-external-copy.png'; image.save(external_copy)
            after, registered_glyph = LOOP.measure(LOOP.crop(LOOP.pixels(external_copy), cal['cropPixels']))
            self.assertGreater(before['blue'], .4)
            self.assertEqual(after['blue'], 0)
            self.assertGreater(after['dark'], .5)
            self.assertGreater(LOOP.overlap(glyph, registered_glyph), .8)
            with self.assertRaisesRegex(ValueError, 'paint control'):
                LOOP.require(after['blue'] > .4 and after['bandRows'] > .5, 'Removed paint control rejected')
            self.assertNotEqual(LOOP.sha(external_copy), original_hash)
            manifest = LOOP.load(out / 'originals.json')
            self.assertEqual(manifest[0]['sha256'], original_hash)
        self.assertEqual(LOOP.sha(source), original_hash)
        self.assertEqual(source.stat().st_mtime_ns, original_stat.st_mtime_ns)
        print('HOST_REPLAY: actual painted positive accepted; paint-removed external copy rejected; originals unchanged')


# Every tool is a fake executable in an isolated HOME. This string cannot invoke
# Apple/GUI tools, connect a socket, discover apps or read the real container.
FAKE_TOOL = r'''#!PYTHON
import json, os, pathlib, sys, time
from datetime import datetime
from PIL import Image, ImageDraw
root = pathlib.Path(os.environ['FAKE_ROOT']); state = json.loads((root/'state.json').read_text())
args = sys.argv[1:]; name = pathlib.Path(sys.argv[0]).name
with (root/'calls.txt').open('a') as f: f.write(name+' '+json.dumps(args)+'\n')
def log(s):
 now=datetime.now().astimezone(); offset=now.strftime('%z')
 stamp=now.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]+' '+offset[:-2]+':'+offset[-2:]
 with (root/'home/Library/Containers/top.xujialiu.openreader/Data/Library/Application Support/debug-log/debug-log-000001.txt').open('a') as f:
  f.write(stamp+' '+s+'\n')
if name == 'ps': print(str(root/'OpenReader.app/OpenReader')); sys.exit()
if name == 'osascript':
 print(json.dumps(dict(frontmost=True,keyWindow=True,path=str(root/'OpenReader.app'),bounds=[10,20,state['width'],200]))); sys.exit()
assert name == 'orca' and args[0] == 'computer'
assert args[args.index('--app')+1] == 'pid:222' and args[args.index('--window-id')+1] == '99'
command=args[1]; extra={}
if command == 'click':
 if '--element-index' in args:
  assert args[args.index('--element-index')+1] == '29'; state['selected']=False
 else:
  assert '--click-count' in args
  assert [float(args[args.index(k)+1]) for k in ['--x','--y']] == [23.25,51.5]
  state['selected']=True; log('[hx] fetch GET https://www.youdao.com/w/Even/'); log('[lookup] dictionary GET https://www.youdao.com/w/Even/ -> 200')
if command == 'press-key':
 assert args[args.index('--key')+1] == 'Escape'; state['selected']=False
if command == 'drag' and os.environ.get('FAKE_NO_RESIZE') != '1': state['width']=int(float(args[args.index('--to-x')+1]))+3
(root/'state.json').write_text(json.dumps(state))
image=Image.new('RGB',(state['width']*2,400),(17,17,20)); d=ImageDraw.Draw(image)
painted=state['selected'] and (state['width']==350 or os.environ.get('FAKE_KEEP_PAINT')=='1')
if painted: d.rectangle((8,80,84,125),fill=(26,42,65))
for x in [14,32,50,68]: d.rectangle((x,86,x+6,117),fill=(197,212,237))
shot=root/('shot-'+str(time.time_ns())+'.png'); image.save(shot)
tree='9 heading Word Boundaries for Lookup, Secondary Actions: cancel'
if state['selected']: tree+='\n29 button Close Lookup, Secondary Actions: cancel\n36 text Even, Secondary Actions: cancel\n40 text A substantial synthetic dictionary definition for the helper test only., Secondary Actions: cancel\n42 text Youdao, Secondary Actions: cancel'
w=dict(id=99,x=10,y=20,width=state['width'],height=200,isMinimized=False,isOffscreen=False)
r=dict(snapshot=dict(app=dict(pid=222,bundleId='top.xujialiu.openreader'),window=w,coordinateSpace='window',treeText=tree),
 screenshot=dict(path=str(shot),width=image.width,height=image.height,scale=2),screenshotStatus=dict(state='captured',metadata=dict(windowId=99)))
if command!='get-app-state': r['action']=dict(targetWindowId=99,path='synthetic',delivery='background',verification=dict(state='unverified',reason='synthetic_input'))
print(json.dumps(dict(ok=True,id=str(time.time_ns()),result=r)))
'''


class MacSelectionPaintFakeDriverTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mac-paint-fake-tools-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / 'home'; self.tools = self.root / 'tools'; self.tools.mkdir()
        for name in ['ps', 'osascript', 'orca']:
            tool = self.tools / name
            tool.write_text(FAKE_TOOL.replace('PYTHON', sys.executable)); tool.chmod(0o700)
        self.data = self.home / 'Library/Containers' / LOOP.BUNDLE / 'Data'
        (self.data / 'Documents').mkdir(parents=True)
        self.logs = self.data / 'Library/Application Support/debug-log'; self.logs.mkdir(parents=True)
        (self.logs / 'version.txt').write_text('1.0.4 (30)-beta17')
        self.log = self.logs / 'debug-log-000001.txt'; self.log.touch()
        self.app = self.root / 'OpenReader.app'; self.app.mkdir()
        (self.app / 'Info.plist').write_bytes(plistlib.dumps(dict(CFBundleIdentifier=LOOP.BUNDLE,
            CFBundleShortVersionString='1.0.4', CFBundleVersion='30')))
        (self.app / 'main.jsbundle').write_text('HOST synthetic bundle, not application code')
        reference = self.root / 'reference.png'; fixture_image(reference)
        self.case = dict(authorized=True, preparedAt=time.time(), pid=222, windowId=99, app=str(self.app),
            nativeVersion='1.0.4', nativeBuild='30', bundleSha256=LOOP.sha(self.app / 'main.jsbundle'),
            container=str(self.data), seqFloor=119, version='1.0.4 (30)-beta17-debug',
            settingsImage=str(reference), settingsImageSha256=LOOP.sha(reference), settingsVersion='1.0.4 (30)-beta17-debug',
            settingsObservedAt=time.time(), settingsState=str(self.root / 'settings.json'),
            noFetchWrapper=True, orca=str(self.tools / 'orca'), baselineWidth=350, afterWidth=220,
            calibration=dict(image=str(reference), imageSha256=LOOP.sha(reference), imagePixels=[700, 400],
                scale=2, nativeSize=[350, 200], cropPixels=[8, 80, 77, 46], guardPixels=[90, 80, 20, 46]))
        LOOP.save(self.root / 'settings.json', dict(ok=True, result=dict(snapshot=dict(app=dict(pid=222),
            window=dict(id=99), treeText='Version 1.0.4 (30)-beta17-debug'))))
        self.case_path = self.root / 'case.json'; LOOP.save(self.case_path, self.case)
        LOOP.save(self.root / 'state.json', dict(width=350, selected=False))
        self.stop = threading.Event(); self.seen = set()
        self.poller = threading.Thread(target=self.consume, daemon=True); self.poller.start()
        self.addCleanup(self.join_poller)

    def join_poller(self):
        self.stop.set(); self.poller.join(2)
        self.assertFalse(self.poller.is_alive())

    def consume(self):
        while not self.stop.wait(.01):
            harness = self.data / 'Documents/harness.json'
            if not harness.exists(): continue
            try: command = LOOP.load(harness)
            except FileNotFoundError: continue
            seq = command['seq']
            if seq in self.seen: continue
            self.seen.add(seq)
            state = LOOP.load(self.root / 'state.json')
            do = command['do']
            if do == 'say': answer = '[hx] playing=false utterance=null'
            elif do == 'watchfetch': answer = '[hx] fetch watched for www.youdao.com'
            elif do == 'unbreakfetch': answer = '[hx] fetch restored'
            elif do == 'js':
                marker = __import__('re').search(r'marker:("mac-paint-[a-f0-9]+")', command['code'])[1]
                value = dict(marker=json.loads(marker), at=int(time.time() * 1000), ranges=[])
                if state['selected']:
                    value['ranges'] = [dict(text='Even', section=0, cfi='epubcfi(/6/2!/4/4/1,0,4)',
                                            start=0, end=4, anchor=0, focus=4, rects=[[0, 1, 2, 3]])]
                answer = '[probe] ' + json.dumps(value)
            else: continue
            now = datetime.now().astimezone(); offset = now.strftime('%z')
            stamp = now.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + ' ' + offset[:-2] + ':' + offset[-2:]
            with self.log.open('a') as f:
                f.write(stamp + ' ' + answer + '\n')

    def driver(self, extra=None, mode='run', output='out'):
        env = dict(os.environ, HOME=str(self.home), FAKE_ROOT=str(self.root), PATH=str(self.tools))
        env.update(extra or {})
        # The no-resize case runs the whole measured drag budget, so the bound
        # must exceed DRAG_SECONDS, not the old simulator-calibrated 30 s.
        return subprocess.run([sys.executable, str(SCRIPT), mode, str(self.case_path), str(self.root / output)],
                              env=env, text=True, capture_output=True, timeout=LOOP.DRAG_SECONDS + 20)

    def test_fake_native_protocol_exits_red_and_cleans_commands_and_wrapper(self):
        result = self.driver()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'NATIVE_PAINT_LOST')  # simulated protocol only
        self.assertIn('fetch restored', self.log.read_text())
        self.assertFalse((self.data / 'Documents/harness.json').exists())
        calls = (self.root / 'calls.txt').read_text().splitlines()
        self.assertEqual(sum('"drag"' in c for c in calls), 1)
        self.assertTrue(all(c.startswith(('ps ', 'osascript ', 'orca ')) for c in calls))
        pair = LOOP.load(self.root / 'out/pair.json')
        self.assertEqual(pair['baseline']['count'], pair['after']['count'])
        self.assertGreater(len(self.seen), 10)

    def test_fake_native_protocol_can_go_green_with_retained_paint(self):
        result = self.driver({'FAKE_KEEP_PAINT': '1'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'NATIVE_PAINT_PRESERVED')  # not native evidence

    def test_no_delivered_resize_blocks_and_restores_wrapper(self):
        result = self.driver({'FAKE_NO_RESIZE': '1'})
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertRegex(result.stdout, 'deadline|timed out|No measured delivered/settled OS width change')
        self.assertIn('fetch restored', self.log.read_text())
        self.assertFalse((self.data / 'Documents/harness.json').exists())

    def test_fake_native_reset_allows_another_unattended_assertion(self):
        red = self.driver()
        self.assertEqual(red.returncode, 1, red.stdout + red.stderr)
        reset = self.driver(mode='reset', output='reset')
        self.assertEqual(reset.returncode, 0, reset.stdout + reset.stderr)
        self.assertEqual(json.loads(reset.stdout)['status'], 'NATIVE_RESET_ONLY')
        again = self.driver(output='again')
        self.assertEqual(again.returncode, 1, again.stdout + again.stderr)
        calls = (self.root / 'calls.txt').read_text()
        self.assertIn('"--key", "Escape"', calls)
        self.assertIn('"--element-index", "29"', calls)
        self.assertFalse((self.data / 'Documents/harness.json').exists())

    def test_sequence_survives_deleted_harness_and_rejects_pending_other_writer(self):
        sender = LOOP.Sender(self.case, self.case_path)
        sender.put({'do': 'noop'}); first = sender.seq; sender.close()
        self.assertFalse((self.data / 'Documents/harness.json').exists())
        sender = LOOP.Sender(self.case, self.case_path)
        sender.put({'do': 'noop'}); second = sender.seq; sender.close()
        self.assertGreater(second, first)
        LOOP.save(self.data / 'Documents/harness.json', dict(seq=second + 1, do='play'))
        with self.assertRaisesRegex(ValueError, 'pending'):
            LOOP.Sender(self.case, self.case_path)
        self.assertEqual(LOOP.load(self.data / 'Documents/harness.json')['do'], 'play')

    def test_sender_does_not_accept_a_stale_probe_answer(self):
        self.stop.set(); self.poller.join(2)
        sender = LOOP.Sender(self.case, self.case_path)
        self.addCleanup(sender.close)
        # This stand-in writes a stale, otherwise matching line AFTER send.
        def stale_put(command):
            self.log.write_text(self.log.read_text() + '2000-01-01 00:00:00.000 +00:00 [probe] STALE\n')
        with patch.object(sender, 'put', side_effect=stale_put), self.assertRaisesRegex(ValueError, 'No fresh matching'):
            sender.ask({'do': 'js'}, r'\[probe\] STALE')


class FastAXSettleTest(unittest.TestCase):
    """Isolated fake bounds: a fast AX sample never replaces the final image."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mac-paint-settle-')
        self.addCleanup(self.temp.cleanup)
        self.loop = LOOP.NativeLoop.__new__(LOOP.NativeLoop)
        self.loop.out = Path(self.temp.name)
        self.loop.case = {'pid': 222, 'app': '/fake/OpenReader.app'}
        self.start = {'window': dict(x=10, y=20, width=350, height=200)}
        self.focus = dict(frontmost=True, keyWindow=True, path='/fake/OpenReader.app', bounds=[10, 20, 260, 200])

    def state(self, name, command='get-app-state', extra=()):
        self.calls.append((name, command))
        w = dict(x=10, y=20, width=self.final_width, height=200)
        return ({'window': w}, '')

    def run_drag(self):
        def deliver(w, target, name):
            self.calls.append((name, 'drag'))
        with patch.object(self.loop, 'state', side_effect=self.state), \
             patch.object(self.loop, 'deliver_drag', side_effect=deliver), \
             patch.object(LOOP, 'native_focus', return_value=self.focus):
            return self.loop.drag(self.start, 250, 'shrink')

    def test_drag_action_snapshot_may_precede_ax_resize_but_is_not_final_evidence(self):
        self.loop.case.update(orca='/fake/orca', windowId=99)
        self.loop.window = [10, 20, 350, 200]
        before = dict(self.focus, bounds=[10, 20, 350, 200])
        raw = dict(ok=True, result=dict(
            snapshot=dict(app=dict(pid=222, bundleId=LOOP.BUNDLE), coordinateSpace='window',
                          window=dict(id=99, x=10, y=20, width=350, height=200)),
            action=dict(targetWindowId=99, delivery='background')))
        with patch.object(LOOP, 'native_focus', side_effect=[before, self.focus]), \
             patch.object(LOOP, 'child', return_value=json.dumps(raw)) as child:
            self.loop.deliver_drag(self.start['window'], 250, 'transition')
        receipt = LOOP.load(self.loop.out / 'transition-input.json')
        self.assertEqual(receipt['actionWindow']['width'], 350)
        self.assertEqual(receipt['afterFocus']['bounds'][2], 260)
        self.assertIn('--no-screenshot', child.call_args.args[0])
        self.assertEqual(receipt['capture'], 'not requested during transition')

    def test_fast_samples_are_retained_and_fresh_full_capture_agrees(self):
        self.calls = []; self.final_width = 260
        final = self.run_drag()
        self.assertEqual(final['window']['width'], 260)
        self.assertEqual(self.calls, [('shrink', 'drag'), ('shrink-settled', 'get-app-state')])
        samples = LOOP.load(self.loop.out / 'shrink-ax-settle.json')
        self.assertGreaterEqual(len(samples), 2)
        self.assertTrue(all(s['bounds'] == [10, 20, 260, 200] for s in samples))
        self.assertGreaterEqual(samples[-1]['at'] - samples[0]['at'], .5)

    def test_final_capture_disagreement_blocks(self):
        self.calls = []; self.final_width = 259
        with self.assertRaisesRegex(ValueError, 'capture disagrees'):
            self.run_drag()

    def test_unfocused_or_wrong_height_samples_block(self):
        self.calls = []; self.final_width = 260
        self.focus['frontmost'] = False
        with self.assertRaisesRegex(ValueError, 'active key window'):
            self.run_drag()
        self.focus['frontmost'] = True; self.focus['bounds'][3] = 201
        with self.assertRaisesRegex(ValueError, 'origin or height'):
            self.run_drag()


class NativeFocusKeyWindowTest(unittest.TestCase):
    """Live qualification (2026-11-08, #355 Mac runtime): the app's per-window
    AXFocused attribute stays false while the app is active and its window is
    main, so the helper must identify the key window through the process's own
    AXFocusedWindow attribute with exactly one unique window match."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mac-paint-focus-')
        self.addCleanup(self.temp.cleanup)
        self.tools = Path(self.temp.name) / 'tools'
        self.tools.mkdir()
        self.tool = self.tools / 'osascript'

    def run_helper(self, body):
        self.tool.write_text('#!/bin/sh\n' + body)
        self.tool.chmod(0o700)
        env = dict(os.environ, PATH=str(self.tools) + os.pathsep + os.environ.get('PATH', ''))
        with patch.dict(os.environ, env):
            return LOOP.native_focus(222)

    def test_helper_uses_the_focused_window_attribute_not_the_dead_per_window_one(self):
        text = SCRIPT.read_text()
        self.assertIn("byName('AXFocusedWindow')", text)
        self.assertNotIn("byName('AXFocused').value() === true", text)

    def test_helper_reports_the_matched_key_window_contract(self):
        payload = dict(frontmost=True, keyWindow=True, path='/x/OpenReader.app', bounds=[1, 2, 3, 4])
        self.assertEqual(self.run_helper("echo '" + json.dumps(payload) + "'"), payload)

    def test_unavailable_attribute_is_a_helper_failure_not_a_pass(self):
        with self.assertRaisesRegex(ValueError, 'osascript'):
            self.run_helper("echo 'No unique focused window' >&2; exit 3")

    def test_ask_budget_covers_the_measured_mac_webview_round_trip(self):
        # Live measurement 2026-11-08: probe answers took ~1.8-4.1 s; the old
        # 4 s deadline refused fresh answers, so the budget is pinned at 8 s.
        self.assertEqual(LOOP.ASK_SECONDS, 8)

    def test_drag_budget_covers_the_measured_mac_drag_round_trip(self):
        # A former full drag state() round trip took ~7.6 s and exhausted the
        # shared 8 s settle deadline. Delivery now has its own 12 s child
        # bound; focused-window settle has a separate 8 s budget. DRAG_SECONDS
        # is only the compatibility bound used by the fake-driver test.
        self.assertEqual(LOOP.DRAG_SECONDS, 30)
        self.assertEqual(LOOP.STATE_SECONDS, 12)
        self.assertEqual(LOOP.AX_SETTLE_SECONDS, 8)

    def test_failed_child_output_is_retained_privately_and_redacted_in_errors(self):
        # Parent audit 2026-11-08 (#357 lesson): a failed helper boundary must
        # not discard the tool's raw stdout/stderr. The raw bytes go to the
        # attempt's private JSONL log; the raised signal stays compact.
        log = Path(self.temp.name) / 'child-failures.jsonl'
        env = dict(os.environ, PATH=str(self.tools) + os.pathsep + os.environ.get('PATH', ''))
        private_path = str(Path.home() / 'private')
        with patch.dict(os.environ, env), patch.object(LOOP, 'FAILURE_LOG', str(log)):
            with self.assertRaisesRegex(ValueError, r'osascript \(status 3\)') as raised:
                self.run_helper('printf %s ' + shlex.quote('home ' + private_path + ' detail') + ' >&2; exit 3')
        entry = json.loads(log.read_text().splitlines()[-1])
        self.assertEqual(entry['tool'], 'osascript')
        self.assertEqual(entry['status'], 3)
        self.assertIn(private_path + ' detail', entry['stderr'])
        self.assertNotIn(private_path, str(raised.exception))  # redacted signal only
        self.assertIn('~/private detail', str(raised.exception))

    def test_timeout_retains_partial_child_output_and_sanitizes_exception(self):
        log = Path(self.temp.name) / 'timeout.jsonl'
        with patch.object(LOOP, 'FAILURE_LOG', str(log)):
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                LOOP.child([sys.executable, '-c', 'import sys,time;print("partial",flush=True);time.sleep(3)'], .25)
        entry = json.loads(log.read_text())
        self.assertIn('partial', entry['stdout'])
        self.assertIsNotNone(entry['status'])
        self.assertNotIn('import sys', str(raised.exception))


if __name__ == '__main__':
    unittest.main(verbosity=2)
