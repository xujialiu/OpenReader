#!/usr/bin/env python3
"""Drawer expand/measure/dismiss-reopen helper for the #361 final verification.

Complements drawer-placement.py and drawer-interactions.py for rotation and
window-resize phases. Commands:
  expand NAME        real grabber drag to the top, then verify large + guard and measure
  measure NAME       tree + screenshot + painted drawer geometry + CDP detent state
  dismiss-reopen NAME  real grabber drag(s) down (from large the first drag
                       contracts to the opening detent, the second dismisses),
                       verify gone, then a real Library-actions touch to reopen,
                       then measure + CDP opening
Real AXe input only; CDP reads the shared boundary's state. The measure step
reuses drawer-placement.py's screenshot oracle on the current window frame.

  python3 drawer-rotation-step.py measure NAME OUT --metro http://127.0.0.1:PORT \
      --device UDID --device-name NAME
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

spec = importlib.util.spec_from_file_location('ax', ROOT / 'test/manual-test/kit/ax.py')
ax = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ax)
spec2 = importlib.util.spec_from_file_location('drawer_placement', ROOT / 'test/manual-test/library-and-reader/drawer-placement.py')
dp = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(dp)
spec3 = importlib.util.spec_from_file_location('drawer_interactions', ROOT / 'test/manual-test/library-and-reader/drawer-interactions.py')
di = importlib.util.module_from_spec(spec3)
spec3.loader.exec_module(di)


def run(command, timeout=30, env=None):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True,
                            timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(str(command[0])).name}: {result.stderr[:400]}')
    return result.stdout


UDID = ''


def axe(*args):
    result = subprocess.run([ax.axe_binary(), *args, '--udid', UDID], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f'axe {args[0]}: {result.stderr[:400]}')
    return result.stdout


def cdp_state(metro, out, name):
    script = out / f'{name}-state.js'
    script.write_text(di.EXPRESSION)
    env = dict(os.environ, OPENREADER_DEVICE=args.device_name)
    reply = run(['node', ROOT / 'test/manual-test/kit/cdp.cjs', '--eval', script, metro], env=env)
    result = json.loads(json.loads(reply)['value'])
    if result['diagnosticGlobals'] or len(result['groups']) != 1:
        raise RuntimeError(f'unexpected modifier groups: {result}')
    mods = result['groups'][0]
    selection = next(m['selection'] for m in mods if m['$type'] == 'presentationDetents')
    guarded = next(m['isDisabled'] for m in mods if m['$type'] == 'interactiveDismissDisabled')
    detents = next(m['detents'] for m in mods if m['$type'] == 'presentationDetents')
    return {'selection': selection, 'guard': guarded, 'detents': detents}


def snapshot(out, name):
    tree = ax.read_tree(UDID)
    (out / f'{name}-tree.json').write_text(json.dumps(tree, indent=2))
    run(['xcrun', 'simctl', 'io', UDID, 'screenshot', out / f'{name}.png'], timeout=35)
    return tree


def app_frame(tree):
    apps = [node for node, _, _ in ax.walk(tree) if node.get('type') == 'Application']
    if len(apps) != 1:
        raise RuntimeError('no unique native Application frame')
    return ax.frame(apps[0])


def measure(out, name, metro):
    tree = snapshot(out, name)
    x, y, width, height = app_frame(tree)
    if x or y or width <= 0 or height <= 0:
        raise RuntimeError(f'window frame not origin-zero full: {x},{y} {width}x{height}')
    grabber = ax.centre_of(tree, 'Sheet Grabber')
    state = cdp_state(metro, out, name)
    geometry = None
    if grabber is not None:
        geometry = dp.measure_image(out / f'{name}.png', width, height)
        (out / f'{name}-geometry.json').write_text(json.dumps(geometry, indent=2))
    record = {'window': {'x': x, 'y': y, 'width': width, 'height': height},
              'grabber': grabber, 'state': state, 'geometry': geometry}
    (out / f'{name}-measure.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['expand', 'measure', 'dismiss-reopen'])
    parser.add_argument('name')
    parser.add_argument('output', type=Path)
    parser.add_argument('--metro', default='http://127.0.0.1:8362')
    args = parser.parse_args()
    global UDID
    UDID = args.device
    args.output.mkdir(parents=True, exist_ok=True)

    if args.command == 'measure':
        measure(args.output, args.name, args.metro)
        return 0

    tree = snapshot(args.output, 'pre-' + args.name)
    grabber = ax.centre_of(tree, 'Sheet Grabber')
    if grabber is None:
        raise RuntimeError('no Sheet Grabber: drawer is not open')
    gx, gy = grabber
    if args.command == 'expand':
        _, _, _, wheight = app_frame(tree)
        end_y = max(5, wheight * .025)
        axe('drag', '--start-x', f'{gx:.1f}', '--start-y', f'{gy:.1f}',
            '--end-x', f'{gx:.1f}', '--end-y', str(end_y), '--duration', '1.2', '--post-delay', '0.9')
        record = measure(args.output, args.name, args.metro)
        if record['state']['selection'] != 'large' or record['state']['guard'] is not True:
            raise RuntimeError(f"expand did not reach large: {record['state']}")
        print('EXPANDED-OK')
        return 0

    # dismiss-reopen: a downward drag from large first contracts to the opening
    # detent; drag again to dismiss (same two-step as drawer-interactions.py).
    x, y, width, height = app_frame(tree)
    axe('drag', '--start-x', f'{gx:.1f}', '--start-y', f'{gy:.1f}',
        '--end-x', f'{gx:.1f}', '--end-y', str(height - 16), '--duration', '1.2', '--post-delay', '0.9')
    tree = ax.read_tree(UDID)
    grabber = ax.centre_of(tree, 'Sheet Grabber')
    if grabber is not None:
        gx, gy = grabber
        axe('drag', '--start-x', f'{gx:.1f}', '--start-y', f'{gy:.1f}',
            '--end-x', f'{gx:.1f}', '--end-y', str(height - 16), '--duration', '1.2', '--post-delay', '0.9')
        tree = ax.read_tree(UDID)
    if ax.centre_of(tree, 'Sheet Grabber') is not None:
        raise RuntimeError('downward drag did not dismiss the drawer')
    (args.output / f'{args.name}-dismissed-tree.json').write_text(json.dumps(tree, indent=2))
    run(['xcrun', 'simctl', 'io', UDID, 'screenshot', args.output / f'{args.name}-dismissed.png'], timeout=35)
    target = ax.centre_of(tree, 'Library actions')
    if target is None:
        raise RuntimeError('Library actions not available after dismissal')
    ax.touch(UDID, tree, 'Library actions', False)
    time.sleep(1.4)
    record = measure(args.output, args.name + '-reopened', args.metro)
    if record['grabber'] is None:
        raise RuntimeError('drawer did not reopen')
    print('DISMISS-REOPEN-OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
