#!/usr/bin/env python3
"""Replace one native name-alert field, verify it, and leave submission to the caller.

Only non-secret ASCII fixture names are supported. Artifacts contain field text.
No retry after a mismatch: inspect the preserved state rather than appending again.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

import ax


def require_value(actual, expected, placeholder):
    # The native empty alert field exposes its placeholder as AXValue.
    if actual != (expected if expected else placeholder):
        raise ValueError(f"Expected {expected!r}, native field reads {actual!r}")


def alert_field(tree, title):
    sheets = [node for node, _, _ in ax.walk(tree)
              if node.get('type') == 'Sheet' and node.get('AXLabel') == title]
    if len(sheets) != 1:
        raise ValueError(f"Expected exactly one native alert titled {title!r}")
    fields = [node for node, _, _ in ax.walk(sheets[0]) if node.get('type') == 'TextField']
    if len(fields) != 1 or not fields[0].get('enabled'):
        raise ValueError('Expected exactly one enabled, unmasked alert field')
    return fields[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('udid')
    parser.add_argument('artifacts', type=Path, help='New directory; existing directories are refused')
    parser.add_argument('--title', required=True, help='Exact native alert title')
    parser.add_argument('--before', required=True, help='Expected current text, empty for a fresh field')
    parser.add_argument('--value', required=True, help='Intended replacement; empty tests blank-disabled Save')
    parser.add_argument('--placeholder', default='Name')
    args = parser.parse_args()
    for text in (args.before, args.value):
        if len(text) > 80 or any(ord(c) < 32 or ord(c) > 126 for c in text):
            parser.error('Use non-secret printable ASCII fixture names of at most 80 characters')
    args.artifacts.mkdir(parents=True, exist_ok=False)
    binary = ax.axe_binary()
    serial = 0

    def command(*parts):
        nonlocal serial
        serial += 1
        argv = [binary, *parts, '--udid', args.udid]
        try:
            result = subprocess.run(argv, capture_output=True, text=True, timeout=40)
        except subprocess.TimeoutExpired as error:
            (args.artifacts / f'{serial:02}-timeout.txt').write_text(str(error))
            raise
        (args.artifacts / f'{serial:02}-command.json').write_text(json.dumps({
            'at': time.time(), 'command': argv, 'exit': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr,
        }, indent=2))
        result.check_returncode()
        return result.stdout

    def field():
        return alert_field(json.loads(command('describe-ui')), args.title)

    try:
        before = field()
        require_value(before.get('AXValue'), args.before, args.placeholder)
        x, y, width, height = ax.frame(before)
        if width <= 0 or height <= 0:
            raise ValueError('Field has no touchable frame')
        # Like RenameProbe: focus at the right edge, not in the middle of text.
        command('touch', '-x', str(x + width * .97), '-y', str(y + height / 2),
                '--down', '--up', '--delay', '0.2')
        if args.before:
            command('key-sequence', '--keycodes', ','.join(['42'] * (len(args.before) + 1)))
        require_value(field().get('AXValue'), '', args.placeholder)
        if args.value:
            command('type', args.value)
        actual = field().get('AXValue')
        require_value(actual, args.value, args.placeholder)
        # Independent fresh native read, not a tool's "typed successfully" line.
        require_value(field().get('AXValue'), args.value, args.placeholder)
        (args.artifacts / 'result.json').write_text(json.dumps({
            'intended': args.value, 'native': actual, 'submitted': False,
        }, indent=2))
        print('PASS native field exact; NOT submitted or persistence-verified')
        return 0
    except Exception as error:
        (args.artifacts / 'failure.txt').write_text(repr(error))
        try:
            command('describe-ui')
        except Exception:
            pass
        print(f'FAIL: {error}; inspect {args.artifacts}; field left unsubmitted', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
