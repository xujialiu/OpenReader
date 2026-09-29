#!/usr/bin/env python3
"""Copy the Debug Log off a phone into a directory, say what time it covers, and optionally
collect the phone's own system log for the same span (#82, ADR 0054).

The Debug Log is kept by a build with Debug Mode in the app's container, at
`Library/Application Support/debug-log/debug-log-NNNNNN.txt` (four files of at most 5 MB,
oldest dropped first), one line per event: `2026-09-29 14:03:12.345 +08:00 [category] message`.

    python3 debug-log.py IPHONE_UDID OUT_DIR [--syslog] [--pmd3 PATH]

OUT_DIR/debug-log/   the Debug Log's files, as the phone holds them (devicectl keeps their mtimes)
OUT_DIR/span.txt     the first and last line's times, as printed
--syslog             also `pymobiledevice3 syslog collect` from the first line's time into
                     OUT_DIR/system.logarchive, and write OpenReader's own lines of the span
                     (the Debug Log's, subsystem top.xujialiu.openreader, category debug-log, are
                     among them) to OUT_DIR/system-openreader.txt
--pmd3 (or $PMD3)    the pymobiledevice3 executable; pitfalls/physical-iphone.md says how to install
                     it into a throwaway venv. `syslog collect` needs no root; `log collect` does.

Exit status: 0 with the log copied, 1 when there is no Debug Log on the phone (a build without
Debug Mode keeps none), 2 when the system log could not be collected.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys

BUNDLE = 'top.xujialiu.openreader'
FOLDER = 'Library/Application Support/debug-log'
NAME = re.compile(r'debug-log-\d{6}\.txt$')
STAMP = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) ([+-]\d\d):(\d\d) \[')


def devicectl(*args):
    return subprocess.run(['xcrun', 'devicectl', 'device', *args], capture_output=True, text=True)


def found_files(target):
    return sorted(path for path in glob.glob(os.path.join(target, '**', '*'), recursive=True) if NAME.search(path))


def copy_log(udid, out):
    """The folder in one copy; failing that, file by file from a listing."""
    target = os.path.join(out, 'debug-log')
    os.makedirs(target, exist_ok=True)
    common = ['--device', udid, '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE]
    copied = devicectl('copy', 'from', *common, '--source', FOLDER, '--destination', target)
    found = found_files(target)
    if found:
        return found
    sys.stderr.write(copied.stderr)
    listing = os.path.join(out, 'debug-log-listing.json')
    listed = devicectl('info', 'files', *common, '--subdirectory', FOLDER, '-j', listing)
    if listed.returncode != 0 or not os.path.exists(listing):
        sys.stderr.write(listed.stderr)
        return []
    names = set()

    def walk(value):
        if isinstance(value, dict):
            for inner in value.values():
                walk(inner)
        elif isinstance(value, list):
            for inner in value:
                walk(inner)
        elif isinstance(value, str) and NAME.search(value):
            names.add(NAME.search(value).group(0))

    with open(listing) as handle:
        walk(json.load(handle))
    for name in sorted(names):
        one = devicectl('copy', 'from', *common, '--source', f'{FOLDER}/{name}', '--destination', os.path.join(target, name))
        if one.returncode != 0:
            sys.stderr.write(one.stderr)
    return found_files(target)


def stamp(line):
    """A line's time as an aware datetime, or None for a line that does not start with one."""
    found = STAMP.match(line)
    if not found:
        return None
    sign = -1 if found.group(2).startswith('-') else 1
    offset = sign * dt.timedelta(hours=abs(int(found.group(2))), minutes=int(found.group(3)))
    return dt.datetime.strptime(found.group(1), '%Y-%m-%d %H:%M:%S.%f').replace(tzinfo=dt.timezone(offset))


def span(files):
    """The first and last stamped line across the files, oldest file first, and the line count."""
    first = last = None
    lines = 0
    for path in sorted(files, key=os.path.basename):
        with open(path, encoding='utf-8', errors='replace') as handle:
            for line in handle:
                lines += 1
                at = stamp(line)
                if at is None:
                    continue
                first = first or at
                last = at
    return first, last, lines


def collect(pmd3, udid, out, first, last):
    archive = os.path.join(out, 'system.logarchive')
    command = [pmd3, 'syslog', 'collect', archive, '--udid', udid, '--start-time', str(int(first.timestamp()))]
    print('collecting the system log:', ' '.join(command), flush=True)
    if subprocess.run(command).returncode != 0:
        return 2
    local = lambda at: at.astimezone().strftime('%Y-%m-%d %H:%M:%S')
    shown = os.path.join(out, 'system-openreader.txt')
    with open(shown, 'w') as handle:
        subprocess.run(['/usr/bin/log', 'show', '--archive', archive, '--start', local(first),
                        '--end', local(last + dt.timedelta(seconds=1)), '--style', 'compact',
                        '--predicate', 'process == "OpenReader"'], stdout=handle)
    with open(shown, encoding='utf-8', errors='replace') as handle:
        lines = sum(1 for _ in handle)
    print(f'{archive}\n{shown}: {lines} lines of OpenReader over the span', flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('udid')
    parser.add_argument('out')
    parser.add_argument('--syslog', action='store_true')
    parser.add_argument('--pmd3', default=os.environ.get('PMD3', 'pymobiledevice3'))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    files = copy_log(args.udid, args.out)
    if not files:
        print(f'no Debug Log on {args.udid} under {FOLDER}: is the installed build one with Debug Mode?', file=sys.stderr)
        return 1
    first, last, lines = span(files)
    size = sum(os.path.getsize(path) for path in files)
    if first is None:
        print(f'{len(files)} files, {size} bytes, and no stamped line in them', file=sys.stderr)
        return 1
    utc = lambda at: at.astimezone(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    summary = (f'{len(files)} files, {lines} lines, {size / 1048576:.1f} MB in {os.path.join(args.out, "debug-log")}\n'
               f'from {first.isoformat(" ", "milliseconds")}  (UTC {utc(first)})\n'
               f'to   {last.isoformat(" ", "milliseconds")}  (UTC {utc(last)})\n')
    print(summary, end='', flush=True)
    with open(os.path.join(args.out, 'span.txt'), 'w') as handle:
        handle.write(summary)
    return collect(args.pmd3, args.udid, args.out, first, last) if args.syslog else 0


if __name__ == '__main__':
    sys.exit(main())
