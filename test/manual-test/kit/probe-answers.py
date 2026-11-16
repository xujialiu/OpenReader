#!/usr/bin/env python3
"""Strict collector for the walkthrough harness's `[probe]` answers.

Debug Log lines look like
`2026-11-17 00:28:10.923 +08:00 [probe] {"json": …}` — the payload after the
literal ` [probe] ` marker must be valid JSON. Offsets are tracked in BYTES on
the raw file (a previous version mixed byte offsets with character indices and
silently skipped answers after any non-ASCII content); only complete
newline-terminated lines are parsed, rotation/truncation restarts from 0, and
every failure keeps the raw timestamps in the output and exits non-zero.

Two operations (acquisition is deterministic: capture the offset FIRST, send
each harness injection exactly once, then collect):

    probe-answers.py capture SIMULATOR_UDID OFFSET_FILE [--log-file PATH]
        Writes {"path", "offset", "size"} (byte positions) for the current
        Debug Log.

    probe-answers.py collect SIMULATOR_UDID OUT_DIR PREFIX
        --offset-file OFFSET_FILE --expect N [--timeout S] [--log-file PATH]
        Waits until N new complete `[probe]` answers exist after that byte
        offset, strictly parses each, and writes OUT_DIR/PREFIX-probes.raw
        (full lines, timestamps preserved) and OUT_DIR/PREFIX-probes.json
        {"count", "answers", "raw", "error"}. Exit 0 only when exactly N
        answers parsed; any malformed payload, marker problem, incomplete
        data at deadline, or short count exits 2 with the raw evidence kept.

`--self-test` runs deterministic host-only cases, including a NON-ASCII prefix
written before the captured offset so the byte/character bug cannot regress.
"""
import argparse
import json
import sys
import time
from pathlib import Path

MARKER = ' [probe] '


def log_path_for(udid, override=None):
    if override:
        return Path(override)
    import subprocess
    out = subprocess.run(['xcrun', 'simctl', 'get_app_container', udid,
                          'top.xujialiu.openreader', 'data'],
                         capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f'get_app_container failed: {out.stderr.strip()}')
    return (Path(out.stdout.strip()) / 'Library' / 'Application Support'
            / 'debug-log' / 'debug-log-000001.txt')


def capture(log_path, offset_file):
    offset = log_path.stat().st_size
    offset_file.write_text(json.dumps(
        {'path': str(log_path), 'offset': offset, 'size': offset}, indent=2))
    print(json.dumps({'offset': offset}))
    return 0


def collect(log_path, offset, expect, timeout):
    result = {'count': 0, 'answers': [], 'raw': [], 'error': None}
    deadline = time.monotonic() + timeout
    parsed = []
    kept_lines = []
    error = None
    while True:
        try:
            size = log_path.stat().st_size
            with open(log_path, 'rb') as fh:
                fh.seek(0 if size < offset else offset)
                data = fh.read()
        except OSError as e:
            error = f'log read failed: {e}'
            break
        parts = data.split(b'\n')
        complete = parts[:-1] if (parts and parts[-1] != b'') else parts
        parsed = []
        kept_lines = []
        try:
            for raw in complete:
                if not raw.strip():
                    continue
                line = raw.decode('utf-8')
                if MARKER not in line:
                    continue
                kept_lines.append(line)
                payload = line.split(MARKER, 1)[1]
                if not payload.strip():
                    raise ValueError(f'empty probe payload: {line[:160]}')
                parsed.append(json.loads(payload))
            if len(parsed) >= expect:
                break
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as e:
            error = f'{type(e).__name__}: {e}'
            break
        if time.monotonic() >= deadline:
            error = (f'only {len(parsed)} of {expect} expected [probe] answers '
                     f'arrived within {timeout:g}s')
            break
        time.sleep(0.3)
    result['count'] = len(parsed)
    result['answers'] = parsed
    result['raw'] = kept_lines
    result['error'] = error
    return result, (0 if (error is None and len(parsed) == expect) else 2)


