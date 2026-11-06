#!/bin/bash
# Runs StoreKitSessionUI (the attached UI-test arrangement) against a booted
# simulator. The caller holds the ios_guard slot; the simulator's volume must
# already be zero. This builds the FORMAL app from the tree's generated formal
# project (the project the target was added to by add-storekit-ui-target.rb).
#
#   bash test/manual-test/purchase/run-storekit-ui.sh WORKTREE UDID OUTDIR [MODE]
#
# MODE is passed to the runner as TEST_RUNNER_PROBE_MODE (establish|verify).
set -euo pipefail
wt=$1
simulator=$2
output=$3
mode=${4:-establish}
python3 "$(dirname "$0")/../kit/ios_guard.py" check-owner || exit 69
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$output"
set +e
# Release configuration: the app embeds its bundle, so no Metro is needed and
# no stale/plist RCT_jsLocation can redirect it (a Debug-config test build with
# an empty generated RCTMetroPort mis-attached to another tree's Metro and fed
# SDK58 JavaScript into an SDK57 shell, 2026-11-06).
xcodebuild test \
  -workspace "$wt/ios/OpenReader.xcworkspace" \
  -scheme StoreKitUI \
  -configuration Release \
  -destination "id=$simulator" \
  -derivedDataPath "$output/dd-$(basename "$wt")" \
  -resultBundlePath "$output/result-$stamp-$mode.xcresult" \
  -collect-test-diagnostics never \
  > "$output/ui-test-$stamp-$mode.log" 2>&1
rc=$?
set -e
grep -E "Test Case.*(passed|failed|skipped)|Executed .* test" "$output/ui-test-$stamp-$mode.log" \
  | tail -12 > "$output/ui-summary-$stamp-$mode.txt" || true
grep -E "PROBE-" "$output/ui-test-$stamp-$mode.log" | head -12 >> "$output/ui-summary-$stamp-$mode.txt" || true
cat "$output/ui-summary-$stamp-$mode.txt"
mkdir -p "$output/ui-attachments-$stamp-$mode"
xcrun xcresulttool export attachments --path "$output/result-$stamp-$mode.xcresult" \
  --output-path "$output/ui-attachments-$stamp-$mode" || true
exit $rc
