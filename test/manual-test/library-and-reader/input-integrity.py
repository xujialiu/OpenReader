#!/usr/bin/env python3
"""Real name input -> duplicate warning -> preserved draft -> exact persisted rename.

Use an idle disposable Library at root, with two existing sibling folders.
Creates no folders through the harness. Original name is restored only on success;
a failure preserves UI/disk state and artifacts for diagnosis. No audio or retries.
"""
import argparse
import json
import re
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
    parser.add_argument('artifacts', type=Path)
    parser.add_argument('--folder', required=True)
    parser.add_argument('--collision', required=True)
    parser.add_argument('--rounds', type=int, default=3, choices=range(1, 11))
    parser.add_argument('--create-cycles', action='store_true', help='Type an existing sibling into Create, assert exact warning, Cancel and reopen')
    parser.add_argument('--settle', type=int, choices=(0, 8), default=0, help='Controlled delay before submit, for race diagnosis only')
    parser.add_argument('--baseline-mcp-replace', action='store_true',
                        help='Diagnose mobilebuildmcp 2.7.1 replacement instead of the checked helper')
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=False)
    serial = 0

    def run(command):
        nonlocal serial
        serial += 1
        result = subprocess.run(command, capture_output=True, text=True, timeout=90)
        (args.artifacts / f'{serial:03}-command.json').write_text(json.dumps({
            'at': time.time(), 'command': command, 'exit': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr}, indent=2))
        result.check_returncode()
        return result.stdout

    def tree():
        return json.loads(run([ax.axe_binary(), 'describe-ui', '--udid', args.udid]))

    def wait_label(label):
        end = time.monotonic() + 10
        while True:
            snapshot = tree()
            point = ax.centre_of(snapshot, label)
            if point:
                return point
            if time.monotonic() >= end:
                raise ValueError(f'Expected visible control {label!r}')

    def touch(label):
        x, y = wait_label(label)
        run([ax.axe_binary(), 'touch', '-x', str(x), '-y', str(y),
             '--down', '--up', '--delay', '.2', '--udid', args.udid])

    def replace(before, value, round_name):
        if args.baseline_mcp_replace:
            cli = ['npx', '-y', 'mobilebuildmcp@2.7.1', 'ui-automation']
            snapshot = run([*cli, 'snapshot-ui', '--simulator-id', args.udid])
            refs = re.findall(r'(e[0-9]+)\|typeText\|text-field', snapshot)
            if len(refs) != 1:
                raise ValueError('Baseline requires exactly one native field')
            run([*cli, 'type-text', '--simulator-id', args.udid, '--element-ref', refs[0],
                 '--text', value, '--replace-existing'])
            fields = [n for n, _, _ in ax.walk(tree()) if n.get('type') == 'TextField']
            if len(fields) != 1 or fields[0].get('AXValue') != value:
                raise ValueError(f'MCP replacement mismatch: intended {value!r}, native {fields!r}')
        else:
            run([sys.executable, str(KIT / 'alert-input.py'), args.udid,
                 str(args.artifacts / round_name), '--title', 'Rename',
                 '--before', before, '--value', value])

    try:
        container = Path(run(['xcrun', 'simctl', 'get_app_container', args.udid,
                              'top.xujialiu.openreader', 'data']).strip())
        store = container / 'Documents/library-folders.json'
        initial = json.loads(store.read_text())
        if initial['current'] is not None or args.folder == args.collision:
            raise ValueError('Start at Library root with two distinct sibling folders')
        selected = [f for f in initial['folders'] if f['name'] == args.folder and f['parent'] is None]
        collisions = [f for f in initial['folders'] if f['name'] == args.collision and f['parent'] is None]
        if len(selected) != 1 or len(collisions) != 1:
            raise ValueError('Both named root fixture folders must already exist')
        folder_id = selected[0]['id']
        (args.artifacts / 'initial.json').write_text(json.dumps(initial))

        def persisted(expected, stage):
            end = time.monotonic() + 8
            while True:
                data = json.loads(store.read_text())
                actual = [f['name'] for f in data['folders'] if f['id'] == folder_id]
                if actual == [expected] or time.monotonic() >= end:
                    break
                time.sleep(.1)
            (args.artifacts / f'{stage}-persisted.json').write_text(json.dumps(data))
            if actual != [expected]:
                raise ValueError(f'Persisted {actual!r}, intended {expected!r}')

        if args.create_cycles:
            for index in range(args.rounds):
                snapshot = tree()
                if not ax.centre_of(snapshot, 'Create folder'):
                    touch('Add')
                touch('Create folder')
                fields = [n for n, _, _ in ax.walk(tree()) if n.get('type') == 'TextField']
                if len(fields) != 1 or fields[0].get('AXValue') != 'Name':
                    raise ValueError('Create field must start empty')
                run([ax.axe_binary(), 'type', args.collision, '--udid', args.udid])
                fields = [n for n, _, _ in ax.walk(tree()) if n.get('type') == 'TextField']
                if len(fields) != 1 or fields[0].get('AXValue') != args.collision:
                    raise ValueError('Create native input differs from intended name')
                if args.settle:
                    time.sleep(args.settle)
                touch('Create')
                wait_label('Back to editing')
                labels = [n.get('AXLabel') or '' for n, _, _ in ax.walk(tree())]
                if not any(f'“{args.collision}”' in label for label in labels):
                    raise ValueError('Warning quoted a different name than the native field')
                data = json.loads(store.read_text())
                (args.artifacts / f'{index}-refused.json').write_text(json.dumps(data))
                if data != initial:
                    raise ValueError('Duplicate submission mutated persisted folders')
                touch('Cancel')
                print(f'PASS create/cancel {index}: native, exact warning, unchanged disk', flush=True)
            return 0

        current = args.folder
        for index in range(args.rounds):
            touch(f'Actions for folder {current}')
            touch('Rename')
            replace(current, args.collision, f'{index}-duplicate-input')
            touch('Save')
            wait_label('Back to editing')
            labels = [n.get('AXLabel') or '' for n, _, _ in ax.walk(tree())]
            if not any(f'“{args.collision}”' in label for label in labels):
                raise ValueError('Warning quoted a different name than the native field')
            persisted(current, f'{index}-refused')
            touch('Back to editing')
            next_name = f'{args.folder}-input{index}x'
            if any(f['name'] == next_name and f['parent'] is None for f in initial['folders']):
                raise ValueError('Generated fixture name already exists')
            # --before asserts the warning kept exactly the draft that was typed.
            replace(args.collision, next_name, f'{index}-edited-input')
            touch('Save')
            persisted(next_name, f'{index}-saved')
            wait_label(f'Actions for folder {next_name}')
            current = next_name
            print(f'PASS round {index}: native input, warning, draft, persisted name', flush=True)
        touch(f'Actions for folder {current}')
        touch('Rename')
        replace(current, args.folder, 'restore-input')
        touch('Save')
        persisted(args.folder, 'restored')
        wait_label(f'Actions for folder {args.folder}')
        return 0
    except Exception as error:
        (args.artifacts / 'failure.txt').write_text(repr(error))
        print(f'FAIL: {error}; state retained, inspect {args.artifacts}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