def write_result(out_dir, prefix, result):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f'{prefix}-probes.raw').write_text(
        '\n'.join(result['raw']) + ('\n' if result['raw'] else ''))
    (out_dir / f'{prefix}-probes.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'count': result['count'], 'error': result['error']}, indent=2))


# --- deterministic host-only self-test --------------------------------------

def self_test():
    import tempfile
    outcomes = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        log = tmp / 'debug-log-000001.txt'
        # NON-ASCII content BEFORE the captured offset: with the old
        # bytes-offset/character-slice bug this shifts every later read.
        log.write_bytes(('2026-11-17 00:00:00.000 +08:00 [hx] shelf 中文书名 tested\n'
                         '2026-11-17 00:00:01.000 +08:00 [hx] settings {"主题":"暗色"}\n').encode('utf-8'))
        offset = log.stat().st_size

        # 1. good pair after the offset, behind an incomplete trailing write.
        with open(log, 'ab') as fh:
            fh.write('2026-11-17 00:00:02.000 +08:00 [probe] {"inner":[402,812],"note":"中文"}'.encode('utf-8'))
        with open(log, 'ab') as fh:
            fh.write('\n2026-11-17 00:00:03.000 +08:00 [probe] {"scroll":{"top":1240}}\n'.encode('utf-8'))
        res, code = collect(log, offset, 2, 3.0)
        ok = (code == 0 and res['count'] == 2 and res['error'] is None
              and res['answers'][0]['inner'] == [402, 812]
              and res['answers'][1]['scroll']['top'] == 1240
              and res['raw'][0].startswith('2026-11-17'))
        outcomes.append(('non-ascii + incomplete line', res, code, ok))

        # 2. malformed payload fails closed, raw kept.
        with open(log, 'ab') as fh:
            fh.write('2026-11-17 00:00:04.000 +08:00 [probe] {bad json\n'.encode('utf-8'))
        res, code = collect(log, offset, 3, 2.0)
        ok2 = (code == 2 and res['error'] and 'JSONDecodeError' in res['error']
               and res['raw'][-1].endswith('[probe] {bad json'))
        outcomes.append(('malformed payload', res, code, ok2))

        # 3. incomplete probe line alone at the deadline fails closed.
        log2 = tmp / 'log2.txt'
        log2.write_bytes('prefix 中文\n'.encode('utf-8'))
        off2 = log2.stat().st_size
        with open(log2, 'ab') as fh:
            fh.write('2026-11-17 00:00:05.000 +08:00 [probe] {"partial":'.encode('utf-8'))
        res, code = collect(log2, off2, 1, 1.0)
        ok3 = code == 2 and res['count'] == 0 and res['error'] is not None
        outcomes.append(('incomplete line at deadline', res, code, ok3))

        # 4. rotation/truncation restarts from 0.
        log3 = tmp / 'log3.txt'
        log3.write_bytes(('old long content 中文 ' * 50).encode('utf-8'))
        off3 = log3.stat().st_size
        log3.write_bytes(b'2026-11-17 00:00:06.000 +08:00 [probe] {"after":"rotation"}\n')
        res, code = collect(log3, off3, 1, 2.0)
        ok4 = code == 0 and res['count'] == 1 and res['answers'][0]['after'] == 'rotation'
        outcomes.append(('rotation restart', res, code, ok4))

    for name, res, code, ok in outcomes:
        print(f'self-test {name}: exit={code} count={res["count"]} error={res["error"]} {"ok" if ok else "MISMATCH"}')
    all_ok = all(ok for _, _, _, ok in outcomes)
    print('SELF-TEST-OK' if all_ok else 'SELF-TEST-FAILED')
    return 0 if all_ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='mode')
    cap = sub.add_parser('capture')
    cap.add_argument('udid')
    cap.add_argument('offset_file')
    cap.add_argument('--log-file')
    col = sub.add_parser('collect')
    col.add_argument('udid')
    col.add_argument('out_dir')
    col.add_argument('prefix')
    col.add_argument('--offset-file', required=True)
    col.add_argument('--expect', type=int, required=True)
    col.add_argument('--timeout', type=float, default=20.0)
    col.add_argument('--log-file')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())
    if not args.mode:
        ap.error('a mode (capture|collect) is required without --self-test')
    try:
        log = log_path_for(args.udid, getattr(args, 'log_file', None))
        if args.mode == 'capture':
            sys.exit(capture(log, Path(args.offset_file)))
        offset = json.loads(Path(args.offset_file).read_text())['offset']
        result, code = collect(log, offset, args.expect, args.timeout)
        write_result(args.out_dir, args.prefix, result)
        sys.exit(code)
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(json.dumps({'error': str(error)}, indent=2))
        sys.exit(2)


if __name__ == '__main__':
    main()
