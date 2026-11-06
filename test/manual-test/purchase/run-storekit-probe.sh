#!/bin/bash
# Runs StoreKitSessionProbe against a booted simulator: generates the disposable
# project with project-storekit.rb (which bundles storekit/OpenReader.storekit),
# runs `xcodebuild test` and exports the attachments. The caller holds the
# ios_guard slot (this script does not take one itself); the simulator's volume
# must already be zero per kit/silence.sh even though no audio is played.
#
#   bash test/manual-test/purchase/run-storekit-probe.sh SIMULATOR_UDID OUTPUT_DIR \
#     [-only-testing:StoreKitSessionProbe/test01BuyTrialThroughStoreKitTestSessionAndSeeItInSettings] [XCODEBUILD_ARG ...]
#
# Writes result-STAMP.xcresult, test-STAMP.log and attachments-STAMP/ under
# OUTPUT_DIR. Exit status: xcodebuild's; 2 setup.
set -euo pipefail
kit=$(cd "$(dirname "$0")/.." && pwd)/kit
wt=$(cd "$(dirname "$0")/../.." && pwd)
[[ $# -ge 2 ]] || { echo 'usage: run-storekit-probe.sh SIMULATOR_UDID OUTPUT_DIR [XCODEBUILD_ARG ...]' >&2; exit 2; }
simulator=$1
output=$2
shift 2
# The caller must already hold the shared lane; refuse to run beside a holder.
python3 "$kit/ios_guard.py" check-owner || exit 69
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$output"
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$(dirname "$0")/project-storekit.rb" "$output" top.xujialiu.openreader NO inspect StoreKitSessionProbe.swift
elif [[ -n $(find "$output" -name 'project-storekit-*' -not -path "$output/dd/*" 2>/dev/null) ]]; then
  : # regenerated marker absent; reuse
fi
plutil -replace ManualMode -string inspect "$output/Probe-Info.plist" 2>/dev/null || true
set +e
xcodebuild test \
  -project "$output/ManualTests.xcodeproj" \
  -scheme StoreKitSessionProbe \
  -destination "id=$simulator" \
  -derivedDataPath "$output/dd" \
  -resultBundlePath "$output/result-$stamp.xcresult" \
  -collect-test-diagnostics never \
  "$@" \
  > "$output/test-$stamp.log" 2>&1
rc=$?
set -e
grep -E "Test Suite|Test Case.*(passed|failed)|Executed .* test" "$output/test-$stamp.log" | tail -20 > "$output/summary-$stamp.txt" || true
grep -E "PROBE-" "$output/test-$stamp.log" | head -12 >> "$output/summary-$stamp.txt" || true
cat "$output/summary-$stamp.txt"
mkdir -p "$output/attachments-$stamp"
xcrun xcresulttool export attachments --path "$output/result-$stamp.xcresult" --output-path "$output/attachments-$stamp" || true
exit $rc
