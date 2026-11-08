#!/usr/bin/env python3
"""One system Escape on the approved isolated iOS-on-Mac Drawer probe.

Stage the known opening/large height through real UI first. Run inside
kit/ios_guard.py with this probe already frontmost; this tool never activates
another app or targets the owner installation. No app handler is invoked.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

PROBE_ID = 'top.xujialiu.openreader.drawerprobe'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app')
    parser.add_argument('window', type=int)
    parser.add_argument('output', type=Path)
    parser.add_argument('--state', choices=['opening', 'expanded'], required=True)
    args = parser.parse_args()
    try:
        args.output.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        print('BLOCKED: use a new artifact directory', file=sys.stderr)
        return 69
    if args.app != PROBE_ID:
        print('BLOCKED: only the separately approved drawerprobe identity is supported', file=sys.stderr)
        return 69

    def capture(name):
        result = subprocess.run(['orca', 'computer', 'get-app-state', '--app', args.app,
                                 '--window-id', str(args.window), '--json'],
                                capture_output=True, text=True, timeout=25)
        (args.output / (name + '.json')).write_text(result.stdout + result.stderr)
        result.check_returncode()
        response = json.loads(result.stdout)
        if not response['ok']:
            raise RuntimeError('Orca capture failed: ' + json.dumps(response.get('error')))
        snapshot = response['result']['snapshot']
        if (snapshot['app']['bundleId'] != args.app or snapshot.get('treeDiff')
                or snapshot['window']['id'] != args.window):
            raise RuntimeError('expected a full snapshot of the exact isolated app/window')
        screenshot = response['result'].get('screenshot', {}).get('path')
        if screenshot:
            shutil.copy2(screenshot, args.output / (name + '.png'))
        return snapshot

    try:
        before = capture('before')
        text = before['treeText']
        if 'button Sheet Grabber' not in text:
            raise RuntimeError('no open native Drawer')
        expected = 'Value: Expanded' if args.state == 'expanded' else 'Value: Half screen'
        if expected not in text:
            raise RuntimeError('known staged Drawer height is not present')
        pid = int(before['app']['pid'])
        script = ('tell application "System Events"\n'
                  f' set p to first application process whose unix id is {pid}\n'
                  ' if not frontmost of p then error "Isolated probe is not frontmost"\n'
                  ' key code 53\n'
                  'end tell')
        sent = subprocess.run(['osascript', '-e', script], capture_output=True,
                              text=True, timeout=25)
        (args.output / 'system-key.txt').write_text(sent.stdout + sent.stderr)
        if sent.returncode:
            raise RuntimeError('system Escape was not qualified: ' + sent.stderr[:600])
        time.sleep(1.4)
        after = capture('after')
        if after['app']['pid'] != pid:
            raise RuntimeError('app process changed during the input')
        passed = 'button Sheet Grabber' not in after['treeText']
        record = {
            'verdict': 'PASS' if passed else 'FAIL',
            'app': args.app,
            'pid': pid,
            'window': args.window,
            'stagedHeight': args.state,
            'input': 'one foreground System Events Escape (key code 53)',
            'drawerRetained': not passed,
            'afterTree': after['treeText'],
        }
        (args.output / 'result.json').write_text(json.dumps(record, indent=2))
        print(json.dumps(record))
        return 0 if passed else 1
    except (RuntimeError, ValueError, subprocess.SubprocessError) as error:
        (args.output / 'blocked.txt').write_text(str(error))
        print('BLOCKED: ' + str(error), file=sys.stderr)
        return 69


if __name__ == '__main__':
    sys.exit(main())
