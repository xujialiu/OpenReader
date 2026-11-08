#!/usr/bin/env python3
"""Reproduce #361 through the shared Drawer, not mocked native UI.

Run under kit/ios_guard.py, on a full-window, light-Theme Library in a Debug
app connected to the supplied Metro. RED means a large detached bottom gap.
GREEN is only that narrow placement signal, not full Drawer acceptance.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


def measure_image(path, window_width, window_height):
    """Find a wide light Drawer's painted bounds; reject unsupported captures."""
    pixels = np.asarray(Image.open(path).convert('RGB')).astype(int)
    image_height, image_width, _ = pixels.shape
    if window_width <= 0 or window_height <= 0:
        raise ValueError('native window has no positive size')
    scale_x = image_width / window_width
    scale_y = image_height / window_height
    if abs(scale_x - scale_y) > .005:
        raise ValueError('native app frame and screenshot have incompatible scales')
    mask = np.max(np.abs(pixels - np.array([244, 244, 246])), axis=2) <= 3
    central = mask[:, int(image_width * .30):int(image_width * .70)].mean(axis=1)
    rows = np.flatnonzero(central > .70)
    groups = np.split(rows, np.where(np.diff(rows) > 12 * scale_y)[0] + 1)
    groups = [group for group in groups if len(group) > 40 * scale_y]
    if not groups:
        raise ValueError('no large Drawer-colored region in actual screenshot')
    panel = max(groups, key=len)
    top, bottom = int(panel[0]), int(panel[-1]) + 1
    bounds_rows = mask[int(top + 15 * scale_y):int(min(bottom - 15 * scale_y, top + 65 * scale_y))]
    columns = np.flatnonzero(bounds_rows.mean(axis=0) > .65)
    if len(columns) < 100 * scale_x:
        raise ValueError('no stable wide Drawer bounds')
    left, right = int(columns[0]), int(columns[-1]) + 1
    return {
        'screenshotScale': scale_x,
        'drawer': {
            'x': round(left / scale_x, 2),
            'y': round(top / scale_y, 2),
            'width': round((right - left) / scale_x, 2),
            'height': round((bottom - top) / scale_y, 2),
        },
        'bottomGap': round(window_height - bottom / scale_y, 2),
    }


def placement_signal(geometry, window_height):
    # A conservative separator, not an approved final bottom-inset tolerance.
    limit = max(24, window_height * .05)
    return ('RED' if geometry['bottomGap'] > limit else 'GREEN'), limit


def run(command, timeout=20, env=None):
    result = subprocess.run([str(part) for part in command], text=True, capture_output=True,
                            timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(str(command[0])).name} failed ({result.returncode}): {result.stderr[:700]}')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device', help='explicit session-owned simulator UDID')
    parser.add_argument('output', type=Path, help='new artifact directory')
    parser.add_argument('--metro', default='http://127.0.0.1:8081')
    parser.add_argument('--capture-only', action='store_true', help='measure the already open Library actions Drawer')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location('drawer_placement_ax', ROOT / 'test/manual-test/kit/ax.py')
    if spec is None or spec.loader is None:
        raise RuntimeError('could not load kit/ax.py')
    ax = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ax)
    started = time.monotonic()

    def cdp(expression, name, device_name):
        script = args.output / (name + '.js')
        script.write_text(expression)
        env = dict(os.environ, OPENREADER_DEVICE=device_name)
        reply = run(['node', ROOT / 'test/manual-test/kit/cdp.cjs', '--eval', script, args.metro],
                    timeout=15, env=env)
        return json.loads(json.loads(reply)['value'])

    try:
        listing = json.loads(run(['xcrun', 'simctl', 'list', 'devices', '--json']))
        selected = [entry for group in listing['devices'].values() for entry in group
                    if entry['udid'] == args.device]
        if len(selected) != 1 or selected[0]['state'] != 'Booted':
            raise RuntimeError('selected simulator is not uniquely booted')
        device_name = selected[0]['name']
        if not args.capture_only:
            closed = cdp("""(() => {
              const h=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;let closed=0;
              function walk(f){if(!f)return;const p=f.memoizedProps||{};
                if(f.type?.name==='Drawer'&&p.visible){p.onClose();closed++;}
                walk(f.child);walk(f.sibling);}
              for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
              return JSON.stringify({closed});
            })()""", 'reset-drawer', device_name)
            if closed['closed']:
                time.sleep(.95)
            target = ax.centre_of(ax.read_tree(args.device), 'Library actions')
            if target is None:
                raise RuntimeError('Library actions is not available')
            x, y = target
            run([ax.axe_binary(), 'touch', '-x', x, '-y', y, '--down', '--up', '--delay', '.2',
                 '--udid', args.device])
            time.sleep(1.1)
        state = cdp("""(() => {
          const h=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;const drawers=[];
          function walk(f){if(!f)return;const p=f.memoizedProps||{};
            if(f.type?.name==='Drawer'&&p.visible)drawers.push({title:p.title,visible:p.visible});
            walk(f.child);walk(f.sibling);}
          for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
          return JSON.stringify({drawers});
        })()""", 'state', device_name)
        if state['drawers'] != [{'title': 'Library actions', 'visible': True}]:
            raise RuntimeError('actual Library actions Drawer is not open')
        tree = ax.read_tree(args.device)
        (args.output / 'native-tree.json').write_text(json.dumps(tree, indent=2))
        apps = [node for node, _, _ in ax.walk(tree) if node.get('type') == 'Application']
        if len(apps) != 1:
            raise RuntimeError('no unique native Application frame')
        app_x, app_y, window_width, window_height = ax.frame(apps[0])
        if app_x or app_y:
            raise RuntimeError('this screenshot oracle requires a full-window origin-zero app')
        shot = args.output / 'screen.png'
        run(['xcrun', 'simctl', 'io', args.device, 'screenshot', shot])
        geometry = measure_image(shot, window_width, window_height)
        verdict, limit = placement_signal(geometry, window_height)
        record = {
            'verdict': verdict,
            'scope': 'large-bottom-gap signal only; not full Drawer acceptance',
            'window': {'width': window_width, 'height': window_height},
            **geometry,
            'maxNonLargeGap': round(limit, 2),
            'actualDrawer': state['drawers'],
            'seconds': round(time.monotonic() - started, 2),
            'input': 'capture-only' if args.capture_only else 'real AXe touch on current Library actions button',
        }
        (args.output / 'result.json').write_text(json.dumps(record, indent=2))
        print(json.dumps(record))
        if verdict == 'RED':
            print(f"FAIL: Drawer bottom gap {geometry['bottomGap']:.1f} pt exceeds conservative non-large-gap limit {limit:.1f} pt")
            return 1
        return 0
    except (RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        (args.output / 'blocked.txt').write_text(str(error))
        print('BLOCKED: ' + str(error), file=sys.stderr)
        return 69


if __name__ == '__main__':
    sys.exit(main())
