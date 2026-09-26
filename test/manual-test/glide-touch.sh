#!/bin/bash
# Real drag during a live glide (#71, ios/GlideTouchProbe.swift). Same shape as
# browse-touch.sh: a new output directory generates the project, an existing
# one reuses it. Presses Play, so checks the simulator's own volume first.
# Run `node glide-touch.cjs SIMULATOR_UDID METRO_LOG arm` before this, and
# `... analyse` after, to read what the drag actually did.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: glide-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:testName] [DRAG_DELAY_MS]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
bash "$source_dir/silence.sh" check "$simulator"
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$source_dir/ios/project.rb" "$output" top.xujialiu.openreader NO inspect GlideTouchProbe.swift
fi
result="$output/result-$(date +%s).xcresult"
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" \
  -only-testing:LockScreenProbe/GlideTouchProbe/testDragDuringLiveGlideStopsThenRecovers \
  test > "$output/test-$(date +%s).log" 2>&1 || status=$?
if [[ -d "$result" ]]; then
  xcrun xcresulttool export attachments --path "$result" --output-path "$output/attachments-$(basename "$result" .xcresult)"
fi
printf 'Artifacts: %s (result: %s)\n' "$output" "$result"
exit "$status"
