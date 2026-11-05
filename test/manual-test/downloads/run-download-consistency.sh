#!/bin/bash
# One scoped, fail-closed DownloadConsistencyProbe run.
# Usage: run-download-consistency.sh UDID OUTPUT METHOD PARAMS.json
# PARAMS.json has uppercase names (BOOK, PART, COUNT, ...) with string values.
# The source marker and a new per-run token must appear in the executed log.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
kit="$here/../kit"
if [[ ${1:-} == --under-guard ]]; then
  shift
  python3 "$kit/ios_guard.py" check-owner
else
  [[ $# == 4 ]] || { echo 'Usage: run-download-consistency.sh UDID OUTPUT METHOD PARAMS.json' >&2; exit 2; }
  exec python3 "$kit/ios_guard.py" run --wait "${OPENREADER_IOS_WAIT_SECONDS:-0}" \
    --timeout 1500 --record "$2/controller-$(date +%Y%m%d-%H%M%S)-$$.json" -- \
    bash "$0" --under-guard "$@"
fi
udid=$1
output=$2
method=$3
params=$4
[[ $method =~ ^test[A-Za-z0-9]+$ ]] || { echo 'Expected one test method' >&2; exit 2; }
mkdir -p "$output"
output=$(cd "$output" && pwd)
root=$(cd "$here/../../.." && pwd)
built_for="DownloadConsistencyProbe from $root"
if [[ -e "$output/ManualTests.xcodeproj" ]]; then
  [[ $(<"$output/probe.txt") == "$built_for" ]] || { echo 'Wrong probe project/worktree' >&2; exit 2; }
else
  ruby "$kit/project.rb" "$output" top.xujialiu.openreader NO inspect DownloadConsistencyProbe.swift
  printf '%s\n' "$built_for" > "$output/probe.txt"
fi
token=$(python3 - "$output/Probe-Info.plist" "$params" <<'PY'
import json, pathlib, plistlib, re, sys, uuid
path=pathlib.Path(sys.argv[1])
params=json.loads(pathlib.Path(sys.argv[2]).read_text())
if not isinstance(params, dict) or not all(re.fullmatch(r'[A-Z_]+', k) and isinstance(v, str) for k,v in params.items()):
    raise SystemExit('Expected uppercase parameter names and string values')
config=plistlib.loads(path.read_bytes())
config={k:v for k,v in config.items() if not k.startswith('DC')}
config.update({'DC'+k:v for k,v in params.items()})
token=uuid.uuid4().hex
config.update(DCPROBE_VERSION='dc4', DCVERIFY_TOKEN=token)
path.write_bytes(plistlib.dumps(config))
print(token)
PY
)
# This is the actual UI-test host identifier from its Info.plist/xctestrun,
# not the test bundle's identifier without .xctrunner. Scope to this device.
runner=top.xujialiu.openreader.manualtests.xctrunner
if python3 "$kit/ios_guard.py" run --timeout 15 -- xcrun simctl get_app_container "$udid" "$runner" app > "$output/runner-before.txt" 2>&1; then
  python3 "$kit/ios_guard.py" run --timeout 15 -- xcrun simctl terminate "$udid" "$runner" > "$output/runner-stop.txt" 2>&1 || true
  python3 "$kit/ios_guard.py" run --timeout 20 -- xcrun simctl uninstall "$udid" "$runner"
fi
bash "$kit/silence.sh" set "$udid"
status=0
bash "$kit/run-probe.sh" DownloadConsistencyProbe "$udid" "$output" \
  -only-testing:"DownloadConsistencyProbe/$method" -collect-test-diagnostics never || status=$?
[[ $status == 0 ]] || exit "$status"
# No inference from a fresh disk binary: attest the executing test instead.
python3 - "$output" "$token" "$params" <<'PY'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1])
log=max(root.glob('test-*.log'),key=lambda p:p.stat().st_mtime)
text=log.read_text()
if 'DC-CODE-V4' not in text or 'DC-VERIFY-TOKEN='+sys.argv[2] not in text:
    raise SystemExit('BLOCKED: executing code/config provenance is absent or stale')
line=next((s.split('DC-PARAMS=',1)[1] for s in text.splitlines() if 'DC-PARAMS=' in s),None)
actual=json.loads(line or '{}')
expected=json.loads(pathlib.Path(sys.argv[3]).read_text())
if any(actual.get('DC'+k)!=v for k,v in expected.items()):
    raise SystemExit('BLOCKED: executed parameters differ from requested parameters')
print('Executed code and parameter token verified:',log)
PY
