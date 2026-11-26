#!/usr/bin/env python3
"""#271: collapse, hold one real section report, then release it on the first wait note."""
import json
import os
import pathlib
import shlex
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
STATE_PROBE = HERE / 'continuity-state.js'
HOLD_PROBE = HERE / 'continuity-hold-report.js'
RELEASE_PROBE = HERE / 'continuity-release-report.js'
WAITING = 'The reading has reached the end of the text this document has reported and is waiting for more of it.'
METRO = os.environ.get('OPENREADER_METRO', 'http://127.0.0.1:8269')
DEVICE_NAME = os.environ.get('OPENREADER_DEVICE', 'OpenReader1')
expected_document_id = 'sha256:53c72ce20bd9668579105a54c50afde9b83e13f937859d40c0e4c3236a3071eb'

if len(sys.argv) != 4:
    raise SystemExit('usage: continuity-wait-release.py SIMULATOR_UDID FAKE_PROVIDER_LOG OUTPUT.log')
udid, fake_log_name, output_name = sys.argv[1:]
if udid != '63467D78-C092-45CD-88E3-A21BADE90ADB':
    raise SystemExit('refusing an unassigned simulator')

output = pathlib.Path(output_name).resolve()
fake_log = pathlib.Path(fake_log_name).resolve()
device_data = pathlib.Path(subprocess.check_output(
    ['xcrun', 'simctl', 'get_app_container', udid, 'top.xujialiu.openreader', 'data'],
    text=True,
).strip())
documents = device_data / 'Documents'
debug_dir = device_data / 'Library' / 'Application Support' / 'debug-log'

def current_debug_log():
    candidates = sorted(debug_dir.glob('debug-log-*.txt'), key=lambda p: p.stat().st_mtime)
    if not candidates:
        raise RuntimeError(f'no Debug Log found under {debug_dir}')
    return candidates[-1]

env = dict(os.environ, OPENREADER_DEVICE=DEVICE_NAME, OPENREADER_METRO=METRO)

def run(args, *, timeout=12, use_env=False):
    result = subprocess.run(args, cwd=REPO, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout,
                            env=env if use_env else None)
    return result

def hx(command, *, code_file=None, timeout=12):
    args = ['node', 'test/manual-test/kit/hx.cjs', udid, json.dumps(command)]
    if code_file is not None:
        args.extend(['--code-file', str(code_file)])
    result = run(args, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'hx failed ({result.returncode}): {result.stdout.strip()}')
    return result.stdout.strip()

def cdp_state():
    result = run([
        'node', 'test/manual-test/kit/cdp.cjs', '--eval', str(STATE_PROBE), METRO
    ], timeout=8, use_env=True)
    if result.returncode:
        raise RuntimeError(f'Hermes state read failed ({result.returncode}): {result.stdout.strip()}')
    wrapper = json.loads(result.stdout)
    return wrapper.get('value', {})

def new_lines(log, offset):
    with log.open('rb') as stream:
        stream.seek(offset)
        return stream.read().decode('utf-8', errors='replace').splitlines()

def probe_payload(line):
    marker = '[probe]'
    if marker not in line:
        return None
    try:
        return json.loads(line.split(marker, 1)[1].strip())
    except (IndexError, json.JSONDecodeError):
        return None

records = [
    f'simulator={udid}',
    f'document_id={expected_document_id}',
    f'metro={METRO}',
    f'fake_provider_log={fake_log}',
    f'started_epoch={time.time():.6f}',
]
gate_command_written = False
release_command_written = False

def fail(reason):
    records.append('failure=' + reason)
    if gate_command_written and not release_command_written:
        try:
            cleanup = hx({}, code_file=RELEASE_PROBE)
            records.append('cleanup_release=' + cleanup)
        except Exception as error:
            records.append('cleanup_release_error=' + str(error))
    output.write_text('\n'.join(records) + '\n')
    print('\n'.join(records))
    raise SystemExit(1)

# The accepted setup keeps the Player collapsed before Play.
hx({'do': 'collapse', 'on': True})
deadline = time.monotonic() + 4
state = {}
while time.monotonic() < deadline:
    state = cdp_state()
    player = state.get('players', [{}])[0] if state.get('players') else {}
    reading = state.get('readings', [{}])[0] if state.get('readings') else {}
    if player.get('collapsed') is True and reading.get('playing') is False:
        break
    time.sleep(0.2)
if not player.get('collapsed'):
    fail(f'pre-Play collapse did not stick: {json.dumps(state)}')
records.append('collapsed_before_play=' + json.dumps(state,separators=(',',':')))

# Arm before the seek makes section 4 render. Its original Blocks message is
# held in the page, not fabricated or changed.
log = current_debug_log()
arm_offset = log.stat().st_size
hx({}, code_file=HOLD_PROBE)
gate_command_written = True
deadline = time.monotonic() + 4
armed_line = ''
while time.monotonic() < deadline:
    for line in new_lines(log, arm_offset):
        payload = probe_payload(line)
        if payload and payload.get('armed') is True and payload.get('target') == 4:
            armed_line = line
            break
    if armed_line:
        break
    time.sleep(0.1)
if not armed_line:
    fail('fresh section-report gate acknowledgement not seen')
records.append('gate_armed=' + armed_line)

