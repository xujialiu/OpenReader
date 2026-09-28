#!/bin/bash
# #70: real touches on the player's head row (PlayerTouchProbe.swift) — the
# empty left slot and the gap beside a short name open nothing, the name opens
# Voice, the arrow collapses the player. Also #71 batch 2: a real collapse and
# reopen during live playback must not move the page
# (`testCollapseAndReopenDuringPlaybackRealTouch`, run between `line-follow.cjs
# … arm` and `… analyse`).
#
#   bash test/manual-test/player-and-reading-held/player-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:testName ...]
#
# With no -only-testing argument, runs `testHeadRowTouches` alone (its own
# prerequisites below). Needs a Document already open, the player expanded,
# and Azure's "Andrew" already the chosen Voice (set up through the harness
# beforehand — see PlayerTouchProbe.swift's own doc comment). Plays nothing.
# Leaves the player collapsed; re-expand it afterwards with the harness
# (`{"do":"collapse","on":false}`).
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: player-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:testName ...]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect PlayerTouchProbe.swift
fi
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/PlayerTouchProbe/${arg#-only-testing:}") ;;
    *) only_testing+=("$arg") ;;
  esac
done
[[ ${#only_testing[@]} -gt 0 ]] || only_testing=(-only-testing:LockScreenProbe/PlayerTouchProbe/testHeadRowTouches)
result="$output/result-$(date +%s).xcresult"
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" "${only_testing[@]}" \
  test > "$output/test-$(date +%s).log" 2>&1 || status=$?
if [[ -d "$result" ]]; then
  attachments="$output/attachments-$(basename "$result" .xcresult)"
  xcrun xcresulttool export attachments --path "$result" --output-path "$attachments" > /dev/null 2>&1 || true
  # Exported attachments are named by UUID; give each its own suggested name
  # (line-colour.sh's pattern).
  python3 - "$attachments" <<'PY' || true
import json, os, sys
os.chdir(sys.argv[1])
for test in json.load(open('manifest.json')):
    for a in test['attachments']:
        name = a['suggestedHumanReadableName']
        ext = '.png' if name.endswith('.png') else '.txt' if name.endswith('.txt') else None
        if ext:
            os.replace(a['exportedFileName'], name.split('_0_')[0] + ext)
PY
fi
printf 'Artifacts: %s (result: %s)\n' "$output" "$result"
exit "$status"
