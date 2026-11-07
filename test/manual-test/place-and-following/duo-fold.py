#!/usr/bin/env python3
"""Real Device Hub fold-pose transitions, paired inner↔outer in one process.

For #348: the expanded Player's row count and occupied band through a real
system fold, not a forced UIWindow size. Run under ios_guard.py with the
selected app already visible and paused. Supply the CURRENT hub window and the
pose-button points (window points, screenshot px ÷ scale); do not reuse a
stale window or copied coordinates. Each click's delivery is judged by the
target's own window width crossing to the expected value, with a bounded
settle window that retains every native sample. No app launch, forced scene
geometry, private orientation API or audio is used. Native reads detach before
any GUI, screenshot or harness work (never overlapping AX/LLDB). The negative
control clicks an empty hub point and must NOT change the app.

  python3 duo-fold.py UDID OUT_DIR --hub-pid PID --window-id ID \
    --closed X Y --open X Y --metro http://127.0.0.1:PORT \
    [--reader] [--sequence closed,open,closed] [--display 1|3|both] \
    [--negative X Y] [--start-width 466|951]
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
KIT = ROOT / 'test/manual-test/kit'
FOLDED_WIDTH = 466
OPEN_WIDTH = 951


class InputBlocked(RuntimeError):
    """A missing input/precondition is not an application assertion failure."""


def _strip_trailing_commas(text):
    """The appendFormat builder leaves commas before closing brackets."""
    while True:
        cleaned = re.sub(r',\s*([\]}])', r'\1', text)
        if cleaned == text:
            return cleaned
        text = cleaned


def parse_native(log):
    lines = [line.removeprefix('FOLD348 ') for line in log.splitlines() if line.startswith('FOLD348 ')]
    pid = re.search(r'Validated target UDID=\S+ PID=(\d+) binary=', log)
    if len(lines) != 1 or not pid or f'Process {pid[1]} detached' not in log:
        raise InputBlocked('Missing unique native state or explicit LLDB detachment; inspect native log')
    state = json.loads(_strip_trailing_commas(lines[0]))
    state['pid'] = int(pid[1])
    return state


def active_window(state):
    """The foreground-active scene's key (or first) window, with its scene."""
    scenes = [s for s in state.get('scenes', []) if s.get('activation') == 0]
    if not scenes:
        raise InputBlocked(f'No foreground-active scene; app not frontmost: {state}')
    scene = scenes[0]
    windows = scene.get('windows') or []
    if not windows:
        raise InputBlocked(f'Foreground-active scene has no window: {state}')
    window = next((w for w in windows if w.get('key')), windows[0])
    selected = {
        'width': window['w'], 'height': window['h'],
        'safeLeft': window['l'], 'safeRight': window['r'],
        'safeTop': window['t'], 'safeBottom': window['b'],
        'root': window.get('root', ''),
        'key': window.get('key'),
        'sceneActivation': scene['activation'],
        'sceneCount': len(state.get('scenes', [])),
        'windowCount': len(windows),
        'pid': state['pid'],
        'category': state.get('category'),
        'device': state.get('device'),
    }
    return selected


def native_commands():
    # The Duo scene may hold more than one scene/window across a fold
    # (outer 466x678 beside the inner 951x669). anyObject/firstObject picked a
    # stale outer window (a5): report every scene and window, and let the
    # driver select the foreground-active presentation.
    # Statement-based ObjC++: the Duo scene can hold several scenes/windows
    # across a fold, and anyObject/firstObject picked a stale outer window
    # (attempt a5). Every scene and window is reported; the driver selects the
    # foreground-active scene's key window. A previous Swift one-liner printed
    # nothing through this wrapper, so the proven ObjC++ -O string result is
    # used instead.
    queries = [
        'expr -l objc++ -- @import UIKit',
        'expr -l objc++ -O -- '
        'unsigned long dev348 = (unsigned long)[[UIDevice currentDevice] orientation]; '
        'NSString *cat348 = [(NSString *)[(UIApplication *)[UIApplication sharedApplication] '
        'preferredContentSizeCategory] copy]; '
        'NSMutableString *out348 = [NSMutableString stringWithString:@"["]; '
        'for (UIScene *sc348 in [[UIApplication sharedApplication] connectedScenes]) { '
        '[out348 appendFormat:@"{\\\"activation\\\":%ld,\\\"windows\\\":[", (long)[sc348 activationState]]; '
        'for (UIWindow *w348 in [(UIWindowScene *)sc348 windows]) { '
        'UIViewController *rv348 = [w348 rootViewController]; '
        '[out348 appendFormat:@"{\\\"w\\\":%.1f,\\\"h\\\":%.1f,\\\"l\\\":%.1f,\\\"r\\\":%.1f,\\\"t\\\":%.1f,\\\"b\\\":%.1f,\\\"key\\\":%@,\\\"root\\\":\\\"%@\\\"},", '
        '(double)[w348 bounds].size.width, (double)[w348 bounds].size.height, '
        '(double)[w348 safeAreaInsets].left, (double)[w348 safeAreaInsets].right, '
        '(double)[w348 safeAreaInsets].top, (double)[w348 safeAreaInsets].bottom, '
        '[w348 isKeyWindow] ? @"true" : @"false", '
        'rv348 ? NSStringFromClass([rv348 class]) : @""]; } '
        '[out348 appendString:@"]},"]; } '
        '[out348 appendString:@"]"]; '
        '[@"FOLD348 {\\\"device\\\":" '
        'stringByAppendingString:[NSString stringWithFormat:@"%lu,\\\"category\\\":\\\"%@\\\",\\\"scenes\\\":%@}", '
        'dev348, cat348, out348]];',
    ]
    wrapped = [
        'script r=lldb.SBCommandReturnObject(); '
        '_=lldb.debugger.GetCommandInterpreter().HandleCommand(' + repr(query) + ', r); '
        'print((r.GetOutput() or "") + (r.GetError() or ""))'
        for query in queries
    ]
    return '\n'.join([*wrapped, 'process detach', 'quit', ''])


