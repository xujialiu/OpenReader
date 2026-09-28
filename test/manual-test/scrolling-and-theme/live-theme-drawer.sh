#!/bin/bash
# #29 (live path): with a drawer already open, does its border switch to a
# newly chosen theme's line colour without being reopened? `useBorders()`
# reads `SchemeContext`, so this is now a React re-render (ADR 0046) where
# every other colour in `INK` needed none — a regression here would not show
# up in `line-colour.sh`, which always opens a drawer after the theme is
# already set.
#
#   bash test/manual-test/scrolling-and-theme/live-theme-drawer.sh SIMULATOR_UDID NEW_OUTPUT_DIR FROM_THEME TO_THEME
#
# FROM_THEME (dark|light) is the app's theme when the run starts; the run ends
# by restoring it. TO_THEME (dark|light) is pushed through the walkthrough
# harness while Contents is open. Needs `A Short Test of Reading Aloud` in the
# Library and this tree's Metro serving the app. Never presses Play; does not
# touch the simulator's own appearance, so pick FROM/TO to land on whichever
# pairing (matched or mismatched) is under test.
#
# Exit 1 = RED (the open drawer's lines did not read as FROM_THEME's colour
# before the patch, or as TO_THEME's after it, without reopening); 0 = GREEN;
# 3 = the probe itself failed, so the screenshots may not show the drawer.
set -euo pipefail
if [[ $# -lt 4 ]]; then echo 'Usage: live-theme-drawer.sh SIMULATOR_UDID NEW_OUTPUT_DIR dark|light dark|light' >&2; exit 2; fi
simulator=$1
output=$2
from=$3
to=$4
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
data=$(xcrun simctl get_app_container "$simulator" top.xujialiu.openreader data)
harness="$data/Documents/harness.json"
seq=$(( $(date +%s) % 1000000 * 10 ))
hx() {
  seq=$((seq + 1))
  python3 -c 'import json,sys,os; c=json.loads(sys.argv[1]); c["seq"]=int(sys.argv[2]); open(sys.argv[3]+".tmp","w").write(json.dumps(c)); os.replace(sys.argv[3]+".tmp", sys.argv[3])' "$1" "$seq" "$harness"
  sleep "${2:-1}"
}
restore() {
  hx "{\"do\":\"settings\",\"patch\":{\"theme\":\"$from\"}}" 1
  hx '{"do":"shut"}' 1.5
  rm -f "$harness"
}
trap restore EXIT
hx "{\"do\":\"settings\",\"patch\":{\"theme\":\"$from\"}}" 2
hx '{"do":"shut"}' 1
hx '{"do":"shut"}' 2
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect LineColourProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" -collect-test-diagnostics never \
  -only-testing:LockScreenProbe/LineColourProbe/testOpenContentsAndLeaveIt \
  test > "$output/test.log" 2>&1 || status=$?
[[ $status -eq 0 ]] || { echo "The probe failed ($status): see $output/test.log" >&2; exit 3; }
xcrun simctl io "$simulator" screenshot "$output/before.png" > /dev/null
hx "{\"do\":\"settings\",\"patch\":{\"theme\":\"$to\"}}" 2
xcrun simctl io "$simulator" screenshot "$output/after.png" > /dev/null
printf 'Artifacts: %s\n' "$output"
echo "-- before, drawer opened under $from --"
before_status=0
python3 "$source_dir/line-colour.py" "$from" "$output/before.png" || before_status=$?
echo "-- after, same drawer never reopened, patched to $to --"
after_status=0
python3 "$source_dir/line-colour.py" "$to" "$output/after.png" || after_status=$?
[[ $before_status -eq 0 && $after_status -eq 0 ]]
