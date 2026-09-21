#!/bin/bash
# VoiceListProbe (#24): a cold start, a few seconds, then the voice sheet must
# already list the Voices; chooses Dax from en-US. Real touches; never plays.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: voice-list.sh SIMULATOR_UDID NEW_OUTPUT_DIR [-only-testing:testName]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/ios/project.rb" "$output" top.xujialiu.openreader NO inspect VoiceListProbe.swift
status=0
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/VoiceListProbe/${arg#-only-testing:}") ;;
    *) only_testing+=("$arg") ;;
  esac
done
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" ${only_testing[@]+"${only_testing[@]}"} test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments"
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