# Place the stopped Reading on the last known Utterance. The next section's
# generated report is intercepted by the gate above.
hx({'do':'seek','utterance':44})
deadline = time.monotonic() + 4
state = {}
while time.monotonic() < deadline:
    state = cdp_state()
    reading = state.get('readings', [{}])[0] if state.get('readings') else {}
    player = state.get('players', [{}])[0] if state.get('players') else {}
    if (reading.get('utterance') == 44 and reading.get('known') == 45
            and not reading.get('playing') and player.get('collapsed') is True):
        break
    time.sleep(0.2)
if (reading.get('utterance') != 44 or reading.get('known') != 45
        or reading.get('playing') or player.get('collapsed') is not True):
    fail(f'could not stage last reported Utterance: {json.dumps(state)}')
records.append('staged_before_play=' + json.dumps(state,separators=(',',':')))

# Confirm that a newly generated section-4 report is held before Play. Only
# lines appended by this status probe can satisfy the check.
log = current_debug_log()
status_offset = log.stat().st_size
hx({}, code_file=HOLD_PROBE)
deadline = time.monotonic() + 4
gate_status = None
while time.monotonic() < deadline:
    for line in new_lines(log, status_offset):
        payload = probe_payload(line)
        if payload and payload.get('armed') is True and payload.get('target') == 4:
            gate_status = payload
            break
    if gate_status is not None:
        break
    time.sleep(0.1)
held = (gate_status or {}).get('held', [])
if not any(item.get('sectionIndex') == 4 for item in held):
    fail(f'section-4 Blocks report was not held: {json.dumps(gate_status)}')
records.append('held_report=' + json.dumps(gate_status,separators=(',',':')))

log = current_debug_log()
offset = log.stat().st_size
play_payload = shlex.quote(json.dumps({'do':'play'}))
play_shell = (
    f'bash test/manual-test/kit/silence.sh check {shlex.quote(udid)} && '
    f'node test/manual-test/kit/hx.cjs {shlex.quote(udid)} {play_payload}'
)
play_started = time.monotonic()
play = run(['bash','-c',play_shell])
if play.returncode:
    records.append('silence_or_play_failed=' + play.stdout.strip())
    output.write_text('\n'.join(records)+'\n')
    raise SystemExit(play.returncode)
records.append('play_command_sent_epoch=' + f'{time.time():.6f}')

# Release on the first fresh Debug Log waiting note; do not wait through a
# screenshot, XCTest, or extra status command while the app's section deadline
# is running.
deadline = time.monotonic() + 8
position = offset
waiting_line = None
while time.monotonic() < deadline:
    with log.open('rb') as stream:
        stream.seek(position)
        chunk = stream.read()
        position = stream.tell()
    for line in chunk.decode('utf-8',errors='replace').splitlines():
        if '[reading] note:' in line and WAITING in line:
            waiting_line = line
            break
    if waiting_line:
        break
    time.sleep(0.05)

if not waiting_line:
    records.append('outcome=waiting-note-not-seen-within-8s')
    run(['node','test/manual-test/kit/reading.cjs','pause'],use_env=True)
    hx({},code_file=RELEASE_PROBE)
    output.write_text('\n'.join(records)+'\n')
    raise SystemExit(1)

records.append('waiting_note=' + waiting_line)
records.append('play_to_waiting_ms=' + str(round((time.monotonic()-play_started)*1000)))
release = hx({},code_file=RELEASE_PROBE)
release_command_written = True
records.append('release_command_written_epoch=' + f'{time.time():.6f}')
harness = json.loads((documents/'harness.json').read_text())
records.append(f"release_harness_seq={harness.get('seq')} do={harness.get('do')}")

# Hermes reads prove the app received the section and resumed with the Player
# still collapsed. Pause immediately after that fact is established.
deadline = time.monotonic() + 4
resumed = None
while time.monotonic() < deadline:
    state = cdp_state()
    if len(state.get('documents', [])) != 1 or state['documents'][0].get('id') != expected_document_id:
        fail(f'Reader document changed while resuming: {json.dumps(state.get("documents"))}')
    player = state.get('players', [{}])[0] if state.get('players') else {}
    reading = state.get('readings', [{}])[0] if state.get('readings') else {}
    if (reading.get('playing') is True and reading.get('known',0) >= 55
            and reading.get('utterance') is not None and reading.get('utterance') >= 45
            and player.get('collapsed') is True and not player.get('waitingNote')):

        resumed = {'player':player,'reading':reading}
        break
    time.sleep(0.2)
if not resumed:
    records.append('resumed_state=' + json.dumps(state,separators=(',',':')))
    records.append('outcome=release-did-not-resume-with-collapsed-player')
    run(['node','test/manual-test/kit/reading.cjs','pause'],use_env=True)
    output.write_text('\n'.join(records)+'\n')
    raise SystemExit(1)
records.append('resumed_state=' + json.dumps(resumed,separators=(',',':')))
records.append('resume_observed_epoch=' + f'{time.time():.6f}')
pause = run(['node','test/manual-test/kit/reading.cjs','pause'],use_env=True)
records.append('cleanup_pause=' + pause.stdout.strip())
final_state = cdp_state()
records.append('paused_hermes_state=' + json.dumps(final_state,separators=(',',':')))
lines = fake_log.read_text(errors='replace').splitlines() if fake_log.exists() else []
records.append('fake_synthesis_requests=' + str(sum('text=' in line for line in lines)))
records.append('fake_fourth_chapter_requests=' + str(sum('Fourth chapter' in line for line in lines if 'text=' in line)))
records.append('outcome=pass')
records.append('finished_epoch=' + f'{time.time():.6f}')
output.write_text('\n'.join(records)+'\n')
print('\n'.join(records))
