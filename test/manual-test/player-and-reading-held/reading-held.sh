#!/bin/bash
# Real touches for #68 (ReadingHeldProbe.swift): going back while the
# reading plays keeps it, the Library's Reading Button returns to it, and the
# Reading ends on leaving it paused, opening another document or deleting it.
# Three methods press Play, so the simulator's own volume is checked first.
# The delete method really deletes the fixture, and this script adds it back
# afterwards through the harness.
# Pass -only-testing:METHOD to run one method.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: reading-held.sh SIMULATOR_UDID NEW_OUTPUT_DIR [-only-testing:testName ...]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
bash "$source_dir/../kit/silence.sh" check "$simulator" || exit 2
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect ReadingHeldProbe.swift
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/ReadingHeldProbe/${arg#-only-testing:}") ;;
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
grep -h 'Executed \|error:\|ROW ' "$output/test.log" | sort -u || true
# The fixture back, if the delete method took it: generated again and added
# through the harness, the way any fixture is loaded (README, "Real books").
data=$(xcrun simctl get_app_container "$simulator" top.xujialiu.openreader data)
if ! grep -q 'A Short Test of Reading Aloud' "$data/Documents/library.json" 2>/dev/null; then
  (cd "$source_dir/../../.." && npx tsx test/manual-test/fixtures/short-test-fixture.ts "$output/fixture" >/dev/null)
  mkdir -p "$data/Documents/Inbox"
  cp "$output/fixture/A Short Test of Reading Aloud.epub" "$data/Documents/Inbox/"
  printf '{"seq":%s,"do":"add","file":"A Short Test of Reading Aloud.epub"}\n' "$(date +%s)" > "$data/Documents/harness.json"
  sleep 3
  grep -q 'A Short Test of Reading Aloud' "$data/Documents/library.json" && echo 'Fixture added back' || echo 'The fixture was not added back' >&2
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
