#!/bin/bash
# Real fast flicks on the open reader (ios/FlingProbe.swift), for the
# fling-jump probe. Builds the XCTest project once into OUT_DIR, then runs
# FlingProbe.testFlicks without rebuilding.
#
#   bash test/manual-test/fling-jump.sh SIMULATOR_UDID OUT_DIR
#
# FLINGS, DIRECTION (down|up), VELOCITY (pt/s), GAP and SETTLE (s) and NOWAIT
# (0 keeps XCTest's idle waits) pass through to the probe. Never plays.
set -euo pipefail
if [[ $# -lt 2 ]]; then sed -n '6p' "$0" >&2; exit 2; fi
simulator=$1
output=$2
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$here/ios/project.rb" "$output" top.xujialiu.openreader NO inspect FlingProbe.swift
fi
if ! ls "$output"/build/Build/Products/*.xctestrun > /dev/null 2>&1; then
  xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$output/build" build-for-testing > "$output/build.log" 2>&1
fi
run=$(ls "$output"/build/Build/Products/*.xctestrun | head -1)
log="$output/test-$(date +%s).log"
status=0
TEST_RUNNER_FLINGS=${FLINGS:-10} TEST_RUNNER_DIRECTION=${DIRECTION:-down} TEST_RUNNER_VELOCITY=${VELOCITY:-4000} \
TEST_RUNNER_GAP=${GAP:-0.1} TEST_RUNNER_SETTLE=${SETTLE:-2} TEST_RUNNER_NOWAIT=${NOWAIT:-1} \
  xcodebuild test-without-building -xctestrun "$run" -destination "id=$simulator" \
  -only-testing:LockScreenProbe/FlingProbe/testFlicks > "$log" 2>&1 || status=$?
grep -E 'FLINGPROBE|Executed|error:' "$log" | head -5
exit "$status"
