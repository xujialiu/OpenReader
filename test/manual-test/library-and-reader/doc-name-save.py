#!/usr/bin/env python3
"""Rename a Document through the real keyboard from the Library or the Reader.

Real touches only: opens the document's actions drawer, touches Rename, types
through kit/alert-input.py, presses the alert's own Save, then requires the new
title in display-names.json, library.json and on screen (the Library row's
actions button in --mode library, the reader's title in --mode reader). Never
retries typing or restores state. Successful and failed renames stay in place.

  python3 doc-name-save.py UDID NEW_OUTPUT_DIR --mode library \
    --current 'A Short Test of Reading Aloud' --value 'Renamed In Library'
  python3 doc-name-save.py UDID NEW_OUTPUT_DIR --mode reader \
    --current 'Renamed In Library' --value 'Renamed Twice'

--mode reader starts on the Library page and opens the Reader itself. Run from
the repository root. Exit 0 PASS, 1 saved-name/title mismatch, 2 setup or input
failure. Artifacts: NN-command.json, input/, stores/, result.json, failure.txt.
ASCII fixture names only (kit/alert-input.py's limit). No audio.
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
    parser.add_argument('--mode', choices=('library', 'reader'), required=True)
    parser.add_argument('--current', required=True, help='Exact current title of the Document')
    parser.add_argument('--value', required=True, help='Non-secret printable ASCII new name')
    args = parser.parse_args()
    for value in (args.current, args.value):
        if not value.strip() or len(value) > 80 or any(ord(c) < 32 or ord(c) > 126 for c in value):
            parser.error('Use nonblank, non-secret printable ASCII names of at most 80 characters')
    args.artifacts.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    serial = 0

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
        return json.loads(run([ax.axe_binary(), 'describe-ui', '--udid', args.udid]))

    def centre(label, snapshot=None):
        return ax.centre_of(snapshot if snapshot is not None else tree(), label)

    def touch_when(label, scope_title=None, seconds=10):
        deadline = time.monotonic() + seconds
        while True:
            snapshot = tree()
            scoped = snapshot
            if scope_title is not None:
                scoped = [n for n, _, _ in ax.walk(snapshot)
                          if n.get('type') == 'Sheet' and n.get('AXLabel') == scope_title]
            # A missing alert must not fall back to a same-labelled control
            # behind it (pitfalls/mcp.md).
            point = centre(label, scoped)
            if point:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f'No visible control {label!r} in {scope_title or "page"}')
            time.sleep(.1)
        run([ax.axe_binary(), 'touch', '-x', str(point[0]), '-y', str(point[1]),
             '--down', '--up', '--delay', '.2', '--udid', args.udid])

    def stores():
        container = Path(run(['xcrun', 'simctl', 'get_app_container', args.udid,
                              'top.xujialiu.openreader', 'data']).strip())
        documents = container / 'Documents'
        names = documents / 'display-names.json'
        library = documents / 'library.json'
        return {
            'display-names.json': json.loads(names.read_text()) if names.exists() else {},
            'library.json': json.loads(library.read_text()) if library.exists() else {},
        }

    def snapshot_stores(tag):
        data = stores()
        (args.artifacts / f'stores-{tag}.json').write_text(json.dumps(data, indent=2))
        return data

    def document_id(before):
        matches = [entry for entry in before['library.json'].get('entries', [])
                   if entry.get('title') == args.current]
        if len(matches) != 1:
            raise RuntimeError('Use a uniquely named Document fixture in the Library')
        return matches[0].get('id')

    try:
        before = snapshot_stores('before')
        identifier = document_id(before)
        if identifier is None:
            raise RuntimeError(f'No Library entry titled {args.current!r} before the rename')

        if args.mode == 'library':
            touch_when(f'Actions for {args.current}')
            # AX can expose a drawer's destination frames before its opening
            # animation accepts touches (pitfalls/mcp.md). This is before any
            # typing, not an input-settling workaround.
            time.sleep(1)
            touch_when('Rename')
        else:
            row = None
            deadline = time.monotonic() + 10
            while row is None:
                snapshot = tree()
                for node, _, _ in ax.walk(snapshot):
                    label = str(node.get('AXLabel', ''))
                    if label.startswith(f'{args.current}, ') or label == args.current:
                        row = label
                        break
                if row or time.monotonic() >= deadline:
                    break
                time.sleep(.1)
            if not row:
                raise RuntimeError(f'No Library row for {args.current!r}')
            touch_when(row, seconds=10)
            touch_when('More actions', seconds=20)
            time.sleep(1)
            touch_when('Rename')

        deadline = time.monotonic() + 8
        while not any(n.get('type') == 'Sheet' and n.get('AXLabel') == 'Rename'
                      for n, _, _ in ax.walk(tree())):
            if time.monotonic() >= deadline:
                raise RuntimeError('Name editor did not appear')
            time.sleep(.1)
        run([sys.executable, str(KIT / 'alert-input.py'), args.udid,
             str(args.artifacts / 'input'), '--title', 'Rename',
             '--before', args.current, '--value', args.value])
        touch_when('Save', scope_title='Rename')
        deadline = time.monotonic() + 8
        while any(n.get('type') == 'Sheet' and n.get('AXLabel') == 'Rename'
                  for n, _, _ in ax.walk(tree())):
            if time.monotonic() >= deadline:
                raise RuntimeError('Name editor did not dismiss after submission')
            time.sleep(.1)

        # SwiftUI dismisses the alert before JS's write necessarily finishes.
        deadline = time.monotonic() + 8
        while True:
            after = snapshot_stores('after')
            names = after['display-names.json'].get('names', {})
            entries = [e for e in after['library.json'].get('entries', []) if e.get('id') == identifier]
            titles = [e.get('title') for e in entries]
            if (names.get(identifier) == args.value and titles == [args.value]) \
                    or time.monotonic() >= deadline:
                break
            time.sleep(.05)

        on_screen = False
        deadline = time.monotonic() + 8
        while True:
            snapshot = tree()
            labels = [str(n.get('AXLabel', '')) for n, _, _ in ax.walk(snapshot)]
            values = [str(n.get('AXValue', '')) for n, _, _ in ax.walk(snapshot)]
            if args.mode == 'library':
                on_screen = f'Actions for {args.value}' in labels
            else:
                on_screen = (args.value in labels or args.value in values) \
                    and 'More actions' in labels
            if on_screen or time.monotonic() >= deadline:
                break
            time.sleep(.2)

        problems = []
        if names.get(identifier) != args.value:
            problems.append(f'display-names.json[{identifier}] = {names.get(identifier)!r}, expected {args.value!r}')
        if titles != [args.value]:
            problems.append(f'library.json title = {titles!r}, expected [{args.value!r}]')
        if not on_screen:
            problems.append(f'the new title is not on screen in {args.mode} mode')
        if problems:
            raise AssertionError('; '.join(problems))
        (args.artifacts / 'result.json').write_text(json.dumps({
            'mode': args.mode, 'intended': args.value, 'display-name': names.get(identifier),
            'library-title': titles[0], 'on-screen': True,
            'seconds': round(time.monotonic() - started, 2),
        }, indent=2))
        print(f'PASS renamed to {args.value!r} in stores and on screen ({round(time.monotonic() - started, 2)}s)')
        return 0
    except AssertionError as error:
        (args.artifacts / 'failure.txt').write_text(str(error))
        print(f'FAIL: {error}; state retained at {args.artifacts}', file=sys.stderr)
        return 1
    except Exception as error:
        (args.artifacts / 'failure.txt').write_text(repr(error))
        print(f'BLOCKED: {error}; inspect {args.artifacts}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