def expected_width(target):
    return OPEN_WIDTH if target == 'open' else FOLDED_WIDTH


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path)
    parser.add_argument('--hub-pid', type=int, required=True)
    parser.add_argument('--window-id', type=int, required=True)
    parser.add_argument('--closed', type=float, nargs=2, required=True, metavar=('X', 'Y'))
    parser.add_argument('--open', type=float, nargs=2, required=True, metavar=('X', 'Y'))
    parser.add_argument('--metro', required=True)
    parser.add_argument('--reader', action='store_true')
    parser.add_argument('--sequence', default='closed,open,closed',
                        help='Comma-separated pose targets, each clicked once in order')
    parser.add_argument('--display', choices=['1', '3', 'both'], default='both')
    parser.add_argument('--negative', type=float, nargs=2, metavar=('X', 'Y'),
                        help='Empty hub point: click must NOT change the app window')
    parser.add_argument('--start-width', type=int, choices=(FOLDED_WIDTH, OPEN_WIDTH),
                        help='Require this actual app window width before any input')
    args = parser.parse_args()
    sequence = [part.strip() for part in args.sequence.split(',') if part.strip()]
    for target in sequence:
        if target not in ('open', 'closed'):
            raise SystemExit(f'bad sequence target {target}')
    args.output.mkdir(parents=True, exist_ok=False)
    records = []
    outcome = {'outcome': 'BLOCKED'}
    harness = None
    commands = args.output / 'read-native.lldb'
    commands.write_text(native_commands())

    def run(*command, timeout=30):
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        if result.returncode:
            raise InputBlocked(f'{command[0]} failed ({result.returncode}): {result.stderr.strip()}')
        return result.stdout

    def native(label):
        result = subprocess.run(['bash', str(KIT / 'owned-lldb.sh'), args.device, str(commands)],
                                cwd=ROOT, text=True, capture_output=True, timeout=40)
        log = result.stdout + result.stderr
        (args.output / f'{label}-native.log').write_text(log)
        if result.returncode:
            raise InputBlocked('Native read failed; inspect retained log before any further attach')
        return parse_native(log)

    def click(point):
        click = json.loads(run('orca', 'computer', 'click', '--app', f'pid:{args.hub_pid}',
                               '--window-id', str(args.window_id), '--x', str(point[0]),
                               '--y', str(point[1]), '--json'))
        (args.output / 'click-input.json').write_text(json.dumps(click, indent=2))
        if not click.get('ok'):
            raise InputBlocked('Hub pose click dispatch failed')
        return click

    def capture(label, state):
        record = {'step': label, 'native': state}
        records.append(record)
        if args.reader:
            record['page'] = page()
        if args.display in ('1', 'both'):
            run('xcrun', 'simctl', 'io', args.device, 'screenshot', '--display=1',
                str(args.output / f'{label}-display1.png'))
        if args.display in ('3', 'both'):
            run('xcrun', 'simctl', 'io', args.device, 'screenshot', '--display=3',
                str(args.output / f'{label}-display3.png'))
        print(json.dumps(record), flush=True)

    try:
        run('python3', str(KIT / 'ios_guard.py'), 'check-owner')
        devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))
        selected = [d for group in devices['devices'].values() for d in group if d['udid'] == args.device]
        if len(selected) != 1 or selected[0]['state'] != 'Booted':
            raise InputBlocked('Select one explicit booted simulator')
        device_name = selected[0]['name']
        hub = json.loads(run('orca', 'computer', 'get-app-state', '--app', f'pid:{args.hub_pid}',
                             '--window-id', str(args.window_id), '--json'))
        (args.output / 'hub-before.json').write_text(json.dumps(hub, indent=2))
        if not hub.get('ok') or device_name not in hub['result']['snapshot']['window']['title']:
            raise InputBlocked('Hub window does not name the selected simulator')
        window = hub['result']['snapshot']['window']
        for name, point in (('closed', args.closed), ('open', args.open), ('negative', args.negative)):
            if point and not (0 < point[0] < window['width'] and 0 < point[1] < window['height']):
                raise InputBlocked(f'{name} point is outside the selected hub window')
        run('bash', str(KIT / 'silence.sh'), 'check', args.device)
        run('python3', str(KIT / 'ios_ready.py'), args.device, str(args.output / 'readiness'),
            '--timeout', '15', '--metro', args.metro, timeout=65)
        data = Path(run('xcrun', 'simctl', 'get_app_container', args.device, 'top.xujialiu.openreader', 'data').strip())
        logs = data / 'Library/Application Support/debug-log'
        harness = data / 'Documents/harness.json' if args.reader else None
        env = dict(os.environ, OPENREADER_METRO=args.metro, OPENREADER_DEVICE=device_name)

        def paused():
            if args.reader:
                result = subprocess.run(['node', str(KIT / 'reading.cjs'), 'state'], cwd=ROOT, env=env,
                                        text=True, capture_output=True, timeout=20, check=True)
                if json.loads(result.stdout).get('playing') is not False:
                    raise InputBlocked('Reader must already be paused; this driver never starts or stops speech')

        def positions():
            entries = json.loads((data / 'Documents/library.json').read_text())['entries']
            values = {entry['id']: entry.get('position') for entry in entries}
            return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()

        def page():
            token = 'FOLD348-' + uuid.uuid4().hex
            source = (ROOT / 'test/manual-test/place-and-following/viewport-size.js').read_text()
            body = {'seq': time.time_ns() // 1000000, 'do': 'js',
                    'code': source + '\nreturn ' + json.dumps(token + ' ') + ' + probe();'}
            temporary = harness.with_name('.fold-' + token + '.json')
            temporary.write_text(json.dumps(body))
            temporary.replace(harness)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                for file in sorted(logs.glob('debug-log-*.txt'), reverse=True):
                    for line in reversed(file.read_text().splitlines()):
                        if '[probe] ' + token + ' ' in line:
                            return json.loads(line.split(token + ' ', 1)[1])
                time.sleep(.15)
            raise InputBlocked('No fresh target-side Reader geometry reply')

        paused()
        before_positions = positions()
        first = active_window(native('before'))
        if args.start_width is not None and abs(first['width'] - args.start_width) > 1:
            raise InputBlocked(f"Wrong starting window width: expected {args.start_width}, got {first['width']}")
        capture('before', first)
        previous = first
        pids = {first['pid']}

        if args.negative:
            click(args.negative)
            deadline = time.monotonic() + 3
            while True:
                time.sleep(.5)
                current = active_window(native('negative-sample'))
                records.append({'step': 'negative-control', 'native': current})
                if abs(current['width'] - previous['width']) > 1 or current['pid'] != previous['pid']:
                    raise AssertionError(f'Negative hub-area click changed the app: {current}')
                if time.monotonic() >= deadline:
                    break
            records.append({'step': 'negative-control', 'result': 'no change',
                            'width': previous['width'], 'pid': previous['pid']})

        for index, target in enumerate(sequence, start=1):
            expected = expected_width(target)
            label = f'pose-{index}-{target}'
            click(args.closed if target == 'closed' else args.open)
            deadline = time.monotonic() + 12
            attempt = 0
            while True:
                time.sleep(.4)
                attempt += 1
                current = active_window(native(f'{label}-sample-{attempt}'))
                pids.add(current['pid'])
                records.append({'step': label + '-response', 'sample': attempt,
                                'expectedWidth': expected, 'native': current})
                if abs(current['width'] - expected) <= 1 and current.get('root'):
                    break
                if time.monotonic() >= deadline:
                    raise AssertionError(
                        f'Pose click not delivered or window did not settle: expected width {expected}, last {current}')
            capture(label, current)
            previous = current

        if len(pids) != 1:
            raise AssertionError(f'The app process changed across the fold sequence: {pids}')
        paused()
        if positions() != before_positions:
            raise AssertionError('Folding changed a saved Reading Position')
        outcome = {'outcome': 'PASS', 'samePID': first['pid'], 'savedPositionsUnchanged': True,
                   'sequence': sequence, 'negativeControl': bool(args.negative),
                   'screenshotsRequireVisualReview': True}
        print(json.dumps(outcome), flush=True)
        return 0
    except AssertionError as error:
        outcome = {'outcome': 'FAIL', 'reason': str(error)}
        print(json.dumps(outcome), file=sys.stderr)
        return 1
    except (InputBlocked, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        outcome = {'outcome': 'BLOCKED', 'reason': str(error)}
        print(json.dumps(outcome), file=sys.stderr)
        return 69
    finally:
        if harness is not None:
            harness.unlink(missing_ok=True)
        (args.output / 'records.json').write_text(json.dumps({'result': outcome, 'steps': records}, indent=2))


if __name__ == '__main__':
    sys.exit(main())
