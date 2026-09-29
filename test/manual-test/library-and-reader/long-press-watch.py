#!/usr/bin/env python3
"""Tell each long press on the reader's text apart as OK or FAIL, from the phone's own log (#74).

WebKit logs every long press on a page as `Drag session requested` about 0.65 s after
touch-down (its drag attempt, which fails on plain text). A press that goes on to
select a word logs `Text interaction changing selection using
'-[WKContentView(WKInteraction) selectTextWithGranularity...` within tens of
milliseconds; a press that starts no selection logs nothing more. That pair is the
whole classifier: it needs no app instrumentation, and it works on a Release build.

    live     stream the phone's log (pymobiledevice3 syslog live) and classify as it goes;
             on FAIL, write the preceding 90 s and the following 3 s to OUT/fail-HHMMSS.log
    archive  classify a collected .logarchive (pymobiledevice3 syslog collect) over a range

Usage:
    python3 long-press-watch.py live --udid IPHONE_UDID --out DIR [--pmd3 PATH]
    python3 long-press-watch.py archive --archive X.logarchive --start "YYYY-MM-DD HH:MM:SS" \
        [--end "YYYY-MM-DD HH:MM:SS"] --out DIR

`--pmd3` (or $PMD3) is the pymobiledevice3 executable; see pitfalls/physical-iphone.md
for installing it into a throwaway venv. Lines tagged [DEBUG-lp74] come from the
temporary diagnostic module of #74, when that build is installed, and are copied into
each FAIL file along with WebKit, UIKit and HX lines.
"""
import argparse
import collections
import datetime as dt
import os
import re
import select
import subprocess
import sys
import time

PRESS = 'Drag session requested'
SELECTED = "Text interaction changing selection using '-[WKContentView(WKInteraction) selectTextWithGranularity"
WINDOW = 1.5  # seconds from the drag attempt within which a working press selects
BEFORE, AFTER = 90.0, 3.0  # seconds of context written around a FAIL
STAMP = re.compile(r'^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)')
# Noise that is never evidence here: the download's network traffic and the harness poll.
NOISE = ['not security-scoped', '[com.apple.network]', '[com.apple.CFNetwork]', 'CFNetwork}', 'Network}',
         'networkextension', 'boringssl', 'Resource lookup', 'libusrtcp', ':network]', ':CFNetwork]']


def stamp(line):
    m = STAMP.match(line)
    if not m:
        return None
    return dt.datetime.strptime(f'{m.group(1)} {m.group(2)[:15]}', '%Y-%m-%d %H:%M:%S.%f' if '.' in m.group(2) else '%Y-%m-%d %H:%M:%S').timestamp()


def clock(ts):
    return dt.datetime.fromtimestamp(ts).strftime('%H:%M:%S.%f')[:-3]


