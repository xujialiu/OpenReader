#!/usr/bin/env python3
"""#350 shared receipt oracle. HOST replay and native shell use these same verdicts.

Exit 0: all cycles qualified, no RED, cleanup verified. Exit 1: observed app
RED (even with cleanup uncertainty). Exit 2: incomplete/invalid controls only.
No native/HTTP/input operations live here; pixel thresholds are unchanged.
"""
import json
import math
from pathlib import Path
import re
import sys

PHASE_FILES = {'baseline': ('press', 'press'), 'outward': ('d3', 'd3'), 'return': ('return', 'ret')}
RANGE_KEYS = ('section', 'text', 'cfi', 'start', 'end', 'anchor', 'focus', 'backward')
EXPECTED_RANGE = (0, 'hope', 'epubcfi(/6/2!/4/4,/1:33,/1:37)', 33, 37, 33, 37, False)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def read_json(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def receipt(path):
    text = Path(path).read_text().strip()
    if 'HX PROBE ' in text:
        text = text.split('HX PROBE ', 1)[1]
    return json.loads(text)


def library_hash(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value), 'missing/malformed Library hash')
    return value


def validate_checkpoint(p, phase):
    require(isinstance(p, dict), 'missing checkpoint')
    require(p['inputVerified'] is True and p['captureVerified'] is True, 'input/capture control failed')
    floor, ceiling = p['after'], p['before']
    require(number(floor) and number(ceiling) and 0 < floor < ceiling, 'invalid freshness bounds')
    s = p['selection']
    require(isinstance(s, dict) and number(s['at']) and floor < s['at'] <= ceiling, 'missing/stale selection receipt')
    require(s['viewport'] == ([867, 669] if phase == 'outward' else [382, 678]), 'unqualified viewport')
    ranges = s['ranges']
    require(isinstance(ranges, list) and len(ranges) <= 1, 'ambiguous/malformed ranges')
    for r in ranges:
        require(isinstance(r, dict) and all(k in r for k in RANGE_KEYS), 'incomplete range')
        require(all(type(r[k]) is int and r[k] >= 0 for k in ('section', 'start', 'end', 'anchor', 'focus')),
                'malformed range offsets/section')
        require(type(r['backward']) is bool and all(isinstance(r[k], str) and r[k] for k in ('text', 'cfi')),
                'malformed range identity')
        require(isinstance(r['rects'], list) and r['rects'] and type(r['rectCount']) is int and
                r['rectCount'] >= len(r['rects']), 'missing/malformed range rects')
        for rect in r['rects']:
            require(len(rect) == 4 and all(number(n) for n in rect) and rect[2] > 0 and rect[3] > 0,
                    'malformed range rect')
    st = p['state']
    require(isinstance(st, dict) and st['type'] == 'object' and isinstance(st['value'], dict), 'malformed CDP receipt')
    st = st['value']
    require(number(st['observedAt']) and floor < st['observedAt'] <= ceiling, 'missing/stale lookup receipt')
    require(all(k in st for k in ('selection', 'result', 'traffic', 'gate', 'error', 'loading')), 'incomplete lookup state')
    require(st['gate'] is None, 'stacked lookup gate')
    require(type(st['loading']) is bool, 'malformed loading state')
    task, result, traffic = st['selection'], st['result'], st['traffic']
    require(task is None or (isinstance(task, dict) and type(task['attempt']) is int and task['attempt'] >= 0 and
            type(task['selecting']) is bool and all(isinstance(task[k], str) and task[k] for k in ('mode', 'text'))),
            'malformed lookup task')
    require(result is None or (isinstance(result, dict) and all(isinstance(result[k], str) for k in ('source', 'text'))),
            'malformed lookup result')
    require(isinstance(traffic, dict) and traffic['installed'] is True and isinstance(traffic['requests'], list),
            'missing traffic observer')
    for request in traffic['requests']:
        require(isinstance(request, dict) and all(k in request for k in
                ('startedAt', 'responseAt', 'status', 'abortedAt', 'failedAt', 'service')), 'incomplete request receipt')
        require(number(request['startedAt']) and 0 < request['startedAt'] <= st['observedAt'], 'invalid request start')
        require(request['responseAt'] is None or (number(request['responseAt']) and
                request['startedAt'] <= request['responseAt'] <= st['observedAt']), 'invalid response time')
        require(request['status'] is None or type(request['status']) is int, 'malformed response status')
        require(all(request[k] is None or number(request[k]) for k in ('abortedAt', 'failedAt')), 'malformed abort/failure')
        require(isinstance(request['service'], str) and request['service'], 'missing service')
    library_hash(p['libraryHash'])
    paint = p['paint']
    share = paint['washShare']
    require(number(share) and 0 <= share <= 1, 'invalid wash measurement')
    require(paint['mode'] == ('crop' if ranges else 'whole'), 'paint/range mode mismatch')
    if ranges:
        require(type(paint['handleClusters']) is int and paint['handleClusters'] >= 0, 'invalid handle measurement')
        if share >= .4:
            require(paint['handleClusters'] >= 2, 'ambiguous native handles')
            paint_verdict = 'present'
        elif share < .05:
            paint_verdict = 'lost'
        else:
            raise ValueError('ambiguous pixels')
    else:
        require(share <= .0005, 'ambiguous/contradictory whole-frame pixels')
        paint_verdict = 'lost'
    return s, st, paint_verdict


