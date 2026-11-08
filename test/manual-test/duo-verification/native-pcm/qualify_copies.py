#!/usr/bin/env python3
"""Run 1x negative controls on private EXTERNAL COPIES, never the original/app."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

import numpy as np

from analyse import analyse
from control import atomic_json


def qualify_copies(capture, reference, output, at_output_frame, frames):
    capture, output = Path(capture).resolve(), Path(output).resolve()
    if output.exists() or output == capture or capture in output.parents:
        raise ValueError('New external controls directory required')
    if any((parent / '.git').exists() for parent in [output, *output.parents]):
        raise ValueError('No private speech in a Git checkout')
    original_pcm = (capture / 'capture.f32le').read_bytes()
    original_receipt = (capture / 'capture.json').read_bytes()
    original_hash = hashlib.sha256(original_pcm).hexdigest()
    original_receipt_hash = hashlib.sha256(original_receipt).hexdigest()
    receipt = json.loads(original_receipt)
    baseline = analyse(capture, reference)
    if baseline['status'] != 'HOST_1X_MATCH':
        raise ValueError('No passing unmodified 1x control; stop dependent mutations/transition cases')
    pcm = np.frombuffer(original_pcm, dtype='<f4').reshape((-1, receipt['format']['channels']))
    begin, end = baseline['analysisOutputFrames']
    width = round(receipt['format']['sampleRate'] * .04)
    point = at_output_frame
    if not isinstance(frames, int) or frames < width or not begin + width + frames < point < end - frames - width:
        raise ValueError('Choose a >=40ms mutation wholly inside the measured waveform, away from its initial anchor/edges')
    output.mkdir(parents=True, mode=0o700)
    atomic_json(output / 'unmodified-analysis.json', baseline)
    results = {}
    for mode in ('drop', 'repeat', 'equal_frame_repeat_skip', 'timestamp_gap'):
        target = output / mode
        shutil.copytree(capture, target)
        metadata = json.loads(original_receipt)
        if mode == 'drop':
            changed = np.concatenate((pcm[:point], pcm[point + frames:]))
        elif mode == 'repeat':
            changed = np.concatenate((pcm[:point], pcm[point - frames:point], pcm[point:]))
        elif mode == 'equal_frame_repeat_skip':
            changed = pcm.copy()
            changed[point:point + frames] = pcm[point - frames:point]
        else:
            changed = pcm
            candidates = [row for row in metadata['records'] if row['frameOffset'] <= point]
            row = candidates[-1]
            base = metadata['machTimebase']
            row['hostTime'] = str(int(row['hostTime']) + round(frames / metadata['format']['sampleRate'] * 1e9 * base['denom'] / base['numer']))
        data = changed.astype('<f4').tobytes()
        metadata['pcmSHA256'] = hashlib.sha256(data).hexdigest()  # exercise analysis, not just hash refusal
        metadata['externalMutation'] = {'mode': mode, 'outputFrame': point, 'frames': frames,
            'originalPCMsha256': original_hash, 'originalReceiptSHA256': original_receipt_hash,
            'limit': 'Deliberately altered external evidence copy; NEVER native original'}
        (target / 'capture.f32le').write_bytes(data)
        atomic_json(target / 'capture.json', metadata)
        try:
            result = analyse(target, reference)
        except ValueError as error:
            if mode not in ('drop', 'repeat') or str(error) != 'PCM/frame count mismatch':
                raise ValueError('Unexpected analyser error in an external negative control') from error
            result = {'status': 'REJECT', 'reason': 'PCM/frame count mismatch'}
        expected = result['status'] == 'REJECT'
        if mode == 'equal_frame_repeat_skip':
            expected = expected and bool(result.get('violations')) and not result.get('timelineErrors')
        if mode == 'timestamp_gap':
            expected = expected and any('host timestamp gap' in error for error in result.get('timelineErrors', []))
        if not expected:
            results[mode] = {'status': 'CONTROL_INCOMPLETE', 'result': result}
        else:
            results[mode] = result
        atomic_json(output / f'{mode}-analysis.json', result)
    if (capture / 'capture.f32le').read_bytes() != original_pcm or (capture / 'capture.json').read_bytes() != original_receipt:
        raise ValueError('Original changed during control qualification; do not certify')
    result = {'status': 'HOST_EXTERNAL_CONTROLS_MATCH' if all(row['status'] == 'REJECT' for row in results.values()) else 'CONTROL_INCOMPLETE',
              'originalPCMsha256': original_hash, 'originalReceiptSHA256': original_receipt_hash,
              'controls': {mode: row['status'] for mode, row in results.items()},
              'limit': '1x host analyser qualification only, not native WSOLA, physical output, Following or application PASS'}
    atomic_json(output / 'controls.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture')
    parser.add_argument('reference')
    parser.add_argument('output')
    parser.add_argument('--at-output-frame', type=int, required=True)
    parser.add_argument('--frames', type=int, required=True)
    args = parser.parse_args()
    result = qualify_copies(args.capture, args.reference, args.output, args.at_output_frame, args.frames)
    print(json.dumps({'status': result['status'], 'controls': result['controls']}))
    return 0 if result['status'] == 'HOST_EXTERNAL_CONTROLS_MATCH' else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('CONTROLS_INCOMPLETE: ' + type(error).__name__, file=sys.stderr)
        sys.exit(2)
