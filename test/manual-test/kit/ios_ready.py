#!/usr/bin/env python3
"""Bounded, read-only readiness; one explicitly supplied recovery per attempt.

Run before acceptance work, on a screen containing no credentials. This does
not boot, erase, install runtimes, change security settings, or play audio.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import time

from ios_guard import BLOCKED, BUSY, Interrupted, interrupted, positive, run_command, save_record, slot

KIT = Path(__file__).resolve().parent


class HealthFailure(Exception):
    pass


def check(device, directory, timeout, metro):
    directory.mkdir(parents=True)

    def command(name, argv):
        log = directory / f'{name}.log'
        with log.open('w') as stream:
            status = run_command(argv, timeout, grace=.2, record=directory / f'{name}.json', stdout=stream, stderr=stream)
        if status in (130, 143):
            raise Interrupted(status - 128)
        if status:
            raise HealthFailure(f'{name} failed (exit {status}); see {log}')
        return log.read_text()

    try:
        listing = json.loads(command('device', ['xcrun', 'simctl', 'list', 'devices', '--json']))
        devices = [entry for group in listing['devices'].values() for entry in group if entry['udid'] == device]
        if len(devices) != 1 or devices[0]['state'] != 'Booted' or not devices[0].get('isAvailable', True):
            raise HealthFailure('the selected device is not booted and available; no boot was attempted')
        name = devices[0]['name']
    except (ValueError, KeyError, TypeError) as error:
        raise HealthFailure('device listing was not usable JSON') from error
    command('bootstatus', ['xcrun', 'simctl', 'bootstatus', device])
    shot = directory / 'screen.png'
    command('screenshot', ['xcrun', 'simctl', 'io', device, 'screenshot', str(shot)])
    if not shot.exists() or shot.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
        raise HealthFailure('screenshot command produced no PNG')
    if metro:
        expression = directory / 'ready.js'
        expression.write_text('"openreader-ios-ready";\n')
        previous = os.environ.get('OPENREADER_DEVICE')
        os.environ['OPENREADER_DEVICE'] = name
        try:
            reply = command('CDP', ['node', str(KIT / 'cdp.cjs'), '--eval', str(expression), metro])
        finally:
            if previous is None:
                os.environ.pop('OPENREADER_DEVICE', None)
            else:
                os.environ['OPENREADER_DEVICE'] = previous
        try:
            if json.loads(reply).get('value') != 'openreader-ios-ready':
                raise ValueError('wrong answer')
        except (ValueError, AttributeError) as error:
            raise HealthFailure('CDP did not return the expected answer from the selected app') from error


def readiness(device, output, timeout, metro=None, recovery=None, recovery_timeout=120):
    output.mkdir(parents=True, exist_ok=True)
    result = output / 'readiness.json'
    marker = output / 'recovery-used.json'
    for attempt in range(2):
        directory = output / f'ready-{time.time_ns()}'
        try:
            check(device, directory, timeout, metro)
            save_record(result, {'outcome': 'ready', 'device': device, 'artifacts': str(directory)})
            return 0
        except HealthFailure as error:
            save_record(result, {'outcome': 'blocked', 'device': device, 'reason': str(error), 'artifacts': str(directory)})
            print(f'[ios-ready] BLOCKED: {error}', file=sys.stderr)
            if not recovery or attempt or marker.exists():
                return BLOCKED
            # Mark BEFORE running: failure/cancellation of recovery still spends it.
            with marker.open('x') as stream:
                json.dump({'device': device, 'outcome': 'started'}, stream)
            with (output / 'recovery.log').open('w') as stream:
                status = run_command(['bash', str(recovery), device, str(output)], recovery_timeout,
                                     record=marker, stdout=stream, stderr=stream)
            if status:
                return status if status in (130, 143) else BLOCKED
    return BLOCKED


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path, help='reuse the SAME attempt directory through recovery and retests')
    parser.add_argument('--timeout', type=positive, default=20, help='seconds per readiness step')
    parser.add_argument('--metro', help='also require a response from this app\'s Metro/CDP target')
    parser.add_argument('--recover-script', type=Path, help='explicit owned-device recovery; never run more than once')
    parser.add_argument('--recovery-timeout', type=positive, default=120)
    args = parser.parse_args()
    if args.recover_script and not args.recover_script.is_file():
        parser.error('--recover-script must name an existing script')
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    try:
        with slot():
            return readiness(args.device, args.output, args.timeout, args.metro, args.recover_script, args.recovery_timeout)
    except BlockingIOError:
        return BUSY
    except Interrupted as error:
        return 128 + error.signum
    except (OSError, RuntimeError) as error:
        print(f'[ios-ready] BLOCKED: {error}', file=sys.stderr)
        return BLOCKED


if __name__ == '__main__':
    sys.exit(main())