def phase_verdict(phase, p, base, base_hash):
    try:
        library_hash(base_hash)
        s, st, paint = validate_checkpoint(p, phase)
        if phase == 'baseline':
            require(len(s['ranges']) == 1 and tuple(s['ranges'][0][k] for k in RANGE_KEYS) == EXPECTED_RANGE,
                    'baseline is not exact forward hope section 0 offsets 33-37')
            require(st['selection'] is not None and st['selection'] ==
                    {'attempt': 0, 'mode': 'dictionary', 'text': 'hope', 'selecting': False}, 'invalid baseline task')
            require(st['result'] is not None and st['result']['source'] == 'Free Dictionary API' and
                    st['result']['text'].strip() and not st['loading'] and st['error'] is None, 'invalid baseline result')
            requests = st['traffic']['requests']
            require(len(requests) == 1 and requests[0]['status'] == 200 and requests[0]['responseAt'] is not None and
                    requests[0]['service'] == 'api.dictionaryapi.dev' and requests[0]['abortedAt'] is None and
                    requests[0]['failedAt'] is None, 'invalid baseline request')
            require(p['libraryHash'] == base_hash and paint == 'present', 'baseline Library/paint control failed')
            return {'outcome': 'PASS', 'verdict': 'BASELINE-OK'}
        require(base is not None and phase_verdict('baseline', base, None, base_hash)['outcome'] == 'PASS',
                'missing/invalid qualified baseline')
        require(s['at'] > base['selection']['at'] and st['observedAt'] > base['state']['value']['observedAt'],
                'checkpoint predates baseline')
        prior = base['state']['value']
        failures = []
        if not s['ranges']:
            failures.append('range-drop')
        elif tuple(s['ranges'][0][k] for k in RANGE_KEYS) != tuple(base['selection']['ranges'][0][k] for k in RANGE_KEYS):
            failures.append('range-changed')
        elif paint != 'present':
            failures.append('paint-only-loss')
        if st['selection'] != prior['selection']:
            failures.append('task-changed')
        if st['result'] != prior['result'] or st['loading'] != prior['loading'] or st['error'] != prior['error']:
            failures.append('result-changed')
        if st['traffic'] != prior['traffic']:
            failures.append('request-changed')
        if p['libraryHash'] != base_hash:
            failures.append('library-changed')
        if failures:
            return {'outcome': 'APP_RED', 'verdict': f'RED-{phase}-{failures[0]}', 'failures': failures}
        return {'outcome': 'PASS', 'verdict': phase.upper() + '-PASS'}
    except (KeyError, TypeError, ValueError, IndexError) as error:
        return {'outcome': 'CONTROL_INCOMPLETE', 'verdict': 'CONTROL_INCOMPLETE', 'reason': str(error)}


