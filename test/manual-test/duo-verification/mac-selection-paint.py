#!/usr/bin/env python3
"""#355 fixture-local paint assertion. Host replay is NOT a native bug-red run.

replay PAIR.json: validate three archived checkpoints and assert paint preservation.
run CASE.json NEW_OUT: attach to an admitted, staged Mac fixture; reselect natively,
  retain a no-resize positive control, deliver one OS width change, assert pixels.
reset CASE.json NEW_OUT: native Close Lookup/Escape and return to baseline width.
qualify RETEST_DIR NEW_OUT: read-only qualification against the audited M6 captures.

Requires Pillow, as do the existing manual-test image tools. No app imports.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import time
import uuid

from PIL import Image, ImageChops

BUNDLE = 'top.xujialiu.openreader'
TITLE = 'Word Boundaries for Lookup'
URL = 'https://www.youdao.com/w/Even/'
SERVICE = 'Youdao'

def require(ok, why):
    if not ok:
        raise ValueError(why)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def load(path):
    return json.loads(Path(path).read_text())


def pixels(path):
    image = Image.open(path)
    require(image.format == 'PNG' and image.getexif().get(274, 1) == 1,
            'Require an unrotated original PNG, not an annotated/rotated preview')
    return image.convert('RGB')


def crop(image, rect):
    require(len(rect) == 4 and all(type(v) is int for v in rect), 'Invalid pixel crop')
    x, y, w, h = rect
    require(min(x, y) >= 0 and min(w, h) > 0 and x + w <= image.width and y + h <= image.height,
            'Calibration outside measured image')
    return image.crop((x, y, x + w, y + h))


def mask(image, predicate):
    # A tiny fixture region, never a whole-screen blue count.
    data = zip(*(iter(image.tobytes()),) * 3)
    return Image.frombytes('L', image.size, bytes(255 if predicate(*p) else 0 for p in data))


def measure(image):
    blue = mask(image, lambda r, g, b: 15 <= r <= 80 and b <= 120 and b - r >= 20 and b - g >= 12)
    glyph = mask(image, lambda r, g, b: min(r, g, b) >= 90)
    dark = mask(image, lambda r, g, b: max(r, g, b) <= 35)
    fraction = lambda m: m.histogram()[255] / (m.width * m.height)
    rows = sum(blue.crop((0, y, blue.width, y + 1)).histogram()[255] >= blue.width * .4
               for y in range(blue.height)) / blue.height
    return {'blue': fraction(blue), 'dark': fraction(dark), 'glyph': fraction(glyph), 'bandRows': rows}, glyph


def overlap(a, b):
    union = ImageChops.lighter(a, b).histogram()[255]
    return ImageChops.darker(a, b).histogram()[255] / max(1, union)


def validate_checkpoint(c, calibration, now, kind):
    require(c['kind'] == kind and c['role'] in ['baseline', 'control', 'after'], 'Wrong evidence kind/role')
    w = c['window']
    require(w['pid'] > 0 and w['id'] > 0 and w['bundleId'] == BUNDLE and w['path'].startswith('/'), 'Wrong window identity')
    require(w['frontmost'] is True and w['keyWindow'] is True and c['paused'] is True,
            'Active key window and paused state are required')
    require(c['version'] and re.fullmatch('[a-f0-9]{64}', c['bundleSha256']), 'Missing app provenance')
    r = c['range']
    require(r['text'] == 'Even' and r['section'] == 0 and r['start'] == 0 and r['end'] == 4
            and r['cfi'].startswith('epubcfi(') and r['rects'] and r['anchor'] in [0, 4]
            and r['focus'] == 4 - r['anchor'], 'Missing matching fixture range/CFI')
    require(c['query'] == 'Even' and c['service'] == SERVICE and c['count'] >= 1
            and re.fullmatch('[a-f0-9]{64}', c['definitionSha256']), 'Missing completed service control')
    require(c['calibrationSha256'] == calibration['imageSha256'], 'Wrong calibration')
    image = pixels(c['image'])
    require(list(image.size) == c['imagePixels'] and sha(c['image']) == c['imageSha256'], 'Wrong image dimensions/hash')
    scale = c['scale']
    require(type(scale) in [int, float] and math.isfinite(scale) and scale > 0
            and scale == calibration['scale']
            and abs(image.width / scale - w['width']) < .1
            and abs(image.height / scale - w['height']) < .1, 'Screenshot/native-window scale mismatch')
    require(c['captureId'] and c['capturedAt'] > 0, 'Missing capture freshness')
    if kind == 'native':
        require(0 <= now - c['capturedAt'] <= 90, 'Stale native capture')
    region = crop(image, calibration['cropPixels'])
    guard = crop(image, calibration['guardPixels'])
    m, glyph = measure(region)
    require(measure(guard)[0]['dark'] > .75 and measure(guard)[0]['blue'] < .03,
            'Wrong exposed-region background/occlusion/calibration')
    require(.04 < m['glyph'] < .5, 'Fixture glyphs missing/covered')
    return m, glyph


def assert_pair(pair, now=None):
    kind = pair['kind']
    require(kind in ['native', 'host-replay', 'host-synthetic'], 'Unlabelled evidence kind')
    cal = pair['calibration']
    reference = pixels(cal['image'])
    require(sha(cal['image']) == cal['imageSha256'] and list(reference.size) == cal['imagePixels'], 'Changed calibration image')
    require(cal['scale'] > 0 and [reference.width / cal['scale'], reference.height / cal['scale']] == cal['nativeSize'],
            'Calibration must use actual screenshot scale and measured native window')
    ref, glyph = measure(crop(reference, cal['cropPixels']))
    require(ref['blue'] > .4 and ref['bandRows'] > .5, 'Calibration is not a painted positive control')
    checkpoints = [pair[n] for n in ['baseline', 'control', 'after']]
    require([c['role'] for c in checkpoints] == ['baseline', 'control', 'after'], 'Wrong checkpoint ordering')
    require(len({c['captureId'] for c in checkpoints}) == 3, 'Reused/stale capture ID')
    times = [c['capturedAt'] for c in checkpoints]
    require(times[0] < times[1] < times[2] and times[2] - times[0] <= 90, 'Stale/out-of-order checkpoints')
    baseline, control, after = checkpoints
    stable = ['version', 'bundleSha256', 'query', 'service', 'count', 'definitionSha256', 'calibrationSha256']
    for c in checkpoints[1:]:
        require(all(c[f] == baseline[f] for f in stable), 'Changed provenance/query/service/count/result')
        require(all(c['window'][f] == baseline['window'][f] for f in ['pid', 'id', 'path', 'bundleId', 'x', 'y', 'height']),
                'Wrong window/position/height')
        require(all(c['range'][f] == baseline['range'][f] for f in ['text', 'cfi', 'section', 'start', 'end', 'anchor', 'focus']),
                'Changed range/CFI/direction')
    require(control['window'] == baseline['window'], 'Positive control includes a resize')
    minimum = 1 if kind == 'host-replay' else 100
    require(after['window']['width'] <= baseline['window']['width'] - minimum, 'No delivered native width shrink')
    measurements = [validate_checkpoint(c, cal, time.time() if now is None else now, kind) for c in checkpoints]
    for m, g in measurements:
        require(overlap(glyph, g) > .8, 'Glyph registration differs; calibration/occlusion uncertain')
    for m, _ in measurements[:2]:
        require(m['blue'] > .4 and m['bandRows'] > .5 and m['blue'] >= ref['blue'] * .75,
                'No painted no-resize positive control')
    m = measurements[2][0]
    if m['blue'] >= measurements[0][0]['blue'] * .75 and m['bandRows'] > .5:
        status, code = 'PAINT_PRESERVED', 0
    elif m['blue'] < .03 and m['dark'] > .5:
        status, code = 'PAINT_LOST', 1
    else:
        raise ValueError('Uncertain/partial paint change; review the registered crop')
    prefix = 'NATIVE_' if kind == 'native' else 'HOST_REPLAY_' if kind == 'host-replay' else 'HOST_SYNTHETIC_'
    return {'status': prefix + status, 'measurements': [m for m, _ in measurements],
            'limit': 'Fixture Even only; no handle, endpoint-extension, M7, audio or whole-app acceptance.'}, code


def child(argv, seconds=8):
    """Bound each serial child and its group; never leave a timed-out tool running."""
    p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = p.communicate(timeout=seconds)
    except BaseException:
        os.killpg(p.pid, signal.SIGTERM)
        try:
            p.communicate(timeout=.5)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.communicate()
        raise
    try:
        os.killpg(p.pid, signal.SIGTERM)  # Any remaining children in this owned group.
    except ProcessLookupError:
        pass
    require(p.returncode == 0, 'Child failed: ' + Path(argv[0]).name + ' (raw output withheld; no app verdict)')
    return out.decode()


# This reads only the approved fixture in the already open WebView. It changes no
# selection, style, layout, dispatcher or fetch function. Adapted from
# DuoAcceptanceSelection.js, not highlighter/restore implementation.
PROBE = r'''
const ranges = []; let fixture = false;
for (const view of rendition.manager.views._views) {
  if (!view.displayed || !view.contents) continue;
  const d = view.contents.document;
  if (view.section.index !== 0) continue;
  if (d.querySelector('h1')?.textContent.trim() !== 'Boundary Examples' ||
      !d.querySelector('p')?.textContent.startsWith('Even with punctuation,')) throw Error('Wrong fixture');
  fixture = true;
  const s = view.contents.window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) continue;
  const r = s.getRangeAt(0); const f = view.iframe.getBoundingClientRect();
  if (String(r) !== 'Even') throw Error('Wrong fixture range');
  ranges.push({text:'Even', section:0, cfi:view.contents.cfiFromRange(r),
    start:r.startOffset, end:r.endOffset, anchor:s.anchorOffset, focus:s.focusOffset,
    rects:Array.from(r.getClientRects()).slice(0,2).map(q=>[q.x+f.x,q.y+f.y,q.width,q.height])});
}
if (!fixture || ranges.length > 1) throw Error('Fixture not ready');
return JSON.stringify({marker:MARKER,at:Date.now(),ranges});
'''


class Sender:
    def __init__(self, case, case_path):
        self.documents = Path(case['container']) / 'Documents'
        self.harness = self.documents / 'harness.json'
        require(self.documents.is_dir() and not self.harness.is_symlink(), 'Unsafe/missing harness container')
        logs = sorted((Path(case['container']) / 'Library/Application Support/debug-log').glob('debug-log-??????.txt'))
        require(logs, 'Missing admitted Debug Log')
        self.log = logs[-1]
        self.inode = self.log.stat().st_ino
        prior = load(self.harness) if self.harness.exists() else {'do': 'noop', 'seq': 0}
        require(prior.get('do') == 'noop', 'Another harness command is pending')
        self.lock = Path(str(case_path) + '.seq').open('a+')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.lock.seek(0)
            persisted = self.lock.read().strip()
            self.seq = max(int(persisted or 0), case['seqFloor'], prior['seq'], time.time_ns() // 1000)
            require(self.seq < 2 ** 53 - 1000, 'Sequence exceeds JavaScript exact integers')
        except BaseException:
            self.lock.close()
            raise
        self.owned = None
        self.observed = prior['seq']
        self.last_send = 0

    def text(self):
        require(self.log.stat().st_ino == self.inode, 'Debug Log rotated/replaced; control invalid')
        return self.log.read_text()

    def put(self, command):
        time.sleep(max(0, .3 - (time.monotonic() - self.last_send)))
        if self.harness.exists():
            require(load(self.harness)['seq'] == (self.observed if self.owned is None else self.owned),
                    'Harness changed by another writer; write refused')
        else:
            require(self.owned is None, 'Harness deleted by another writer; write refused')
        self.seq += 1
        self.lock.seek(0); self.lock.truncate(); self.lock.write(str(self.seq)); self.lock.flush(); os.fsync(self.lock.fileno())
        temporary = self.documents / ('.mac-paint-' + uuid.uuid4().hex + '.json')
        try:
            temporary.write_text(json.dumps(dict(command, seq=self.seq)))
            os.replace(temporary, self.harness)
        finally:
            temporary.unlink(missing_ok=True)
        self.owned = self.seq
        self.last_send = time.monotonic()

    def ask(self, command, pattern):
        offset = len(self.text()); sent = time.time()
        self.put(command)
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            text = self.text()
            require(len(text) >= offset, 'Debug Log truncated')
            for line in text[offset:].splitlines():
                match = re.search(pattern, line)
                stamp = re.match(r'(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d+) ([+-]\d\d:\d\d)', line)
                if match and stamp:
                    from datetime import datetime
                    at = datetime.fromisoformat(stamp[1] + 'T' + stamp[2] + stamp[3]).timestamp()
                    if at >= sent - .01:
                        self.put({'do': 'noop'})
                        return match
            time.sleep(.05)
        raise ValueError('No fresh matching harness answer within poll + 2s Debug Log flush budget')

    def probe(self):
        marker = 'mac-paint-' + uuid.uuid4().hex
        code = PROBE.replace('MARKER', json.dumps(marker))
        result = self.ask({'do': 'js', 'code': code}, r'\[probe\] (\{.*' + marker + r'.*\})')
        value = json.loads(result[1])
        require(value['marker'] == marker and abs(time.time() * 1000 - value['at']) < 5000, 'Stale probe')
        return value['ranges']

    def paused(self):
        match = self.ask({'do': 'say'}, r'\[hx\] playing=(true|false)\b')
        require(match[1] == 'false', 'App is not paused; no playback is authorized')
        return True

    def close(self):
        try:
            if self.owned is not None and self.harness.exists():
                require(load(self.harness)['seq'] == self.owned, 'Harness changed by another writer; cleanup refused')
                self.put({'do': 'noop'})
                self.harness.unlink()
        finally:
            self.lock.close()


def native_focus(pid, seconds=8):
    # Read-only targeted System Events; no process-name lookup, activate, AXPress,
    # debugger or custom CGEvent helper. Unsupported attributes fail BLOCKED.
    script = '''ObjC.import('AppKit');
const pid = PID; const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
const p = Application('System Events').applicationProcesses.whose({unixId:pid})();
if (p.length !== 1) throw Error('PID unavailable');
const ws = p[0].windows().filter(w => w.attributes.byName('AXFocused').value() === true);
if (ws.length !== 1) throw Error('No unique focused window');
JSON.stringify({frontmost:Boolean(app.isActive), path:ObjC.unwrap(app.bundleURL.path),
 keyWindow:true, bounds:[...ws[0].position(),...ws[0].size()]});'''.replace('PID', str(pid))
    return json.loads(child(['osascript', '-l', 'JavaScript', '-e', script], seconds))


class NativeLoop:
    def __init__(self, case, out, case_path):
        self.case, self.out = case, out
        require(case['authorized'] is True and 0 <= time.time() - case['preparedAt'] <= 300,
                'Need a fresh admitted case (five minutes), not the old PID/selection')
        expected_container = (Path.home() / 'Library/Containers' / BUNDLE / 'Data').resolve()
        require(Path(case['container']).resolve() == expected_container, 'Wrong Mac container')
        app = Path(case['app']).resolve()
        require(Path(case['app']).is_absolute() and Path(case['orca']).is_absolute()
                and type(case['pid']) is int and case['pid'] > 0
                and type(case['windowId']) is int and case['windowId'] > 0, 'Explicit PID/path/window/CLI required')
        require(child(['ps', '-p', str(case['pid']), '-o', 'comm=']).strip() == str(app / 'OpenReader'), 'Wrong executable for PID')
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        require(info['CFBundleIdentifier'] == BUNDLE and info['CFBundleShortVersionString'] == case['nativeVersion']
                and str(info['CFBundleVersion']) == case['nativeBuild'], 'Wrong native identity')
        require(sha(app / 'main.jsbundle') == case['bundleSha256'], 'Wrong embedded bundle')
        version_file = Path(case['container']) / 'Library/Application Support/debug-log/version.txt'
        require(version_file.read_text().strip() == case['version'].removesuffix('-debug'), 'Wrong runtime Beta')
        require(sha(case['settingsImage']) == case['settingsImageSha256']
                and 0 <= time.time() - case['settingsObservedAt'] <= 300
                and Path(case['settingsImage']).stat().st_mtime >= case['settingsObservedAt'] - 1,
                'Missing/stale current Settings identity receipt')
        settings = load(case['settingsState'])
        require(settings['ok'] is True and settings['result']['snapshot']['app']['pid'] == case['pid']
                and settings['result']['snapshot']['window']['id'] == case['windowId']
                and case['version'] in settings['result']['snapshot']['treeText'], 'Settings receipt has wrong PID/window/version')
        require(case['version'] == case['settingsVersion'] and case['noFetchWrapper'] is True, 'Invalid version/wrapper precondition')
        self.sender = Sender(case, case_path)
        self.watching = False
        self.calls = 0
        self.window = None

    def state(self, name, command='get-app-state', extra=(), deadline=None):
        def budget():
            remaining = 8 if deadline is None else min(8, deadline - time.monotonic())
            require(remaining > 0, 'Native measurement deadline exhausted')
            return remaining
        self.calls += 1
        c = self.case
        before_focus = native_focus(c['pid'], budget())
        require(before_focus['frontmost'] and before_focus['keyWindow']
                and before_focus['path'] == str(Path(c['app']).resolve()), 'Input requires the admitted active app')
        if command != 'get-app-state':
            require(self.window is not None and before_focus['bounds'] == self.window,
                    'Input selector is no longer the measured key window')
        request_at = time.time()
        full_tree = [] if command == 'get-app-state' else ['--full-tree']
        raw = json.loads(child([c['orca'], 'computer', command, '--app', 'pid:' + str(c['pid']),
                                '--window-id', str(c['windowId']), *map(str, extra), *full_tree, '--json'], budget()))
        require(raw.get('ok') is True, 'Orca refused input/capture')
        result = raw['result']; snap = result['snapshot']; w = snap['window']; shot = result['screenshot']
        require(snap['app']['pid'] == c['pid'] and snap['app']['bundleId'] == BUNDLE
                and w['id'] == c['windowId'] and snap['coordinateSpace'] == 'window'
                and not w['isMinimized'] and not w['isOffscreen'], 'Wrong/stale window selector')
        focus = native_focus(c['pid'], budget())
        require(focus['frontmost'] and focus['keyWindow'] and focus['path'] == str(Path(c['app']).resolve())
                and focus['bounds'] == [w['x'], w['y'], w['width'], w['height']], 'Window is not the current active key window')
        require(result['screenshotStatus']['state'] == 'captured'
                and result['screenshotStatus']['metadata']['windowId'] == w['id'], 'Capture is not selected native window')
        image = self.out / (name + '.png')
        if shot.get('path'):
            source = Path(shot['path'])
            require(source.stat().st_mtime >= request_at, 'Stale screenshot file')
            shutil.copy2(source, image)
        else:
            image.write_bytes(base64.b64decode(shot['data'], validate=True))
        require(list(pixels(image).size) == [shot['width'], shot['height']], 'Invalid screenshot dimensions')
        require(TITLE in snap['treeText'], 'Wrong fixture window')
        record = {'captureId': raw['id'], 'capturedAt': time.time(), 'image': str(image), 'imageSha256': sha(image),
                  'imagePixels': [shot['width'], shot['height']], 'scale': shot['scale'],
                  'window': dict(pid=c['pid'], id=w['id'], path=focus['path'], bundleId=BUNDLE,
                                 frontmost=True, keyWindow=True, **{k: w[k] for k in ['x', 'y', 'width', 'height']})}
        # Do not archive a full AX tree, settings object, key dump or Debug Log.
        self.window = focus['bounds']
        save(self.out / (name + '-capture.json'), record)
        if command != 'get-app-state':
            action = result['action']
            require(action['targetWindowId'] == w['id'] and action['delivery'] in ['background', 'foreground'],
                    'Missing targeted native input receipt')
            save(self.out / (name + '-input.json'), dict(command=command, arguments=list(extra),
                 startedAt=request_at, endedAt=time.time(), action=action))
        return record, snap['treeText']

    def checkpoint(self, role):
        self.sender.paused()
        ranges = self.sender.probe()
        require(len(ranges) == 1, 'No native selected fixture range')
        record, tree = self.state(role)
        require(re.search(r'\btext Even,', tree) and 'text Youdao,' in tree and 'button Close Lookup,' in tree,
                'No completed matching lookup Drawer')
        lines = re.findall(r'^\s*\d+ text (.*?), Secondary Actions:', tree, re.M)
        definition = max(lines, key=len, default='')
        require(len(definition) >= 40 and 'Asking' not in tree and 'Try again' not in tree, 'No substantial visible definition control')
        text = self.sender.text()[self.log_start:]
        count = len(re.findall(r'\[hx\] fetch (?:GET|POST) https://www\.youdao\.com/', text))
        require(count >= 1 and re.search(r'\[lookup\].*GET ' + re.escape(URL) + r'.*-> 200', text),
                'No normal request/200 service control')
        record.update(kind='native', role=role, paused=True, range=ranges[0], query='Even', service=SERVICE,
                      count=count, definitionSha256=hashlib.sha256(definition.encode()).hexdigest(),
                      version=self.case['version'], bundleSha256=self.case['bundleSha256'],
                      calibrationSha256=self.case['calibration']['imageSha256'])
        save(self.out / (role + '.json'), record)
        return record

    def drag(self, state, target, name):
        w = state['window']
        # Official window-local OS edge input; measured bounds, not DOM points.
        deadline = time.monotonic() + 8
        result, _ = self.state(name, 'drag', ['--from-x', w['width'] - 3, '--from-y', w['height'] - 3,
                                             '--to-x', target - 3, '--to-y', w['height'] - 3], deadline)
        previous = None; stable_since = time.monotonic()
        while time.monotonic() < deadline:
            size = (result['window']['width'], result['window']['height'])
            if size != previous:
                stable_since = time.monotonic(); previous = size
            elif time.monotonic() - stable_since >= .5 and abs(size[0] - w['width']) >= 100:
                require((size[0] - w['width']) * (target - w['width']) > 0 and size[1] == w['height'],
                        'No delivered width-only change in the requested direction')
                return result
            time.sleep(.15)
            result, _ = self.state(name + '-settle-' + str(self.calls), deadline=deadline)
        raise ValueError('No measured delivered/settled OS width change within eight seconds')

    def run(self, reset=False):
        try:
            self.sender.paused()
            staged_ranges = self.sender.probe()  # Before images/input: refuse an owner Document.
            state, tree = self.state('staged')
            require(state['scale'] == self.case['calibration']['scale'], 'Recalibrate screenshot scale')
            if reset:
                if 'button Close Lookup,' in tree:
                    index = re.search(r'^\s*(\d+) button Close Lookup,', tree, re.M)[1]
                    self.state('close-lookup', 'click', ['--element-index', index])
                self.state('escape', 'press-key', ['--key', 'Escape'])
                state, _ = self.state('reset-before')
                if state['window']['width'] != self.case['baselineWidth']:
                    self.drag(state, self.case['baselineWidth'], 'return')
                require(not self.sender.probe(), 'Native Escape did not clear selection; reset BLOCKED')
                self.sender.paused()
                return {'status': 'NATIVE_RESET_ONLY', 'limit': 'Run the paint assertion next; reset is not bug evidence.'}, 0
            require(state['window']['width'] - self.case['afterWidth'] >= 100 and not staged_ranges
                    and 'Close Lookup' not in tree, 'Need wide staged fixture with empty selection; run reset first')
            self.log_start = len(self.sender.text())
            self.watching = True
            self.sender.ask({'do': 'watchfetch', 'host': 'www.youdao.com'}, r'\[hx\] fetch watched for www\.youdao\.com')
            x, y, w, h = self.case['calibration']['cropPixels']; scale = state['scale']
            self.state('native-select', 'click', ['--x', (x + w / 2) / scale, '--y', (y + h / 2) / scale, '--click-count', 2])
            baseline = self.checkpoint('baseline')
            time.sleep(2)  # Kit lookup quiet window: 180ms debounce + multiple settled polls.
            control = self.checkpoint('control')
            # Refuse a bad visual control BEFORE the only failure injection.
            cal = self.case['calibration']
            reference = pixels(cal['image'])
            require(sha(cal['image']) == cal['imageSha256'], 'Changed calibration image')
            ref, glyph = measure(crop(reference, cal['cropPixels']))
            require(ref['blue'] > .4 and ref['bandRows'] > .5, 'Calibration is not painted')
            for c in [baseline, control]:
                m, g = validate_checkpoint(c, cal, time.time(), 'native')
                require(m['blue'] > .4 and m['bandRows'] > .5 and overlap(glyph, g) > .8,
                        'Native reselection/no-resize paint control failed')
            require(baseline['range'] == control['range'] and baseline['count'] == control['count']
                    and baseline['definitionSha256'] == control['definitionSha256']
                    and baseline['window'] == control['window'], 'Unstable no-resize control')
            self.drag(control, self.case['afterWidth'], 'shrink')
            after = self.checkpoint('after')
            pair = dict(kind='native', calibration=cal, baseline=baseline, control=control, after=after)
            save(self.out / 'pair.json', pair)
            return assert_pair(pair)
        finally:
            try:
                if self.watching:
                    self.sender.ask({'do': 'unbreakfetch'}, r'\[hx\] fetch restored')
            finally:
                self.sender.close()


def qualify(root, out):
    """Pixel qualification only; the old captures lack fresh CFI/key-window receipts."""
    cal = None; manifest = []; results = []; reference_glyph = None
    for index, name in enumerate(['painted-before', 'reactivated', 'shrunk', 'returned', 'repro']):
        image = root / ('m6-' + name + '-raw.png')
        meta = root / ('m6-' + name + ('.json' if index < 2 else '-shot.json'))
        dst = out / image.name; shutil.copy2(image, dst)
        shutil.copy2(meta, out / meta.name)
        raw = load(meta); result = raw['result']; w = result['snapshot']['window']; shot = result['screenshot']
        manifest.append({'image': str(image), 'sha256': sha(image), 'size': image.stat().st_size,
                         'mtimeNs': image.stat().st_mtime_ns, 'orcaMetadata': str(meta), 'orcaSha256': sha(meta)})
        if cal is None:
            cal = dict(image=str(dst), imageSha256=sha(dst), imagePixels=[shot['width'], shot['height']],
                       scale=shot['scale'], nativeSize=[w['width'], w['height']],
                       cropPixels=[0, 362, 77, 46], guardPixels=[80, 362, 20, 46])
        actual = pixels(dst)
        require(list(actual.size) == [shot['width'], shot['height']]
                and [actual.width / shot['scale'], actual.height / shot['scale']] == [w['width'], w['height']]
                and shot['scale'] == cal['scale'], 'Archived screenshot/native dimensions disagree')
        m, glyph = measure(crop(actual, cal['cropPixels']))
        if reference_glyph is None:
            reference_glyph = glyph
        require(overlap(reference_glyph, glyph) > .8, 'Archived glyph registration failed')
        expected_paint = index < 2
        require((m['blue'] > .4 and m['bandRows'] > .5) if expected_paint else (m['blue'] < .03 and m['dark'] > .5),
                'Archived positive/paint-loss pixel control failed')
        results.append(dict(case=name, status='HOST_REPLAY_PAINT_PRESENT' if expected_paint else 'HOST_REPLAY_PAINT_LOST',
                            measurements=m))
    save(out / 'originals.json', manifest)
    save(out / 'calibration.json', cal)
    return {'status': 'HOST_REPLAY_QUALIFIED', 'results': results,
            'limit': 'Pixel qualification only, not a native assertion run. Old captures lack fresh CFI/key-window receipts; none invented.'}, 0


def main():
    def cancelled(_signum, _frame):
        raise KeyboardInterrupt('Cancelled; native cleanup attempted')
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['replay', 'qualify', 'run', 'reset'])
    p.add_argument('input', type=Path)
    p.add_argument('output', type=Path, nargs='?')
    args = p.parse_args()
    out = None
    try:
        if args.mode == 'replay':
            result, code = assert_pair(load(args.input))
        else:
            require(args.output is not None, 'Fresh external output directory required')
            destination = args.output.resolve()
            destination.mkdir(mode=0o700, parents=True, exist_ok=False)
            out = destination
            if args.mode == 'qualify':
                result, code = qualify(args.input, out)
            else:
                case = load(args.input)
                result, code = NativeLoop(case, out, args.input).run(reset=args.mode == 'reset')
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired, KeyboardInterrupt) as error:
        result, code = {'status': 'BLOCKED', 'error': str(error)}, 2
    if out:
        save(out / 'result.json', result)
    print(json.dumps(result, indent=2))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
