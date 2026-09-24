#!/bin/bash
# Two-finger drags against Files (the phone's own selection, measured) or the
# download drawer (ours), through TwoFingerProbe (#57). The Files methods need
# the staged rows: `two-finger.sh SIMULATOR_UDID stage` puts 60 small files in
# On My iPhone › Rows first.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: two-finger.sh SIMULATOR_UDID stage | two-finger.sh SIMULATOR_UDID NEW_OUTPUT_DIR -only-testing:TwoFingerProbe/testName' >&2; exit 2; fi
simulator=$1
if [[ $2 == stage ]]; then
  group=$(xcrun simctl get_app_container "$simulator" com.apple.DocumentsApp groups | awk -F'\t' '$1 == "group.com.apple.FileProvider.LocalStorage" { print $2 }')
  [[ -n "$group" ]] || { echo 'Files has no local storage yet: launch Files once, then stage' >&2; exit 2; }
  mkdir -p "$group/File Provider Storage/Rows"
  for i in $(seq -w 1 60); do printf 'row %s\n' "$i" > "$group/File Provider Storage/Rows/Row $i.txt"; done
  echo "Staged 60 rows in $group/File Provider Storage/Rows"
  exit 0
fi
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/ios/project.rb" "$output" com.apple.DocumentsApp NO inspect TwoFingerProbe.swift
status=0
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/TwoFingerProbe/${arg#-only-testing:TwoFingerProbe/}") ;;
    *) only_testing+=("$arg") ;;
  esac
done
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" ${only_testing[@]+"${only_testing[@]}"} test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments" > /dev/null 2>&1 || true
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