def cleanup_verdict(directory, after, before, operations_ok):
    try:
        require(operations_ok, 'cleanup operation failed')
        selection = receipt(directory / 'selection.txt')
        require(number(selection['at']) and after < selection['at'] <= before and selection['ranges'] == [],
                'missing/stale/nonempty cleanup selection')
        initial = read_json(directory / 'initial.json')['value']
        restored = read_json(directory / 'restore.json')
        if initial['traffic'] is not None:
            require(restored == {'type': 'string', 'value': 'DuoAcceptance lookup traffic restored'},
                    'traffic restoration unverified')
        state = read_json(directory / 'state.json')['value']
        require(number(state['observedAt']) and after < state['observedAt'] <= before, 'stale cleanup state')
        require(all(state[k] is None for k in ('selection', 'result', 'gate', 'traffic', 'error')) and
                state['loading'] is False, 'post-cleanup state not clean')
        return {'verified': True}
    except (OSError, KeyError, TypeError, ValueError) as error:
        return {'verified': False, 'reason': str(error)}


def cycle_verdict(cycle, base_hash):
    if not isinstance(cycle, dict):
        cycle = {}
    phases = {}
    for phase in PHASE_FILES:
        # Live saves each verdict before it decides whether to perform the next phase.
        phases[phase] = cycle.get('verdicts', {}).get(phase) or phase_verdict(
            phase, cycle.get(phase), cycle.get('baseline'), base_hash)
        if phases[phase]['outcome'] != 'PASS':
            break
    case = list(phases.values())[-1]
    cleanup_receipt = cycle.get('cleanup')
    cleanup_receipt = cleanup_receipt if isinstance(cleanup_receipt, dict) else {}
    cleanup = cleanup_receipt.get('verified') is True
    uncertainties = [v.get('reason', 'control failed') for v in phases.values() if v['outcome'] == 'CONTROL_INCOMPLETE']
    if not cleanup:
        uncertainties.append('cleanup unverified: ' + str(cleanup_receipt.get('reason', 'missing receipt')))
    return {'caseVerdict': case['verdict'], 'outcome': case['outcome'], 'phases': phases,
            'cleanupVerified': cleanup, 'valid': not uncertainties, 'uncertainties': uncertainties}


def aggregate(cycles, maximum, kind):
    valid = red = control = 0
    paths = {}
    uncertainties = []
    stop = ''
    accepted = []
    for c in cycles:
        accepted.append(c)
        valid += int(c['valid'])
        red += int(c['outcome'] == 'APP_RED')
        control += int(bool(c['uncertainties']))
        uncertainties.extend(c['uncertainties'])
        if c['outcome'] == 'APP_RED':
            paths[c['caseVerdict']] = paths.get(c['caseVerdict'], 0) + 1
        if any(n >= 2 for n in paths.values()):
            stop = 'two-reds-same-path'
        elif control >= 2:
            stop = 'control-failures'
        elif valid >= maximum:
            stop = 'max-valid-cycles-reached'
        if stop:
            break
    if not stop:
        uncertainties.append('valid cycle budget not completed')
    code = 1 if red else 2 if uncertainties else 0
    return {'kind': kind, 'outcome': {0: 'PASS', 1: 'APP_RED', 2: 'CONTROL_INCOMPLETE'}[code], 'exitCode': code,
            'stopReason': stop or 'receipts-exhausted', 'shouldStop': bool(stop), 'attemptedCycles': len(accepted),
            'validCycles': valid, 'appFailedCycles': red, 'controlFailedCycles': control,
            'redPaths': paths, 'uncertainties': uncertainties, 'cycles': accepted}


def emit(out, summary):
    out.mkdir(parents=True, exist_ok=True)
    save(out / 'summary.json', summary)
    line = (f"{summary['kind']} outcome={summary['outcome']} exitCode={summary['exitCode']} "
            f"stop={summary['stopReason']} attempted={summary['attemptedCycles']} valid={summary['validCycles']} "
            f"appFailed={summary['appFailedCycles']} controlFailed={summary['controlFailedCycles']}")
    with (out / 'loop.log').open('a') as log:
        log.write(line + '\n')
    print(line)
    return summary['exitCode']


