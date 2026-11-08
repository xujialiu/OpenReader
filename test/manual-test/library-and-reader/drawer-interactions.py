#!/usr/bin/env python3
"""Native iPad Drawer checks for #361, with no runtime prop/module overrides.

Run under ios_guard.py, in a full-window light-Theme Library with Library
actions open at the chosen height. Background navigation and grabber drags
are real AXe input. CDP only reads the shared boundary's state.
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
EXPRESSION = """(() => {
  const h=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;const groups=[];
  function walk(f){if(!f)return;const p=f.memoizedProps||{};
    if(f.type?.name==='Group'&&p.modifiers?.some(m=>m.$type==='presentationDetents'))
      groups.push(p.modifiers.map(m=>Object.fromEntries(Object.entries(m).filter(([k,v])=>typeof v!=='function'))));
    walk(f.child);walk(f.sibling);}
  for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
  return JSON.stringify({groups,diagnosticGlobals:Object.getOwnPropertyNames(globalThis).filter(k=>k.startsWith('__drawer361'))});
})()"""


def run(command, timeout=20, env=None):
    result = subprocess.run([str(part) for part in command], capture_output=True,
                            text=True, timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(str(command[0])).name}: {result.stderr[:700]}')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path)
    parser.add_argument('--metro', default='http://127.0.0.1:8081')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location('drawer_interactions_ax', ROOT / 'test/manual-test/kit/ax.py')
    if spec is None or spec.loader is None:
        raise RuntimeError('could not load kit/ax.py')
    ax = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ax)
    events = []
    started = time.monotonic()
    expression = args.output / 'read-state.js'
    expression.write_text(EXPRESSION)

    def record(event, **data):
        item = {'event': event, 'seconds': round(time.monotonic() - started, 3), **data}
        events.append(item)
        print(json.dumps(item), flush=True)

    def state():
        reply = run(['node', ROOT / 'test/manual-test/kit/cdp.cjs', '--eval', expression, args.metro],
                    timeout=15, env=env)
        result = json.loads(json.loads(reply)['value'])
        if result['diagnosticGlobals'] or len(result['groups']) != 1:
            raise RuntimeError('expected one uninstrumented native Drawer')
        mods = result['groups'][0]
        selection = next(m['selection'] for m in mods if m['$type'] == 'presentationDetents')
        guarded = next(m['isDisabled'] for m in mods if m['$type'] == 'interactiveDismissDisabled')
        opening = next(m['detents'][0] for m in mods if m['$type'] == 'presentationDetents')
        return {'selection': selection, 'guard': guarded, 'opening': opening, 'modifierCount': len(mods)}

    def snapshot(name):
        tree = ax.read_tree(args.device)
        (args.output / (name + '-tree.json')).write_text(json.dumps(tree, indent=2))
        run(['xcrun', 'simctl', 'io', args.device, 'screenshot', args.output / (name + '.png')])
        if any((node.get('AXLabel') or '').startswith('Close ') for node, _, _ in ax.walk(tree)):
            raise AssertionError('unexpected Close control')
        return tree

    def headings(tree):
        return [node.get('AXLabel') for node, _, _ in ax.walk(tree) if node.get('type') == 'Heading']

    def drag(name, end_y):
        point = ax.centre_of(ax.read_tree(args.device), 'Sheet Grabber')
        if point is None:
            raise AssertionError('no actual native grabber')
        x, y = point
        run([ax.axe_binary(), 'drag', '--udid', args.device, '--start-x', x, '--start-y', y,
             '--end-x', x, '--end-y', end_y, '--duration', '1.2'])
        time.sleep(.9)
        record(name, start=[x, y], end=[x, end_y])
        return snapshot(name)

    def background_rgb(name):
        image = np.asarray(Image.open(args.output / (name + '.png')).convert('RGB'))
        sx, sy = image.shape[1] / width, image.shape[0] / height
        if abs(sx - sy) > .005:
            raise RuntimeError('capture does not match the full native window')
        patch = image[int(10 * sy):int(22 * sy), int(width * .43 * sx):int(width * .55 * sx)]
        return np.median(patch.reshape(-1, 3), axis=0).tolist()

    try:
        listing = json.loads(run(['xcrun', 'simctl', 'list', 'devices', '--json']))
        devices = [device for group in listing['devices'].values() for device in group
                   if device['udid'] == args.device and device['state'] == 'Booted']
        if len(devices) != 1:
            raise RuntimeError('selected simulator is not uniquely booted')
        env = dict(os.environ, OPENREADER_DEVICE=devices[0]['name'])
        tree = snapshot('opening')
        apps = [node for node, _, _ in ax.walk(tree) if node.get('type') == 'Application']
        if len(apps) != 1:
            raise RuntimeError('no unique native app frame')
        x, y, width, height = ax.frame(apps[0])
        if x or y or width <= 0 or height <= 0:
            raise RuntimeError('a full origin-zero native window is required')
        initial = state()
        opening = initial['opening']
        assert 'height' in opening and initial['selection'] == opening and initial['guard'] is False, initial
        opening_grabber = ax.centre_of(tree, 'Sheet Grabber')
        assert opening_grabber is not None
        rgb = background_rgb('opening')
        assert min(rgb) >= 250, rgb
        assert ax.touch(args.device, tree, 'Settings', False) == 0
        time.sleep(.8)
        tree = snapshot('settings-behind')
        assert 'Settings' in headings(tree), headings(tree)
        assert ax.touch(args.device, tree, 'Library', False) == 0
        time.sleep(.8)
        current = state()
        assert current['selection'] == opening and current['guard'] is False, current
        record('opening-background-passed', rgb=rgb, state=current)

        expanded = drag('expand', max(5, height * .025))
        current = state()
        assert current['selection'] == 'large' and current['guard'] is True, current
        assert current['modifierCount'] == initial['modifierCount'], current
        rgb = background_rgb('expand')
        assert 180 <= min(rgb) <= 225, rgb
        assert ax.touch(args.device, expanded, 'Settings', False) == 0
        time.sleep(1)
        tree = snapshot('outside-contracted')
        assert 'Settings' not in headings(tree), headings(tree)
        actual_grabber = ax.centre_of(tree, 'Sheet Grabber')
        assert actual_grabber is not None, 'expanded backdrop dismissed Drawer'
        current = state()
        assert current['selection'] == opening and current['guard'] is False, current
        assert abs(actual_grabber[1] - opening_grabber[1]) <= 2, (actual_grabber, opening_grabber)
        record('accepted-backdrop-contraction-passed', expandedRgb=rgb, state=current)

        tree = drag('expand-again', max(5, height * .025))
        current = state()
        assert current['selection'] == 'large' and current['guard'] is True, current
        expanded_grabber = ax.centre_of(tree, 'Sheet Grabber')
        assert expanded_grabber is not None
        target = opening_grabber[1] + max(12, abs(opening_grabber[1] - expanded_grabber[1]) * .08)
        drag('contract', target)
        current = state()
        assert current['selection'] == opening and current['guard'] is False, current
        tree = drag('dismiss', height - 16)
        assert ax.centre_of(tree, 'Sheet Grabber') is None, 'downward drag did not dismiss'
        record('native-interactions-passed', window={'width': width, 'height': height})
        return 0
    except (RuntimeError, ValueError, AssertionError, subprocess.TimeoutExpired) as error:
        record('failed', error=str(error))
        return 1
    finally:
        (args.output / 'events.json').write_text(json.dumps(events, indent=2))


if __name__ == '__main__':
    sys.exit(main())
