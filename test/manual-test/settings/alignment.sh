#!/bin/bash
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: alignment.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:AlignmentProbe/testName ...]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect AlignmentProbe.swift
fi
result="$output/result-$(date +%s).xcresult"
status=0
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/AlignmentProbe/${arg#-only-testing:}") ;;
    *) only_testing+=("$arg") ;;
  esac
done
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" ${only_testing[@]+"${only_testing[@]}"} test > "$output/test-$(date +%s).log" 2>&1 || status=$?
if [[ -d "$result" ]]; then
  xcrun xcresulttool export attachments --path "$result" --output-path "$output/attachments-$(basename "$result" .xcresult)"
fi
printf 'Artifacts: %s (result: %s)\n' "$output" "$result"
exit "$status"
