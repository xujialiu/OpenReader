#!/bin/bash
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: pause-suspend.sh SIMULATOR_UDID NEW_OUTPUT_DIR' >&2; exit 2; fi
simulator=$1
output=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
bash "$source_dir/../kit/silence.sh" check "$simulator" || exit 2
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect PauseSuspendProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" \
  -only-testing:LockScreenProbe/PauseSuspendProbe/testPauseResumeOrderingAndSkip \
  test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments"
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
