#!/usr/bin/env python3
"""Assert live percentage geometry via the existing Debug harness; no audio.
Run under ios_guard.py, with a Document open. --set stages via a handler,
not native input. With no --set, the saved percentage must already match.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=float, required=True)
    parser.add_argument('--percent', type=int, required=True)
    parser.add_argument('--set', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.percent <= 25 or args.width <= 0:
        parser.error('Require a positive width and a percentage from 0 to 25')
    args.output.mkdir(parents=True, exist_ok=True)

    def run(*command):
        return subprocess.check_output(command, cwd=ROOT, text=True, timeout=20)

    data = Path(run('xcrun', 'simctl', 'get_app_container', args.device, 'top.xujialiu.openreader', 'data').strip())
    settings_file = data / 'Documents/settings.json'
    harness = data / 'Documents/harness.json'
    logs = data / 'Library/Application Support/debug-log'

    def send(body):
        run('node', 'test/manual-test/kit/hx.cjs', args.device, json.dumps({'seq': time.time_ns() // 1000000, **body}))

    original = json.loads(settings_file.read_text())['settings']['appearance']
    if args.set:
        send({'do': 'settings', 'patch': {'appearance': {**original, 'margins': args.percent, 'marginsUnit': 'percent'}}})
        time.sleep(.5)
    saved = json.loads(settings_file.read_text())['settings']['appearance']
    assert (saved['margins'], saved.get('marginsUnit')) == (args.percent, 'percent'), 'Saved percentage differs'
    code = (ROOT / 'test/manual-test/settings/margins-probe.js').read_text()
    deadline = time.monotonic() + 15
    result = None
    try:
        while time.monotonic() < deadline:
            token = 'MARGINS344-' + uuid.uuid4().hex
            send({'do': 'js', 'code': code + '\nreturn ' + json.dumps(token + ' ') + ' + probe();'})
            wait = time.monotonic() + 3
            while time.monotonic() < wait:
                for file in sorted(logs.glob('debug-log-*.txt'), reverse=True):
                    for line in reversed(file.read_text().splitlines()):
                        if '[probe] ' + token + ' ' in line:
                            result = json.loads(line.split(token + ' ', 1)[1])
                            break
                    else:
                        continue
                    break
                if result is not None:
                    break
                time.sleep(.1)
            if result is not None:
                width = result['viewport']['width']
                views = result['views']
                padding = args.width * args.percent / 100
                good = abs(width - args.width) < 1 and bool(views)
                for view in views:
                    body = view['body']
                    good = good and abs(view['iframeWidth'] - args.width) < 1 and abs(body['width'] - args.width) < 1
                    good = good and all(abs(float(body[key].removesuffix('px')) - padding) < .1 for key in ('paddingLeft', 'paddingRight'))
                    good = good and body['marginLeft'] == '0px' and body['marginRight'] == '0px'
                if good:
                    (args.output / 'geometry.json').write_text(json.dumps(result, indent=2))
                    run('xcrun', 'simctl', 'io', args.device, 'screenshot', str(args.output / 'screen.png'))
                    print(json.dumps({'verdict': 'PASS', 'width': width, 'percent': args.percent, 'paddingPerSide': padding, 'views': views}))
                    return
            result_before = result
            result = None
            time.sleep(.25)
        (args.output / 'geometry-failed.json').write_text(json.dumps(result_before if 'result_before' in locals() else result, indent=2))
        raise AssertionError('No settled geometry matching the expected full viewport/percentage; see artifacts')
    finally:
        harness.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
