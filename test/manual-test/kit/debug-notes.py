#!/usr/bin/env python3
"""Every Debug Note in a copied Debug Log (#305, ADR 0082; docs/debug-on-iphone.md).

    python3 debug-notes.py LOG

LOG is a Debug Log file or the folder `debug-log.py` copied (OUT_DIR/debug-log); a folder's
`debug-log-NNNNNN.txt` files are read oldest first. A Debug Note is what the author wrote about a
fault from the reader's `Debug` row, one `[debug-note]` line each, written at Save:

    2026-10-20 14:03:32.345 +08:00 [debug-note] 2026-10-20 14:03:12.345 +08:00 "Title" (5f1c9a2b): comment

The time inside the message is the Debug Note's own, the tap on Debug, and it is what the author
copied. Each note is printed on one line under that time:

    2026-10-20 14:03:12.345 +08:00  "Title" (5f1c9a2b): comment

first the version that wrote the folder (its `version.txt`), when there is one. A blank comment
reads `(no comment)`. To find a note by what it says, read the list; for the lines around one,
`debug-log-timeline.py LOG --around '<its time>'`. The `[reading] note: …` lines are the player's
notes, not Debug Notes, and are not listed.

Exit status: 0 with at least one note, 1 with none or no log.
"""
import glob
import os
import re
import sys

LINE = re.compile(r'^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d \[debug-note\] '
                  r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d) (.*)$')


def files_of(path):
    if os.path.isdir(path):
        return sorted(glob.glob(os.path.join(path, 'debug-log-*.txt')), key=os.path.basename)
    return [path] if os.path.exists(path) else []


def main():
    if len(sys.argv) != 2 or sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        return 0 if len(sys.argv) == 2 else 1
    log = sys.argv[1]
    paths = files_of(log)
    if not paths:
        print(f'no debug-log-*.txt in {log}', file=sys.stderr)
        return 1
    version = os.path.join(log if os.path.isdir(log) else os.path.dirname(log), 'version.txt')
    if os.path.exists(version):
        with open(version, encoding='utf-8', errors='replace') as handle:
            print(f'Debug Log written by {handle.read().strip()}')
    found = 0
    for path in paths:
        with open(path, encoding='utf-8', errors='replace') as handle:
            for raw in handle:
                note = LINE.match(raw.rstrip('\n'))
                if note:
                    print(f'{note.group(1)}  {note.group(2)}')
                    found += 1
    if not found:
        print(f'no Debug Note in {log}', file=sys.stderr)
        return 1
    print(f'{found} Debug Note{"" if found == 1 else "s"} in {log}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