class Classifier:
    def __init__(self, out):
        self.out = out
        self.buffer = collections.deque()
        self.pending = None  # time of a drag attempt not yet followed by a selection
        self.open_fail = None  # (file, until) while the lines after a FAIL are still being written
        self.last_hx = ''
        self.counts = collections.Counter()

    def feed(self, ts, line):
        if any(n in line for n in NOISE):
            return
        self.buffer.append((ts, line))
        while self.buffer and self.buffer[0][0] < ts - BEFORE - 5:
            self.buffer.popleft()
        if 'HX ' in line and 'playing=' in line:
            self.last_hx = line[line.index('HX '):][:300]
        if '[DEBUG-lp74] installed' in line or '[DEBUG-lp74] WKContentView hooks' in line:
            print(f'{clock(ts)}  diagnostics: {line[line.index("[DEBUG-lp74]"):][:200]}', flush=True)
        if self.open_fail:
            handle, until = self.open_fail
            handle.write(line.rstrip('\n') + '\n')
            if ts > until:
                handle.close()
                self.open_fail = None
        if self.pending is not None and SELECTED in line and ts - self.pending <= WINDOW:
            self.report(self.pending, True)
            self.pending = None
        self.tick(ts)
        if PRESS in line:
            if self.pending is not None:
                self.report(self.pending, False)
            self.pending = ts

    def tick(self, now):
        if self.pending is not None and now - self.pending > WINDOW:
            self.report(self.pending, False)
            self.pending = None

    def report(self, ts, ok):
        self.counts['OK' if ok else 'FAIL'] += 1
        if ok:
            print(f'{clock(ts)}  OK    long press ({self.counts["OK"]} OK, {self.counts["FAIL"]} FAIL)', flush=True)
            return
        name = os.path.join(self.out, 'fail-' + dt.datetime.fromtimestamp(ts).strftime('%Y%m%d-%H%M%S') + '.log')
        handle = open(name, 'w')
        for t, line in self.buffer:
            if t >= ts - BEFORE:
                handle.write(line.rstrip('\n') + '\n')
        self.open_fail = (handle, ts + AFTER)
        print(f'{clock(ts)}  FAIL  long press -> {name}', flush=True)
        if self.last_hx:
            print(f'           last {self.last_hx}', flush=True)
        for t, line in self.buffer:
            if ts - 1.0 <= t and '[DEBUG-lp74] wk ' in line:
                print(f'           {line[line.index("[DEBUG-lp74]"):][:220]}', flush=True)

    def close(self, now):
        self.tick(now + WINDOW + 1)
        if self.open_fail:
            self.open_fail[0].close()
        print(f'totals: {dict(self.counts)}', flush=True)


def live(args):
    os.makedirs(args.out, exist_ok=True)
    raw = open(os.path.join(args.out, 'raw-' + time.strftime('%Y%m%d-%H%M%S') + '.log'), 'w')
    command = [args.pmd3, 'syslog', 'live', '--udid', args.udid, '--label', '-pn', 'OpenReader']
    for noise in ('not security-scoped', 'com.apple.network]', 'com.apple.CFNetwork]', 'networkextension', 'boringssl'):
        command += ['-v', noise]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    classifier = Classifier(args.out)
    last_ts, last_wall = None, time.time()
    print(f'watching {args.udid}; raw log {raw.name}; Ctrl-C to stop', flush=True)
    try:
        while True:
            ready, _, _ = select.select([process.stdout], [], [], 0.5)
            if ready:
                line = process.stdout.readline()
                if not line:
                    print('syslog stream ended', flush=True)
                    break
                raw.write(line)
                ts = stamp(line)
                if ts is None:
                    continue
                last_ts, last_wall = ts, time.time()
                classifier.feed(ts, line)
            elif last_ts is not None:
                classifier.tick(last_ts + (time.time() - last_wall))
    except KeyboardInterrupt:
        pass
    finally:
        process.terminate()
        raw.close()
        classifier.close(last_ts or time.time())


def archive(args):
    os.makedirs(args.out, exist_ok=True)
    command = ['/usr/bin/log', 'show', '--archive', args.archive, '--start', args.start, '--info', '--debug',
               '--style', 'compact', '--predicate', 'process == "OpenReader"']
    if args.end:
        command += ['--end', args.end]
    classifier = Classifier(args.out)
    last = None
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True) as process:
        for line in process.stdout:
            ts = stamp(line)
            if ts is None:
                continue
            last = ts
            classifier.feed(ts, line)
    classifier.close(last or 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='mode', required=True)
    one = sub.add_parser('live')
    one.add_argument('--udid', required=True)
    one.add_argument('--out', required=True)
    one.add_argument('--pmd3', default=os.environ.get('PMD3', 'pymobiledevice3'))
    two = sub.add_parser('archive')
    two.add_argument('--archive', required=True)
    two.add_argument('--start', required=True)
    two.add_argument('--end')
    two.add_argument('--out', required=True)
    args = parser.parse_args()
    (live if args.mode == 'live' else archive)(args)


if __name__ == '__main__':
    sys.exit(main())
