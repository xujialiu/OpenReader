#!/usr/bin/env python3
"""Conservative 1x local waveform/timestamp qualification, never a WSOLA oracle.

Use raw interleaved float32 reference PCM decoded from the REAL known Clip.
Reference JSON: {"pcm":"clip.f32le", "sampleRate":24000, "channels":1,
"pcmSHA256":"..."}. Paths are private and relative to that JSON. No content,
waveform or book text is printed. numpy/scipy are host-only analysis tools.
"""
import argparse
import hashlib
import json
from math import gcd
import os
from pathlib import Path
import sys

import numpy as np
from scipy.signal import correlate, resample_poly

SCHEMA = 'OpenReaderNativePCM-v1'


def timeline_errors(receipt):
    errors = []
    if receipt.get('schema') != SCHEMA or receipt.get('failureBits') != 0:
        errors.append('native incomplete/failure bits')
    if not receipt.get('tapRemoved') or not receipt.get('quiescent'):
        errors.append('tap removal/quiescence unconfirmed')
    if receipt.get('status') != 'CAPTURED_QUALIFICATION_PENDING':
        errors.append('capture status incomplete')
    if receipt.get('storage') != 'float32-little-endian-interleaved':
        errors.append('unsupported storage')
    rate = receipt['format']['sampleRate']
    base = receipt['machTimebase']
    if not 1000 <= rate <= 192000 or not 0 < base['numer'] or not 0 < base['denom']:
        raise ValueError('Invalid format/timebase')
    tolerance = 2 / rate  # same instrument clock bound as CaptureBuffer, not a word tolerance
    offset = 0
    before = None
    for index, row in enumerate(receipt['records']):
        if row['frameOffset'] != offset or not isinstance(row['frames'], int) or row['frames'] <= 0:
            errors.append(f'callback {index}: missing/repeated output frames')
        offset += row['frames']
        if not row['sampleTimeValid'] or not row['hostTimeValid'] or int(row['hostTime']) <= 0:
            errors.append(f'callback {index}: invalid AVAudioTime')
        stamp_rate = row['timestampSampleRate']
        if not isinstance(stamp_rate, (float, int)) or not np.isfinite(stamp_rate) or stamp_rate <= 0:
            raise ValueError('Invalid timestamp sample rate')
        if before:
            expected = before['frames'] / rate
            sample_delta = (int(row['sampleTime']) - int(before['sampleTime'])) / stamp_rate
            host_delta = (int(row['hostTime']) - int(before['hostTime'])) * base['numer'] / base['denom'] / 1e9
            if int(row['sampleTime']) <= int(before['sampleTime']) or stamp_rate != before['timestampSampleRate'] or abs(sample_delta - expected) > tolerance:
                errors.append(f'callback {index}: sample timestamp gap/reversal')
            if host_delta <= 0 or abs(host_delta - expected) > tolerance:
                errors.append(f'callback {index}: host timestamp gap/reversal')
        before = row
    if not offset or offset != receipt['frameCount']:
        errors.append('callback coverage/frame count mismatch')
    volumes = receipt.get('volumeSamples', [])
    if not volumes or any(row.get('outputVolume') != 0 for row in volumes):
        errors.append('active-session zero volume control missing/nonzero')
    anchors = receipt.get('anchors', [])
    pair = {}
    for label in ('measurement-start', 'measurement-end'):
        matches = [row['clock'] for row in anchors if row.get('label') == label]
        if len(matches) != 1:
            errors.append('exactly one ' + label + ' anchor required')
        else:
            pair[label] = matches[0]
    if len(pair) == 2 and receipt['records']:
        start = int(pair['measurement-start']['beforeHostTime'])
        end = int(pair['measurement-end']['afterHostTime'])
        seconds_per_tick = base['numer'] / base['denom'] / 1e9
        if not 0 < (end - start) * seconds_per_tick <= 8:
            errors.append('measurement must be >0 and <=8 seconds')
        first, last = receipt['records'][0], receipt['records'][-1]
        last_end = int(last['hostTime']) + last['frames'] / rate / seconds_per_tick
        if int(first['hostTime']) > start or last_end < end:
            errors.append('PCM timestamps do not cover the entire bracketed measurement')
        for label, clock in pair.items():
            if int(clock['beforeHostTime']) > int(clock['afterHostTime']):
                errors.append(label + ' clock bracket reversed')
    return errors


