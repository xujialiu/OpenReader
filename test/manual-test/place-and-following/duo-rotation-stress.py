#!/usr/bin/env python3
"""Bounded real-input stress for #359; keep one paused inner Reader mounted.

Run inside ios_guard.py. Supply fresh Device Hub window-point coordinates.
The ordinary duo-rotation.py round-trip is still required: this stress driver
checks convergence between bursts, not native direction after every input.
No audio, forced geometry, reflow injection or Reading restart is performed.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
DRIVER = Path(__file__).with_name('duo-rotation.py')
spec = importlib.util.spec_from_file_location('duo_rotation', DRIVER)
rotation = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(rotation)

ARM = '''function probe() {
  if (window.__openReaderRotationStress) throw Error('Stress recorder already installed');
  const state = window.__openReaderRotationStress = {events:0,samples:[]};
  state.handler = function() {
    const m = rendition.manager;
    state.events++;
    state.samples.push({w:innerWidth,h:innerHeight,s:m.stage.container.clientWidth,
      i:m.views.all().filter(v=>v.displayed).map(v=>v.iframe.clientWidth)});
    if(state.samples.length>8)state.samples.shift();
  };
  window.addEventListener('resize',state.handler);
  return JSON.stringify({armed:true,locationGuard:!!rendition.manager.openreaderReadsLocation});
}'''
READ = '''function probe() {
  const m=rendition.manager,state=window.__openReaderRotationStress;
  return JSON.stringify({viewport:{width:innerWidth,height:innerHeight},
    stage:{width:m.stage.container.clientWidth,height:m.stage.container.clientHeight},
    recordedStage:m._stageSize,
    views:m.views.all().filter(v=>v.displayed).map(v=>({width:v.iframe.clientWidth})),
    events:state.events,recent:state.samples});
}'''
REMOVE = '''function probe() {
  const state=window.__openReaderRotationStress;
  if(state){window.removeEventListener('resize',state.handler);delete window.__openReaderRotationStress;}
  return JSON.stringify({removed:true});
}'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path)
    parser.add_argument('--hub-pid', type=int, required=True)
    parser.add_argument('--window-id', type=int, required=True)
    parser.add_argument('--rotate', type=float, nargs=2, required=True, metavar=('X', 'Y'))
    parser.add_argument('--metro', required=True)
    parser.add_argument('--cycles', type=int, choices=range(1, 21), default=8)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    records = []
    outcome = {'outcome': 'BLOCKED'}
    harness = None
    armed = False
    exit_code = 69

    def run(*command, timeout=30):
        return subprocess.check_output(command, cwd=ROOT, text=True, timeout=timeout)

    def assert_current(label):
        run('python3', str(DRIVER), args.device, str(args.output / label),
            '--hub-pid', str(args.hub_pid), '--window-id', str(args.window_id),
            '--rotate', *map(str, args.rotate), '--display', '3', '--reader',
            '--turns', '0', '--start-device', '1', '--metro', args.metro, timeout=65)
        return json.loads((args.output / label / 'records.json').read_text())['steps'][0]['native']

    try:
        run('python3', str(ROOT / 'test/manual-test/kit/ios_guard.py'), 'check-owner')
        first = assert_current('baseline')
        data = Path(run('xcrun', 'simctl', 'get_app_container', args.device,
                        'top.xujialiu.openreader', 'data').strip())
        harness = data / 'Documents/harness.json'
        logs = data / 'Library/Application Support/debug-log'

        def positions():
            entries = json.loads((data / 'Documents/library.json').read_text())['entries']
            return {entry['id']: entry.get('position') for entry in entries}

        def probe(source):
            token = 'STRESS359-' + uuid.uuid4().hex
            temporary = harness.with_name('.rotation-' + token + '.json')
            temporary.write_text(json.dumps({'seq': time.time_ns() // 1000000, 'do': 'js',
                                             'code': source + '\nreturn ' + json.dumps(token + ' ') + ' + probe();'}))
            temporary.replace(harness)
            until = time.monotonic() + 12
            while time.monotonic() < until:
                for file in sorted(logs.glob('debug-log-*.txt'), reverse=True):
                    for line in reversed(file.read_text().splitlines()):
                        if '[probe] ' + token + ' ' in line:
                            return json.loads(line.split(token + ' ', 1)[1])
                time.sleep(.1)
            raise rotation.InputBlocked('No fresh target-side stress reply')

        before_positions = positions()
        records.append({'armed': probe(ARM)})
        armed = True
        last_events = 0
        for cycle in range(1, args.cycles + 1):
            for turn in range(4):
                raw = run('orca', 'computer', 'click', '--app', f'pid:{args.hub_pid}',
                          '--window-id', str(args.window_id), '--x', str(args.rotate[0]),
                          '--y', str(args.rotate[1]), '--no-screenshot', '--json')
                (args.output / f'input-{cycle}-{turn}.json').write_text(raw)
                if not json.loads(raw).get('ok'):
                    raise rotation.InputBlocked('Device Hub input dispatch failed')
                time.sleep(.1)
            time.sleep(.5)
            page = probe(READ)
            records.append({'cycle': cycle, 'page': page})
            if page['events'] - last_events < 4:
                raise rotation.InputBlocked('Fewer than four target-page resize events in a burst; input history is incomplete')
            last_events = page['events']
            try:
                rotation.check_reader(first, page)
            except AssertionError:
                # A single transition frame is not a persistent failure.
                time.sleep(.5)
                confirm = probe(READ)
                records.append({'cycle': cycle, 'confirm': confirm})
                commands = args.output / 'baseline/read-native.lldb'
                raw = run('bash', str(ROOT / 'test/manual-test/kit/owned-lldb.sh'), args.device, str(commands))
                (args.output / f'cycle-{cycle}-native.log').write_text(raw)
                current = rotation.parse_native(raw)
                rotation.check_response(first, current, 1, basis=first)
                records.append({'cycle': cycle, 'native': current})
                run('xcrun', 'simctl', 'io', args.device, 'screenshot', '--display=3',
                    str(args.output / f'cycle-{cycle}.png'))
                rotation.check_reader(current, confirm)
            print(json.dumps({'cycle': cycle, 'viewport': page['viewport']['width'],
                              'iframes': [v['width'] for v in page['views']], 'events': page['events']}), flush=True)
        last = assert_current('final')
        rotation.check_response(first, last, 1, basis=first)
        # The ordinary driver checks paused state before/after; compare positions
        # across the ENTIRE stress run too, not just its two read-only checks.
        if positions() != before_positions:
            raise AssertionError('Stress changed a saved Reading Position')
        outcome = {'outcome': 'PASS', 'cycles': args.cycles, 'samePID': first['pid'],
                   'savedPositionsUnchanged': True, 'playing': False,
                   'screenshotsRequireVisualReview': True}
        print(json.dumps(outcome), flush=True)
        exit_code = 0
    except AssertionError as error:
        outcome = {'outcome': 'FAIL', 'reason': str(error)}
        print(json.dumps(outcome), file=sys.stderr)
        exit_code = 1
    except (rotation.InputBlocked, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        outcome = {'outcome': 'BLOCKED', 'reason': str(error)}
        print(json.dumps(outcome), file=sys.stderr)
        exit_code = 69
    finally:
        cleanup_failed = False
        if armed:
            try:
                records.append({'cleanup': probe(REMOVE)})
            except (OSError, ValueError, KeyError, subprocess.SubprocessError, rotation.InputBlocked) as error:
                outcome['cleanupError'] = str(error)
                cleanup_failed = True
                if exit_code == 0:
                    outcome['outcome'] = 'BLOCKED'
                    exit_code = 69
        if harness is not None:
            harness.unlink(missing_ok=True)
        (args.output / 'records.json').write_text(json.dumps({'result': outcome, 'steps': records}, indent=2))
        if cleanup_failed:
            print(json.dumps({'cleanup': 'incomplete', 'outcome': outcome['outcome']}), file=sys.stderr)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
