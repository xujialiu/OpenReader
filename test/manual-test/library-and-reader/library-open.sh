#!/bin/bash
set -euo pipefail
if [[ $# != 3 ]]; then echo 'Usage: library-open.sh SIMULATOR_UDID NEW_OUTPUT_DIR DOCUMENT_TITLE' >&2; exit 2; fi
simulator=$1
output=$2
title=$3
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO "$title" LibraryOpenProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments"
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