def main(args):
    op = args[0]
    if op == 'replay':
        out = Path(args[2])
        if out.exists():
            print('HOST_REPLAY outcome=CONTROL_INCOMPLETE exitCode=2: output must be new', file=sys.stderr)
            return 2
        try:
            m = read_json(args[1])
            require(isinstance(m, dict), 'malformed manifest')
            require(m['kind'] == 'HOST_REPLAY', 'replay must be explicitly HOST_REPLAY')
            maximum = m['maxCycles']
            require(type(maximum) is int and 1 <= maximum <= 4, 'maxCycles must be 1-4')
            library_hash(m['baselineLibraryHash'])
            require(isinstance(m['cycles'], list) and all(isinstance(c, dict) for c in m['cycles']), 'missing/malformed cycles')
            # Never trust supplied verdicts in replay: derive only from retained receipts.
            cycles = [cycle_verdict({k: v for k, v in c.items() if k != 'verdicts'}, m['baselineLibraryHash'])
                      for c in m['cycles']]
            summary = aggregate(cycles, maximum, 'HOST_REPLAY')
        except (OSError, ValueError, KeyError, TypeError) as error:
            summary = aggregate([], 1, 'HOST_REPLAY')
            summary['uncertainties'].append(str(error))
        return emit(out, summary)
    if op == 'phase':
        directory, phase, base_hash, after, before = Path(args[1]), args[2], args[3], int(args[4]), int(args[5])
        tag, paint = PHASE_FILES[phase]
        try:
            selection = receipt(directory / f'selection-{tag}.txt')
            if not selection['ranges'] and phase != 'baseline':
                paint = 'd3null' if phase == 'outward' else 'retnull'
            p = {'selection': selection, 'state': read_json(directory / f'state-{tag}.json'),
                 'paint': read_json(directory / f'paint-{paint}.json'),
                 'libraryHash': (directory / f'library-{phase}.txt').read_text().strip(),
                 'after': after, 'before': before, 'inputVerified': True, 'captureVerified': True}
            save(directory / f'receipt-{phase}.json', p)
            base = read_json(directory / 'receipt-baseline.json') if phase != 'baseline' else None
            v = phase_verdict(phase, p, base, base_hash)
        except (OSError, ValueError, KeyError, TypeError) as error:
            v = {'outcome': 'CONTROL_INCOMPLETE', 'verdict': 'CONTROL_INCOMPLETE', 'reason': str(error)}
        save(directory / f'verdict-{phase}.json', v)
        print(v['verdict'])
        return { 'PASS': 0, 'APP_RED': 1, 'CONTROL_INCOMPLETE': 2 }[v['outcome']]
    if op == 'control':
        save(Path(args[1]) / f'verdict-{args[2]}.json',
             {'outcome': 'CONTROL_INCOMPLETE', 'verdict': 'CONTROL_INCOMPLETE', 'reason': args[3]})
        return 2
    if op == 'cleanup':
        directory = Path(args[1])
        result = cleanup_verdict(directory, int(args[2]), int(args[3]), args[4] == '0')
        save(directory.parent / 'cleanup.json', result)
        return 0 if result['verified'] else 2
    if op == 'cycle':
        directory = Path(args[1])
        verdicts = {phase: read_json(directory / f'verdict-{phase}.json') for phase in PHASE_FILES
                    if (directory / f'verdict-{phase}.json').exists()}
        cleanup = read_json(directory / 'cleanup.json') if (directory / 'cleanup.json').exists() else {'verified': False}
        if args[3] != '0':
            cleanup = {'verified': False, 'reason': cleanup.get('reason', 'cleanup command failed')}
        c = cycle_verdict({'verdicts': verdicts, 'cleanup': cleanup}, args[2])
        save(directory / 'verdict.json', c)
        print('CYCLE_RESULT ' + json.dumps(c))
        return 0
    if op == 'summary':
        out, maximum = Path(args[1]), int(args[2])
        cycles = [read_json(p) for p in sorted(out.glob('cycle-*/verdict.json'), key=lambda p: int(p.parent.name[6:]))]
        require(args[3] in ('NATIVE', 'HOST_REPLAY'), 'invalid summary kind')
        return emit(out, aggregate(cycles, maximum, args[3]))
    raise ValueError('unknown operation')


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
