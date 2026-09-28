#!/bin/bash
# The phone's own Settings, captured for design 0042's measurements (#48).
# Runs NativeReferenceProbe once in the light appearance and once in the dark,
# then gives the simulator back the appearance it had. Never opens OpenReader.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: native-reference.sh SIMULATOR_UDID NEW_OUTPUT_DIR' >&2; exit 2; fi
simulator=$1
output=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/light" && ! -e "$output/dark" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
before=$(xcrun simctl ui "$simulator" appearance)
status=0
for appearance in light dark; do
  run="$output/$appearance"
  mkdir -p "$run"
  xcrun simctl ui "$simulator" appearance "$appearance"
  ruby "$source_dir/../kit/project.rb" "$run" com.apple.Preferences NO inspect NativeReferenceProbe.swift
  xcodebuild -project "$run/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$output/build" \
    -resultBundlePath "$run/result.xcresult" test > "$run/test.log" 2>&1 || status=$?
  if [[ -d "$run/result.xcresult" ]]; then
    xcrun xcresulttool export attachments --path "$run/result.xcresult" --output-path "$run/attachments" > /dev/null 2>&1 || true
  fi
done
xcrun simctl ui "$simulator" appearance "$before"
printf 'Artifacts: %s\n' "$output"
exit "$status"