def load_pcm(file, channels, checksum):
    raw = Path(file).read_bytes()
    if hashlib.sha256(raw).hexdigest() != checksum:
        raise ValueError('PCM checksum mismatch')
    if not isinstance(channels, int) or not 1 <= channels <= 8 or len(raw) % (4 * channels):
        raise ValueError('Invalid channel/frame shape')
    pcm = np.frombuffer(raw, dtype='<f4').reshape((-1, channels))
    if not np.isfinite(pcm).all():
        raise ValueError('Non-finite PCM')
    return pcm


def candidates(source, window):
    """Gain/DC independent waveform score, never frame-content hashing."""
    window = np.asarray(window, dtype=np.float64)
    window = window - window.mean()
    energy = float(window @ window)
    if energy / len(window) < 1e-8:
        return None
    source = np.asarray(source, dtype=np.float64)
    sums = np.cumsum(np.r_[0., source])
    squares = np.cumsum(np.r_[0., source * source])
    length = len(window)
    variance = squares[length:] - squares[:-length] - (sums[length:] - sums[:-length]) ** 2 / length
    valid = variance > max(length * 1e-8, energy * 1e-6)
    scores = np.full(len(variance), -np.inf)
    dots = correlate(source, window, mode='valid', method='fft')
    scores[valid] = dots[valid] / np.sqrt(variance[valid] * energy)
    return scores


def waveform_matches(source, output, rate):
    # Detection resolution is declared, not quietly promoted into exact audio or
    # <100ms highlighted-word acceptance. Every overlapping local window matters.
    width = round(rate * .04)
    hop = round(rate * .01)
    search = round(rate * .15)
    if len(output) < width or len(source) < len(output):
        raise ValueError('Need >=40ms output and a sufficiently long known Clip')
    rows, incomplete, violations = [], [], []
    anchor = None
    starts = list(range(0, len(output) - width + 1, hop))
    if starts[-1] != len(output) - width:
        starts.append(len(output) - width)
    for at in starts:
        if anchor is None:
            begin, end = 0, len(source)
        else:
            expected = anchor + at
            begin = max(0, expected - search)
            end = min(len(source), expected + search + width)
        scores = candidates(source[begin:end], output[at:at + width])
        if scores is None:
            incomplete.append({'outputFrame': at, 'reason': 'low-energy; no independent content coordinate'})
            continue
        index = int(np.argmax(scores))
        confidence = float(scores[index])
        if confidence < .95:
            violations.append({'outputFrame': at, 'reason': 'local waveform mismatch', 'confidence': confidence})
            continue
        # Neighbouring samples of the same peak are not competing passages.
        other = scores.copy()
        radius = round(rate * .005)
        other[max(0, index - radius):index + radius + 1] = -np.inf
        runner_up = float(np.max(other))
        if runner_up >= confidence - .03:
            incomplete.append({'outputFrame': at, 'reason': 'ambiguous local match', 'confidence': confidence})
            continue
        actual = begin + index
        if anchor is None:
            anchor = actual - at
        error = actual - (anchor + at)
        rows.append({'outputFrame': at, 'referenceFrame': actual, 'confidence': confidence,
                     'sourceProgressionErrorFrames': error})
        if abs(error) > 2:
            violations.append({'outputFrame': at, 'referenceFrame': actual,
                               'reason': 'local repeat/skip/progression error', 'errorFrames': error})
    return {'matches': rows, 'unresolved': incomplete, 'violations': violations,
            'referenceAnchorFrame': anchor, 'windowMs': 40, 'hopMs': 10, 'searchMs': 150, 'rate': 1,
            'limit': '1x known-Clip local waveform qualifier only; unresolved windows are NOT certified. Not native WSOLA or word/paint/acoustic proof.'}


