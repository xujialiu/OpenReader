#!/bin/bash
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 ]]; then echo 'Usage: reader.sh SIMULATOR_UDID NEW_OUTPUT_DIR [inspect|loading|fish]' >&2; exit 2; fi
simulator=$1
output=$2
mode=${3:-inspect}
[[ "$mode" == inspect || "$mode" == loading || "$mode" == fish ]] || exit 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO "$mode" ReaderProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments"
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
