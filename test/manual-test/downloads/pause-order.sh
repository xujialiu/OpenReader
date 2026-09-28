#!/bin/bash
# Live #56 order/mixed-state/add/restart checks through PauseOrderProbe, on
# the three-chapter Pause Order Fixture (test/manual-test/fixtures/pause-order-fixture.ts).
# `testOrderMixedAddAndRingSweep` and `testOrderAfterRestart` are two
# independent invocations, like `download-ring.sh`'s `testReopenDownloadDrawer`:
# restart the app from the host (`xcrun simctl terminate` + `launch
# -RCT_jsLocation PORT`) between them, never with XCTest's own
# `app.terminate()`/`app.launch()`, which drops that launch argument.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: pause-order.sh SIMULATOR_UDID NEW_OUTPUT_DIR [-only-testing:PauseOrderProbe/testName]' >&2; exit 2; fi
simulator=$1
output=$2
shift 2
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect PauseOrderProbe.swift
status=0
only_testing=()
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/PauseOrderProbe/${arg#-only-testing:PauseOrderProbe/}") ;;
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
