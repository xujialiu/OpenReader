#!/bin/bash
# #71 batches 3/4 (ADR 0050): real touches for A/M, the way back, the collapsed
# lock, Theme, Scrolling, and the Library round trip (FollowingProbe.swift).
#
#   bash test/manual-test/place-and-following/following-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:testName ...]
#
# With no -only-testing argument, runs the whole class in declared order, which
# these methods are not all safe to do blind (some need a specific starting
# state another script step sets up first) — pass -only-testing explicitly.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: following-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:testName ...]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect FollowingProbe.swift
fi
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/FollowingProbe/${arg#-only-testing:}") ;;
    *) only_testing+=("$arg") ;;
  esac
done
result="$output/result-$(date +%s).xcresult"
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" -collect-test-diagnostics never \
  ${only_testing[@]+"${only_testing[@]}"} test > "$output/test-$(date +%s).log" 2>&1 || status=$?
if [[ -d "$result" ]]; then
  attachments="$output/attachments-$(basename "$result" .xcresult)"
  xcrun xcresulttool export attachments --path "$result" --output-path "$attachments" > /dev/null 2>&1 || true
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
