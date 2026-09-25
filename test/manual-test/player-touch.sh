#!/bin/bash
# #70: real touches on the player's head row (PlayerTouchProbe.swift) — the
# empty left slot and the gap beside a short name open nothing, the name opens
# Voice, the arrow collapses the player.
#
#   bash test/manual-test/player-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR
#
# Needs a Document already open, the player expanded, and Azure's "Andrew"
# already the chosen Voice (set up through the harness beforehand — see
# PlayerTouchProbe.swift's own doc comment). Plays nothing. Leaves the player
# collapsed; re-expand it afterwards with the harness
# (`{"do":"collapse","on":false}`).
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: player-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR' >&2; exit 2; fi
simulator=$1
output=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/ios/project.rb" "$output" top.xujialiu.openreader NO inspect PlayerTouchProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" \
  -only-testing:LockScreenProbe/PlayerTouchProbe/testHeadRowTouches \
  test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments" > /dev/null 2>&1 || true
  # Exported attachments are named by UUID; give each its own suggested name
  # (line-colour.sh's pattern).
  python3 - "$output/attachments" <<'PY' || true
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
printf 'Artifacts: %s\n' "$output"
exit "$status"
