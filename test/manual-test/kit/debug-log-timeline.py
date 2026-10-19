#!/usr/bin/env python3
"""The Debug Log as a timeline: every line that changes something, with the app's state beside it
(docs/debug-on-iphone.md).

    python3 debug-log-timeline.py LOG [--from '2026-10-01 01:25'] [--to '2026-10-01 01:50']
                                      [--skip sync,download,provider] [--width 220]
    python3 debug-log-timeline.py LOG --around '2026-10-20 14:03:12.345 +08:00' [--before 10] [--after 2]

LOG is a Debug Log file or the folder `debug-log.py` copied (OUT_DIR/debug-log); a folder's
`debug-log-NNNNNN.txt` files are read oldest first. `--from` and `--to` are the log's own local
time, compared as text, so any prefix of `YYYY-MM-DD HH:MM:SS.mmm` works.

`--around` is a Debug Note's time (#305), as the author copied it, comment and all: the window
runs from `--before` minutes before it (10) to `--after` minutes after (2). It is the phone's
local time, as the lines are; the offset after it is ignored.

What each output line holds: the time, the app's state then (`active`, `inactive`, `background`,
or `launch` until the first `[app]` line after a launch), and the event:

- the reading's `[hx]` status line only when `playing`, `known`, `section`, `rendered` or `note`
  changes, shortened to `playing=… utt=… known=… section=… rendered=… note=…`; a new Utterance
  alone is not an event, because it changes every few seconds;
- every other line in full, cut to --width characters, except the categories in --skip
  (default `sync,download,provider`: they run all the time and rarely carry the fault).

A category it has never seen is printed, so a new kind of line shows up without a change here.
"""
import argparse
import datetime as dt
import glob
import os
import re
import sys

LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) [+-]\d\d:\d\d \[([a-z-]+)\] (.*)$')
# `app=` is on the line from #113 on; older lines lack it.
STATUS = re.compile(r'^playing=(\S+) (?:app=\S+ )?utterance=(\S+) known=(\S+) section=(\S+) rendered=(\S+) .*?note=(.*)$')
APP = re.compile(r'^app (\w+)')
AROUND = re.compile(r'^\s*(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?)')


def files_of(path):
    if os.path.isdir(path):
        return sorted(glob.glob(os.path.join(path, 'debug-log-*.txt')), key=os.path.basename)
    return [path]


def window(around, before, after):
    """The --from and --to of `--around`, in the lines' own text, or None for a value that is not a time."""
    found = AROUND.match(around)
    if not found:
        return None
    text = found.group(1)
    shape = '%Y-%m-%d %H:%M:%S.%f' if '.' in text else '%Y-%m-%d %H:%M:%S' if text.count(':') == 2 else '%Y-%m-%d %H:%M'
    at = dt.datetime.strptime(text, shape)
    line = lambda moment: moment.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    return line(at - dt.timedelta(minutes=before)), line(at + dt.timedelta(minutes=after))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('log')
    parser.add_argument('--from', dest='start', default='')
    parser.add_argument('--to', dest='end', default='')
    parser.add_argument('--skip', default='sync,download,provider')
    parser.add_argument('--width', type=int, default=220)
    parser.add_argument('--around', default='')
    parser.add_argument('--before', type=float, default=10)
    parser.add_argument('--after', type=float, default=2)
    args = parser.parse_args()
    if args.around:
        span = window(args.around, args.before, args.after)
        if span is None:
            print(f'--around wants a time, YYYY-MM-DD HH:MM[:SS[.mmm]], as a Debug Note gives it; not {args.around!r}', file=sys.stderr)
            return 2
        args.start, args.end = span
    skip = {name for name in args.skip.split(',') if name}
    paths = files_of(args.log)
    if not paths:
        print(f'no debug-log-*.txt in {args.log}', file=sys.stderr)
        return 1

    state = '?'
    last = None
    shown = 0
    for path in paths:
        with open(path, encoding='utf-8', errors='replace') as handle:
            for raw in handle:
                found = LINE.match(raw.rstrip('\n'))
                if not found:
                    continue
                at, category, message = found.groups()
                # The state is tracked from the first line, whatever the window, so that the
                # first line shown already carries the right one.
                if category == 'launch':
                    state = 'launch'
                elif category == 'app' and APP.match(message):
                    state = APP.match(message).group(1)
                if category == 'hx':
                    status = STATUS.match(message)
                    if status:
                        playing, utterance, known, section, rendered, note = status.groups()
                        key = (playing, known, section, rendered, note)
                        if key == last:
                            continue
                        last = key
                        note = 'null' if note == 'null' else note[:80] + ('…"' if len(note) > 80 else '')
                        message = f'playing={playing} utt={utterance} known={known} section={section} rendered={rendered} note={note}'
                if category in skip:
                    continue
                if args.start and at < args.start:
                    continue
                if args.end and at > args.end:
                    continue
                text = f'{at} {state:<10} [{category}] {message}'
                print(text if len(text) <= args.width else text[:args.width - 1] + '…')
                shown += 1
    if shown == 0:
        print('nothing in that window', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
