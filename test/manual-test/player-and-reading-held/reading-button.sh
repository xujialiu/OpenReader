#!/bin/bash
# Real touches for #67 (ReadingButtonProbe.swift): the player's collapse
# takes the navigation bar with it, the Reading Button brings both back without
# playing or pausing, a lock-screen pause brings both back, and the edge swipe
# still leaves the reader. Two methods press Play, so the simulator's own volume
# is checked first. Pass -only-testing:METHOD to run one method.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: reading-button.sh SIMULATOR_UDID NEW_OUTPUT_DIR [-only-testing:testName ...]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
bash "$source_dir/../kit/silence.sh" check "$simulator" || exit 2
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect ReadingButtonProbe.swift
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/ReadingButtonProbe/${arg#-only-testing:}") ;;
    *) only_testing+=("$arg") ;;
  esac
done
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" ${only_testing[@]+"${only_testing[@]}"} \
  test > "$output/test.log" 2>&1 &
build=$!
# xcodebuild can outlive its tests by many minutes (README Pitfalls, "The
# shell"). Once the suite has reported, give it two minutes to write the
# result bundle, then stop it.
finished=
while kill -0 "$build" 2>/dev/null; do
  if [[ -z $finished ]] && grep -q "Test Suite '\(Selected\|All\) tests' \(passed\|failed\)" "$output/test.log" 2>/dev/null; then finished=$SECONDS; fi
  if [[ -n $finished ]] && (( SECONDS - finished > 120 )); then kill "$build" 2>/dev/null || true; echo 'xcodebuild outlived its tests by 120 s and was stopped' >&2; break; fi
  sleep 2
done
wait "$build" || status=$?
# The suite's own verdict, which a stopped xcodebuild's exit status is not.
if grep -q "Test Suite '\(Selected\|All\) tests' failed" "$output/test.log"; then status=1
elif grep -q "Test Suite '\(Selected\|All\) tests' passed" "$output/test.log"; then status=0; fi
if [[ -d "$output/result.xcresult" ]]; then
  # A stopped xcodebuild leaves the bundle unreadable; its screenshots are then
  # the raw PNGs in result.xcresult/Data/data.* (README Pitfalls, "The shell").
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments" \
    || echo 'Attachments not exported: see result.xcresult/Data/data.*' >&2
fi
grep -h 'LINE \|Executed ' "$output/test.log" | sort -u || true
printf 'Artifacts: %s\n' "$output"
exit "$status"
