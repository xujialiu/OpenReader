#!/usr/bin/env python3
"""Type a name through the real keyboard, submit, and assert the exact saved name.

Run on a disposable Library page with no drawer open. Creates a Folder unless
--folder names an existing Folder to rename. Leaves successful and failed saves
in place; never retries typing or silently repairs a wrong name. No audio.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

KIT = Path(__file__).resolve().parents[1] / 'kit'
sys.path.insert(0, str(KIT))
import ax  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('udid')
    parser.add_argument('artifacts', type=Path, help='New artifact directory')
    parser.add_argument('--value', required=True, help='Non-secret printable ASCII name')
    parser.add_argument('--folder', help='Current name of the Folder to rename on this page')
    parser.add_argument('--open-alert', action='store_true', help='The matching name editor is already open')
    args = parser.parse_args()
    for value in (args.value, args.folder):
        if value is not None and (not value.strip() or len(value) > 80 or any(ord(c) < 32 or ord(c) > 126 for c in value)):
            parser.error('Use nonblank, non-secret printable ASCII names of at most 80 characters')
    args.artifacts.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    serial = 0
    binary = ax.axe_binary()

    def run(command):
        nonlocal serial
        serial += 1
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        (args.artifacts / f'{serial:02}-command.json').write_text(json.dumps({
            'at': time.time(), 'command': command, 'exit': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr,
        }, indent=2))
        result.check_returncode()
        return result.stdout

    def tree():
        return json.loads(run([binary, 'describe-ui', '--udid', args.udid]))

    def touch(label, alert=None):
        deadline = time.monotonic() + 10
        while True:
            snapshot = tree()
            if alert:
                sheets = [n for n, _, _ in ax.walk(snapshot)
                          if n.get('type') == 'Sheet' and n.get('AXLabel') == alert]
                snapshot = sheets
            point = ax.centre_of(snapshot, label)
            if point:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f'No visible control {label!r} in {alert or "page"}')
            time.sleep(.1)
        run([binary, 'touch', '-x', str(point[0]), '-y', str(point[1]),
             '--down', '--up', '--delay', '.2', '--udid', args.udid])

    try:
        container = Path(run(['xcrun', 'simctl', 'get_app_container', args.udid,
                              'top.xujialiu.openreader', 'data']).strip())
        store = container / 'Documents/library-folders.json'
        initial = json.loads(store.read_text()) if store.exists() else {'folders': [], 'current': None}
        (args.artifacts / 'before.json').write_text(json.dumps(initial, indent=2))
        parent = initial['current']
        selected = [f for f in initial['folders'] if f['name'] == args.folder and f['parent'] == parent]
        if args.folder and len(selected) != 1:
            raise RuntimeError('Expected exactly one named Folder on the browsed page')
        if any(f['parent'] == parent and f not in selected and
               f['name'].strip().lower() == args.value.strip().lower() for f in initial['folders']):
            raise RuntimeError('Choose a free name; duplicate refusal is covered by input-integrity.py')
        title, button = ('Rename', 'Save') if args.folder else ('Create folder', 'Create')
        if not args.open_alert:
            touch(f'Actions for folder {args.folder}' if args.folder else 'Library actions')
            # AX can expose a drawer's destination frames before its opening
            # animation accepts touches (pitfalls/mcp.md). This is before any
            # typing, not an input-settling workaround.
            time.sleep(1)
            touch('Rename' if args.folder else 'Create folder')
        deadline = time.monotonic() + 8
        while not any(n.get('type') == 'Sheet' and n.get('AXLabel') == title
                      for n, _, _ in ax.walk(tree())):
            if time.monotonic() >= deadline:
                raise RuntimeError('Name editor did not appear')
            time.sleep(.1)
        run([sys.executable, str(KIT / 'alert-input.py'), args.udid,
             str(args.artifacts / 'input'), '--title', title,
             '--before', args.folder or '', '--value', args.value])
        touch(button, alert=title)
        # Read after the real submit has dismissed the name editor, not after a
        # tool merely reported that its touch command completed.
        deadline = time.monotonic() + 8
        while True:
            after_tree = tree()
            if not any(n.get('type') == 'Sheet' and n.get('AXLabel') == title
                       for n, _, _ in ax.walk(after_tree)):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Name editor did not dismiss after submission')
        # SwiftUI dismisses the alert before JS's save/write necessarily finishes.
        # Wait for the store outcome, not just for the native dismissal.
        deadline = time.monotonic() + 8
        before_ids = {f['id'] for f in initial['folders']}
        while True:
            after = json.loads(store.read_text()) if store.exists() else initial
            if args.folder:
                saved = [f for f in after['folders'] if f['id'] == selected[0]['id']]
            else:
                saved = [f for f in after['folders'] if f['id'] not in before_ids]
            actual = [f['name'] for f in saved]
            changed = actual != [args.folder] if args.folder else bool(saved)
            if changed or actual == [args.value] or time.monotonic() >= deadline:
                break
            time.sleep(.05)
        (args.artifacts / 'after.json').write_text(json.dumps(after, indent=2))
        if len(saved) != 1 or actual != [args.value] or saved[0]['parent'] != parent:
            raise AssertionError(f'Native {args.value!r}; saved {actual!r}; expected one unchanged-parent Folder named {args.value!r}')
        # The row must agree with the file as well; wait for the drawer dismissal.
        deadline = time.monotonic() + 8
        while not ax.centre_of(after_tree, f'Actions for folder {args.value}'):
            if time.monotonic() >= deadline:
                raise AssertionError(f'Saved {args.value!r}, but its Library row is missing')
            after_tree = tree()
        elapsed = round(time.monotonic() - started, 2)
        (args.artifacts / 'result.json').write_text(json.dumps({
            'intended': args.value, 'native': args.value, 'persisted': actual[0],
            'folder': saved[0]['id'], 'seconds': elapsed,
        }, indent=2))
        print(f'PASS native = saved = row: {args.value!r} ({elapsed}s)')
        return 0
    except AssertionError as error:
        (args.artifacts / 'failure.txt').write_text(str(error))
        print(f'FAIL: {error} ({time.monotonic() - started:.2f}s); state retained at {args.artifacts}', file=sys.stderr)
        return 1
    except Exception as error:
        (args.artifacts / 'failure.txt').write_text(repr(error))
        print(f'BLOCKED: {error}; inspect {args.artifacts}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
