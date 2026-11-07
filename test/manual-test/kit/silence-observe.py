#!/usr/bin/env python3
"""Bounded, read-only simulator plist observation, NOT an audio-silence check.

Run inside the tester's admitted phase. No set, boot, app launch, audio, AX,
LLDB, route change or recovery is performed. Raw files stay in a fresh output
folder; zero samples do not authorize playback. See duo-verification/diagnostics.md.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import signal
import sys
import time
from xml.parsers.expat import ExpatError

from ios_guard import BLOCKED, Interrupted, check_interruption, interrupted, run_command, save_record

NONZERO = 3


class ObservationFailure(Exception):
    pass


def stamp():
    return {'wallTime': datetime.now(timezone.utc).isoformat(), 'monotonicNs': time.monotonic_ns()}


def identity(stat):
    return {'device': stat.st_dev, 'inode': stat.st_ino, 'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns}


def boot_checkpoint(device, output, name, timeout):
    began = stamp()
    with (output / f'{name}.log').open('w') as stream:
        status = run_command(['xcrun', 'simctl', 'list', 'devices', '--json'], timeout, grace=.2,
                             record=output / f'{name}-command.json', stdout=stream, stderr=stream)
    if status in (130, 143):
        raise Interrupted(status - 128)
    if status:
        raise ObservationFailure(f'{name} failed (exit {status}); raw log retained')
    try:
        listing = json.loads((output / f'{name}.log').read_text())
        matches = [entry for group in listing['devices'].values() for entry in group
                   if entry['udid'].upper() == device]
        if len(matches) != 1 or matches[0]['state'] != 'Booted' or not matches[0].get('isAvailable', True):
            raise ValueError('selected device is not uniquely booted and available')
        selected = matches[0]
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise ObservationFailure(f'{name}: unusable device listing: {error}') from error
    save_record(output / f'{name}.json', {**began, 'finished': stamp(), 'device': selected,
                                        'scope': 'instantaneous listing, not proof of no intervening boot'})


def sample(file, output, index):
    result = {**stamp(), 'index': index, 'scope': 'plist-only', 'source': str(file)}
    try:
        with file.open('rb') as stream:
            before = identity(os.fstat(stream.fileno()))
            raw = stream.read(65537)
            after = identity(os.fstat(stream.fileno()))
        raw_name = f'sample-{index:04d}.plist'
        (output / raw_name).write_bytes(raw)
        result.update({'raw': raw_name, 'sha256': hashlib.sha256(raw).hexdigest(),
                       'before': before, 'after': after, 'pathAfter': identity(file.stat())})
        if len(raw) > 65536:
            raise ValueError('audio settings exceed the 64 KiB observation limit; raw prefix retained')
        if before != after or after != result['pathAfter']:
            raise ValueError('audio settings changed during the read; no stable sample')
        values = plistlib.loads(raw)
        volume = values['sim_volume']
        if type(volume) is not int or not 0 <= volume <= 100:
            raise ValueError('sim_volume is not an integer in 0..100')
        route = values['sim_output_device_uid']
        if not isinstance(route, str) or not route:
            raise ValueError('sim_output_device_uid is missing or invalid')
        result.update({'volume': volume, 'outputDeviceUID': route, 'valid': True})
    except (OSError, ValueError, TypeError, KeyError, plistlib.InvalidFileException, ExpatError) as error:
        result.update({'valid': False, 'error': str(error)})
    result['finished'] = stamp()
    return result


def observe(device, output, seconds, interval, label, timeout):
    output.mkdir(parents=True, exist_ok=False)
    result = {'device': device, 'label': label, 'scope': 'plist-only; no active audio measurement',
              'started': stamp(), 'secondsRequested': seconds, 'intervalSeconds': interval,
              'outcome': 'running', 'samples': 0, 'zeroToNonzeroObserved': False}
    save_record(output / 'result.json', result)
    status = BLOCKED
    try:
        boot_checkpoint(device, output, 'boot-start', timeout)
        file = Path.home() / f'Library/Developer/CoreSimulator/Devices/{device}/data/var/run/simulatoraudio/audiosettings.plist'
        started = time.monotonic()
        previous = None
        with (output / 'samples.jsonl').open('x') as timeline:
            while True:
                check_interruption()
                entry = sample(file, output, result['samples'])
                timeline.write(json.dumps(entry) + '\n')
                timeline.flush()
                result['samples'] += 1
                if not entry['valid']:
                    raise ObservationFailure(entry['error'])
                if entry['volume'] != 0:
                    result['zeroToNonzeroObserved'] = previous == 0
                    result['outcome'] = 'nonzero-observed'
                    status = NONZERO
                    break
                previous = entry['volume']
                elapsed = time.monotonic() - started
                if elapsed >= seconds:
                    result['outcome'] = 'zero-in-sampled-plists'
                    status = 0
                    break
                time.sleep(min(interval, seconds - elapsed))
        boot_checkpoint(device, output, 'boot-end', timeout)
    except ObservationFailure as error:
        result.update({'outcome': 'blocked', 'reason': str(error)})
        status = BLOCKED
    except Interrupted as error:
        result['outcome'] = 'cancelled'
        status = 128 + error.signum
    except OSError as error:
        result.update({'outcome': 'blocked', 'reason': str(error)})
        status = BLOCKED
    finally:
        result.update({'finished': stamp(), 'exitCode': status})
        save_record(output / 'result.json', result)
    print(json.dumps(result))
    return status


def bounded_number(low, high):
    def parse(value):
        number = float(value)
        if not math.isfinite(number) or not low <= number <= high:
            raise argparse.ArgumentTypeError(f'must be finite and in {low}..{high}')
        return number
    return parse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device', help='explicit simulator UDID; never auto-select a device')
    parser.add_argument('output', type=Path, help='new directory; never reuse or overwrite evidence')
    parser.add_argument('--seconds', required=True, type=bounded_number(0, 600), help='0 for one checkpoint; maximum 600')
    parser.add_argument('--interval', type=bounded_number(.25, 10), default=1, help='seconds between reads (default 1)')
    parser.add_argument('--label', required=True, help='non-secret checkpoint name, letters/digits/hyphen only')
    parser.add_argument('--command-timeout', type=bounded_number(.1, 10), default=3, help='per boot-listing command')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', args.device):
        parser.error('device must be a simulator UDID')
    if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', args.label):
        parser.error('label must be 1..64 letters/digits/hyphens; do not include secrets')
    if args.output.exists():
        parser.error('output already exists; preserve it and use a new checkpoint name')
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    try:
        return observe(args.device.upper(), args.output, args.seconds, args.interval, args.label, args.command_timeout)
    except OSError as error:
        print(f'[silence-observe] BLOCKED: {error}', file=sys.stderr)
        return BLOCKED


if __name__ == '__main__':
    sys.exit(main())
