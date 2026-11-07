#!/usr/bin/env python3
"""Real Device Hub rotation, not XCUIDevice's cached test-runner orientation.

Run under ios_guard.py, with the selected app already visible and paused.
Supply the CURRENT hub window and Rotate button point; do not reuse a pose
button or stale coordinates. Four quarter-turns return to the starting pose.
No app launch, forced geometry, private orientation API or audio is used.
Native reads detach before GUI/harness work. See duo-rotation.md for limits.
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
# Physical quarter-turn order of Device Hub's visible Rotate control.
NEXT = {1: 4, 4: 2, 2: 3, 3: 1}


class InputBlocked(RuntimeError):
    """A missing input/precondition is not an application assertion failure."""


def parse_native(log):
    lines = [line.removeprefix('ROT349 ') for line in log.splitlines() if line.startswith('ROT349 ')]
    pid = re.search(r'Validated target UDID=\S+ PID=(\d+) binary=', log)
    if len(lines) != 1 or not pid or f'Process {pid[1]} detached' not in log:
        raise InputBlocked('Missing unique native state or explicit LLDB detachment; inspect native log')
    state = json.loads(lines[0])
    state['pid'] = int(pid[1])
    return state


def check_response(before, after, expected_device, basis=None):
    if not after.get('root') or after['active'] != 0 or before['pid'] != after['pid']:
        raise InputBlocked('Missing foreground root or app process changed')
    if after['device'] != expected_device:
        raise InputBlocked(f"Rotate device event not delivered: expected {expected_device}, got {after['device']}")
    if min(after['width'], after['height']) <= 0:
        raise InputBlocked('No usable app window')
    # Physical upside-down may retain landscape on a Face ID phone. Record it,
    # but require both landscapes and upright portrait; do not force a policy.
    if expected_device != 2:
        # A physically upright unfolded Duo can have a landscape app scene.
        # Rotate relative to that display's measured basis, not the outer
        # phone's axis or the test runner's orientation names.
        basis = basis or before
        quarter_turn = (basis['device'] in (3, 4)) != (expected_device in (3, 4))
        landscape = (basis['width'] > basis['height']) != quarter_turn
        if ((after['width'] > after['height']) != landscape or
                (after['interface'] in (3, 4)) != landscape):
            raise AssertionError(f"Device event arrived but app window did not rotate: {after}")
    if abs(after['width'] - after['rootWidth']) > 1 or abs(after['height'] - after['rootHeight']) > 1:
        raise AssertionError(f"App root did not fill the rotated window: {after}")


def check_reader(native, page):
    width = native['width'] - native['safeLeft'] - native['safeRight']
    widths = [page['viewport']['width'], page['stage']['width']]
    widths.extend(view['width'] for view in page['views'])
    if not page['views'] or any(abs(value - width) > 1 for value in widths):
        raise AssertionError(f'Reader viewport/stage/iframe width differs from usable window {width}: {page}')


def native_commands():
    fields = {
        'device': '(long)[(UIDevice *)[UIDevice currentDevice] orientation]',
        'interface': '(long)[(UIWindowScene *)$s349 interfaceOrientation]',
        'active': '(long)[(UIWindowScene *)$s349 activationState]',
        'width': '(double)[(UIWindow *)$w349 bounds].size.width',
        'height': '(double)[(UIWindow *)$w349 bounds].size.height',
        'rootWidth': '(double)[(UIView *)[(UIViewController *)$r349 view] bounds].size.width',
        'rootHeight': '(double)[(UIView *)[(UIViewController *)$r349 view] bounds].size.height',
        'safeLeft': '(double)[(UIWindow *)$w349 safeAreaInsets].left',
        'safeRight': '(double)[(UIWindow *)$w349 safeAreaInsets].right',
    }
    values = ', '.join(f'@"{key}": @({value})' for key, value in fields.items())
    values += ', @"root": $r349 ? NSStringFromClass([(NSObject *)$r349 class]) : @""'
    queries = [
        'expr -l objc++ -- @import UIKit',
        'expr -l objc -- id $s349 = [(NSSet *)[[UIApplication sharedApplication] connectedScenes] anyObject]',
        'expr -l objc -- id $w349 = [(NSArray *)[(UIWindowScene *)$s349 windows] firstObject]',
        'expr -l objc -- id $r349 = [(UIWindow *)$w349 rootViewController]',
        'expr -l objc -O -- [@"ROT349 " stringByAppendingString:[[NSString alloc] initWithData:'
        '[NSJSONSerialization dataWithJSONObject:@{' + values + '} options:0 error:NULL] encoding:4]]',
    ]
    # SBCommandReturnObject captures expression failures without aborting the
    # command file before its explicit detach (batch `expr` otherwise does).
    wrapped = [
        'script r=lldb.SBCommandReturnObject(); '
        '_=lldb.debugger.GetCommandInterpreter().HandleCommand(' + repr(query) + ', r); '
        'print((r.GetOutput() or "") + (r.GetError() or ""))'
        for query in queries
    ]
    return '\n'.join([*wrapped, 'process detach', 'quit', ''])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path)
    parser.add_argument('--hub-pid', type=int, required=True)
    parser.add_argument('--window-id', type=int, required=True)
    parser.add_argument('--rotate', type=float, nargs=2, required=True, metavar=('X', 'Y'))
    parser.add_argument('--display', choices=['1', '3'], required=True)
    parser.add_argument('--reader', action='store_true')
    parser.add_argument('--turns', type=int, choices=range(5), default=4,
                        help='Quarter-turns; 0 asserts current geometry without input, 1 minimises a trigger, 4 is full acceptance')
    parser.add_argument('--start-device', type=int, choices=(1, 3, 4),
                        help='Require this actual target direction before input; useful for deterministic staging')
    parser.add_argument('--metro', required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    records = []
    outcome = {'outcome': 'BLOCKED'}
    harness = None
    commands = args.output / 'read-native.lldb'
    commands.write_text(native_commands())

    def run(*command, timeout=25):
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        if result.returncode:
            raise InputBlocked(f'{command[0]} failed ({result.returncode}): {result.stderr.strip()}')
        return result.stdout

    def native(label):
        result = subprocess.run(['bash', str(KIT / 'owned-lldb.sh'), args.device, str(commands)],
                                cwd=ROOT, text=True, capture_output=True, timeout=30)
        log = result.stdout + result.stderr
        (args.output / f'{label}-native.log').write_text(log)
        if result.returncode:
            raise InputBlocked('Native read failed; inspect retained log before any further attach')
        return parse_native(log)

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
        if not (0 < args.rotate[0] < window['width'] and 0 < args.rotate[1] < window['height']):
            raise InputBlocked('Rotate point is outside the selected hub window')
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
            token = 'ROT349-' + uuid.uuid4().hex
            source = (ROOT / 'test/manual-test/place-and-following/viewport-size.js').read_text()
            body = {'seq': time.time_ns() // 1000000, 'do': 'js',
                    'code': source + '\nreturn ' + json.dumps(token + ' ') + ' + probe();'}
            temporary = harness.with_name('.rotation-' + token + '.json')
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

        def capture(label, state):
            record = {'step': label, 'native': state}
            records.append(record)
            if args.reader:
                record['page'] = page()
            run('xcrun', 'simctl', 'io', args.device, 'screenshot', '--display=' + args.display,
                str(args.output / f'{label}.png'))
            if args.reader:
                check_reader(state, record['page'])
            print(json.dumps(record), flush=True)

        paused()
        before_positions = positions()
        first = native('before')
        check_response(first, first, first['device'])
        if args.start_device is not None and first['device'] != args.start_device:
            raise InputBlocked(f"Wrong starting target direction: expected {args.start_device}, got {first['device']}")
        if first['device'] not in (1, 3, 4):
            raise InputBlocked('Start at a known target direction other than physical upside-down; never use the XCTest cache')
        capture('before', first)
        previous = first
        for index in range(1, args.turns + 1):
            expected = NEXT[previous['device']]
            label = f'rotate-{index}'
            click = json.loads(run('orca', 'computer', 'click', '--app', f'pid:{args.hub_pid}',
                                   '--window-id', str(args.window_id), '--x', str(args.rotate[0]),
                                   '--y', str(args.rotate[1]), '--json'))
            (args.output / f'{label}-input.json').write_text(json.dumps(click, indent=2))
            if not click.get('ok'):
                raise InputBlocked('Hub Rotate dispatch failed')
            # Interface orientation is published before window/root reflow.
            # Never score an in-flight transition or pause it once in LLDB and
            # assume a fixed sleep established its final size. Retain every read.
            deadline = time.monotonic() + 8
            attempt = 0
            while True:
                time.sleep(.25)
                attempt += 1
                current = native(f'{label}-sample-{attempt}')
                records.append({'step': label + '-response', 'sample': attempt,
                                'expectedDevice': expected, 'native': current})
                try:
                    check_response(previous, current, expected, basis=first)
                    break
                except (InputBlocked, AssertionError):
                    if time.monotonic() >= deadline:
                        raise
            capture(label, current)
            previous = current
        if args.turns == 4 and any(abs(first[key] - previous[key]) > 1 for key in ('width', 'height')):
            raise AssertionError('Window did not return to its original size')
        paused()
        if positions() != before_positions:
            raise AssertionError('Rotation changed a saved Reading Position')
        outcome = {'outcome': 'PASS', 'samePID': first['pid'], 'savedPositionsUnchanged': True,
                   'quarterTurns': args.turns, 'roundTrip': args.turns == 4,
                   'readerGeometryChecked': args.reader, 'screenshotsRequireVisualReview': True}
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