def analyse(capture, reference, playback_rate=1):
    if playback_rate != 1:
        raise ValueError('Nonunit WSOLA alignment is not qualified; do not multiply output time by playback rate')
    capture, reference = Path(capture), Path(reference)
    receipt = json.loads((capture / 'capture.json').read_text())
    ref = json.loads(reference.read_text())
    output = load_pcm(capture / 'capture.f32le', receipt['format']['channels'], receipt['pcmSHA256'])
    source = load_pcm(reference.parent / ref['pcm'], ref['channels'], ref['pcmSHA256'])
    if len(output) != receipt['frameCount']:
        raise ValueError('PCM/frame count mismatch')
    errors = timeline_errors(receipt)
    actual_rate, reference_rate = receipt['format']['sampleRate'], ref['sampleRate']
    if actual_rate != int(actual_rate) or reference_rate != int(reference_rate) or not 1000 <= reference_rate <= 192000:
        raise ValueError('Integer measured reference/output rates required')
    actual_rate, reference_rate = int(actual_rate), int(reference_rate)
    if actual_rate != reference_rate:
        divisor = gcd(actual_rate, reference_rate)
        source = resample_poly(source, actual_rate // divisor, reference_rate // divisor, axis=0)
    if len(source) / actual_rate > 120:
        raise ValueError('Reference Clip exceeds the bounded 120-second analysis input')
    if ref['channels'] not in (1, receipt['format']['channels']):
        raise ValueError('Channel conversion is not qualified; use a source tap and a known mono or same-channel Clip')
    anchors = {row['label']: row['clock'] for row in receipt.get('anchors', [])}
    if 'measurement-start' not in anchors or 'measurement-end' not in anchors:
        raise ValueError('Bracketed measurement anchors required')
    first_host = int(receipt['records'][0]['hostTime'])
    seconds_per_tick = receipt['machTimebase']['numer'] / receipt['machTimebase']['denom'] / 1e9
    begin = max(0, int(np.floor((int(anchors['measurement-start']['beforeHostTime']) - first_host) * seconds_per_tick * actual_rate)))
    end = min(len(output), int(np.ceil((int(anchors['measurement-end']['afterHostTime']) - first_host) * seconds_per_tick * actual_rate)))
    result = {'matches': [], 'unresolved': [], 'violations': []}
    common_anchor = None
    # One content coordinate for simultaneous channels. Two output frames is a
    # disclosed instrument matching uncertainty, not a speech/Word Timing budget.
    channel_tolerance_frames = 2
    for channel in range(output.shape[1]):
        local = waveform_matches(source[:, 0 if ref['channels'] == 1 else channel], output[begin:end, channel], actual_rate)
        if common_anchor is None:
            common_anchor = local['referenceAnchorFrame']
        if common_anchor is not None and channel > 0:
            for row in local['matches']:
                error = row['referenceFrame'] - (common_anchor + row['outputFrame'])
                if abs(error) > channel_tolerance_frames:
                    local['violations'].append({'outputFrame': row['outputFrame'], 'referenceFrame': row['referenceFrame'],
                        'reason': 'cross-channel reference coordinate disagreement', 'errorFrames': error})
        for kind in ('matches', 'unresolved', 'violations'):
            result[kind].extend({**row, 'channel': channel, 'outputFrame': row['outputFrame'] + begin} for row in local[kind])
        result.update({key: local[key] for key in ('windowMs', 'hopMs', 'searchMs', 'rate', 'limit')})
    result['commonReferenceFrameAtAnalysisStart'] = common_anchor
    result['crossChannelToleranceFrames'] = channel_tolerance_frames
    result['timelineErrors'] = errors
    result['referenceResampled'] = actual_rate != reference_rate
    result['analysedChannels'] = output.shape[1]
    result['analysisOutputFrames'] = [begin, end]
    result['frameCount'] = len(output)
    result['status'] = ('REJECT' if errors or result['violations'] else
                        'INCOMPLETE' if result['unresolved'] else 'HOST_1X_MATCH')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture')
    parser.add_argument('reference')
    parser.add_argument('output', help='new private JSON analysis file')
    parser.add_argument('--playback-rate', type=float, default=1)
    args = parser.parse_args()
    result = analyse(args.capture, args.reference, args.playback_rate)
    with open(args.output, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as target:
        json.dump(result, target, indent=2, allow_nan=False)
    print(json.dumps({'status': result['status'], 'matches': len(result['matches']),
                      'unresolved': len(result['unresolved']), 'violations': len(result['violations']),
                      'timelineErrors': len(result['timelineErrors'])}))
    return {'HOST_1X_MATCH': 0, 'REJECT': 1, 'INCOMPLETE': 2}[result['status']]


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('ANALYSIS_INCOMPLETE: ' + type(error).__name__, file=sys.stderr)
        sys.exit(2)
