#!/usr/bin/env python3
"""Bounded filesystem control/export only; no Apple tools, Play or evaluation.

The admitted tester supplies its exact app data container. All raw answers and
PCM remain in private files. One sender per run; seq is never reset by deleting
command.json. This is separate from the app's existing harness protocol.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

SCHEMA = 'OpenReaderNativePCM-v1'
ACTIONS = ('describe', 'arm', 'state', 'anchor', 'disarm', 'drain', 'shutdown')
LABELS = ('measurement-start', 'display-start', 'display-end', 'measurement-end')


def directory(container, run):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', run):
        raise ValueError('Invalid run token')
    return Path(container).resolve() / 'Library/Application Support/duo-native-pcm' / run


def atomic_json(file, data):
    temporary = file.with_name('.' + file.name + '.pending')
    with open(temporary, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as handle:
        json.dump(data, handle, allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, file)


def request(container, run, action, fields=None, timeout=3):
    if action not in ACTIONS or not 0 < timeout <= 5:
        raise ValueError('Unknown action or timeout outside (0,5]')
    root = directory(container, run)
    ready = json.loads((root / 'ready.json').read_text())
    if ready.get('schema') != SCHEMA or ready.get('run') != run or not ready.get('simulatorOnly'):
        raise ValueError('Missing matching Simulator-only ready receipt')
    age = time.time() * 1000 - ready['clock']['wallMs']
    if not 0 <= age <= 120000 or (root / 'expired.json').exists():
        raise ValueError('Control lifetime expired; do not replay into another launch')
    fields = fields or {}
    allowed = {'arm': {'maximumSeconds', 'sourceIdentity', 'engineIdentity', 'readingToken', 'attribution'},
               'anchor': {'label'}}.get(action, set())
    if set(fields) != allowed:
        raise ValueError('Exact fixed command fields required; arbitrary evaluation is forbidden')
    if action == 'arm':
        if not isinstance(fields['maximumSeconds'], (int, float)) or not 0 < fields['maximumSeconds'] <= 10:
            raise ValueError('Capture bound must be <=10 seconds')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', fields['readingToken']):
            raise ValueError('Invalid Reading attribution token')
        if fields['attribution'] != 'sole-current-reading-no-other-audio':
            raise ValueError('Explicit sole Reading attribution required')
    if action == 'anchor' and fields['label'] not in LABELS:
        raise ValueError('Unknown anchor label')
    # Lock only the sender, never the app or render callback. Native polling is
    # independent and expires even if this sender dies.
    with (root / 'sender.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        seq_file = root / 'sender-seq.json'
        previous = json.loads(seq_file.read_text()) if seq_file.exists() else 0
        seq = previous + 1
        atomic_json(seq_file, seq)
        command = {'run': run, 'seq': seq, 'do': action, **fields}
        atomic_json(root / 'command.json', command)
        deadline = time.monotonic() + timeout
        answer_file = root / f'answer-{seq}.json'
        while not answer_file.is_file():
            if time.monotonic() >= deadline:
                raise TimeoutError('No fresh native answer; command may already have executed; inspect before retry')
            time.sleep(.01)
        answer = json.loads(answer_file.read_text())
        if answer.get('schema') != SCHEMA or answer.get('run') != run or answer.get('seq') != seq:
            raise ValueError('Mismatched native answer')
        (root / 'command.json').unlink(missing_ok=True)
        return answer


def export_capture(container, run, output):
    source = directory(container, run)
    destination = Path(output).resolve()
    # Protect private speech from accidentally becoming a tracked fixture.
    if any((parent / '.git').exists() for parent in [destination, *destination.parents]):
        raise ValueError('Export destination must be outside every Git checkout')
    if destination.exists() or destination == source or source in destination.parents:
        raise ValueError('New private external output directory required')
    receipt_bytes = (source / 'capture.json').read_bytes()
    receipt = json.loads(receipt_bytes)
    pcm = (source / 'capture.f32le').read_bytes()
    if receipt.get('schema') != SCHEMA or receipt.get('run') != run:
        raise ValueError('Capture identity mismatch')
    if hashlib.sha256(pcm).hexdigest() != receipt.get('pcmSHA256'):
        raise ValueError('PCM checksum mismatch; original not changed')
    destination.mkdir(parents=True, mode=0o700)
    for name in ('capture.json', 'capture.f32le', 'ready.json'):
        shutil.copyfile(source / name, destination / name)
        os.chmod(destination / name, 0o600)
    for file in source.glob('answer-*.json'):
        shutil.copyfile(file, destination / file.name)
        os.chmod(destination / file.name, 0o600)
    manifest = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest()
                for name in ('capture.json', 'capture.f32le', 'ready.json')}
    atomic_json(destination / 'export.json', {'schema': SCHEMA, 'run': run, 'sha256': manifest,
        'limit': 'Raw immutable evidence export only; NOT a native continuity or acoustic PASS'})
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('container')
    parser.add_argument('run')
    parser.add_argument('action', choices=(*ACTIONS, 'export'))
    parser.add_argument('--output', required=True, help='new private answer file, or new directory for export')
    parser.add_argument('--description', help='fresh describe answer file for arm')
    parser.add_argument('--reading-token')
    parser.add_argument('--maximum-seconds', type=float, default=10)
    parser.add_argument('--label', choices=LABELS)
    args = parser.parse_args()
    if args.action == 'export':
        receipt = export_capture(args.container, args.run, args.output)
        print(json.dumps({'exported': True, 'status': receipt.get('status')}))
        return 0 if receipt.get('status') == 'CAPTURED_QUALIFICATION_PENDING' else 2
    if Path(args.output).exists():
        raise ValueError('Answer output must be new; never overwrite a prior attempt')
    fields = {}
    if args.action == 'arm':
        description = json.loads(Path(args.description).read_text())
        if description.get('run') != args.run or not description.get('answer', {}).get('eligible'):
            raise ValueError('Matching eligible describe receipt required')
        fields = {key: description['answer'][key] for key in ('sourceIdentity', 'engineIdentity')}
        fields.update(maximumSeconds=args.maximum_seconds, readingToken=args.reading_token,
                      attribution='sole-current-reading-no-other-audio')
    if args.action == 'anchor':
        fields = {'label': args.label}
    answer = request(args.container, args.run, args.action, fields)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_json(output, answer)
    ok = not answer['answer'].get('error') and not answer['answer'].get('failureBits')
    if args.action == 'shutdown':
        ok = ok and not answer['answer'].get('ownsTap') and not answer['answer'].get('drain', {}).get('error')
    print(json.dumps({'seq': answer['seq'], 'ok': ok}))
    return 0 if ok else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, TypeError, KeyError, TimeoutError) as error:
        # Do not dump commands, content, paths or a secret-bearing environment.
        print('CONTROL_INCOMPLETE: ' + type(error).__name__, file=sys.stderr)
        sys.exit(2)
