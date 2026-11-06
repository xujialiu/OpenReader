#!/bin/bash
# Runs StoreKitSessionUI (the attached UI-test arrangement) against a booted
# simulator, FAIL CLOSED: the shared-lane slot must already be held (checked),
# the simulator must already be silenced, the scheme's PROBE_MODE must match
# the requested mode before the run, and the raw log is validated afterwards by
# validate-ui-summary.js (specific acceptance methods passed, no repurchase in
# verify mode, nonzero failing runs preserved). The simulator's volume is
# checked here because no audio may sound while formal purchase UI runs.
#
#   bash test/manual-test/purchase/run-storekit-ui.sh WORKTREE UDID OUTDIR [MODE]
#
# MODE (establish|verify) is written into the scheme by set-scheme-env.rb; this
# wrapper only checks it matches. Exit status: 0 validated pass; 1 validation
# failure; 2 usage; other nonzero preserves xcodebuild's own failure code.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
kit="$here/../kit"
wt=$1
simulator=$2
output=$3
mode=${4:-}
[[ -n $mode ]] || { echo 'usage: run-storekit-ui.sh WORKTREE UDID OUTDIR establish|verify' >&2; exit 2; }
[[ $mode == establish || $mode == verify ]] || { echo "mode must be establish|verify, got '$mode'" >&2; exit 2; }
python3 "$kit/ios_guard.py" check-owner || exit 69
bash "$kit/silence.sh" check "$simulator"

stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$output"
dd="$output/dd-$(basename "$wt")"
scheme="$wt/ios/OpenReader.xcodeproj/xcshareddata/xcschemes/StoreKitUI.xcscheme"
[[ -f $scheme ]] || { echo "BLOCKED: $scheme missing (add-storekit-ui-target.rb first)" >&2; exit 2; }
if ! grep -q "<EnvironmentVariable key=\"PROBE_MODE\" value=\"$mode\"/>" "$scheme"; then
  echo "BLOCKED: scheme PROBE_MODE does not match requested mode '$mode' (set-scheme-env.rb first)" >&2
  grep -o 'PROBE_MODE" value="[^"]*"' "$scheme" | head -1 >&2 || true
  exit 2
fi

# The validator compares the kept ledger against the establish ledger recorded
# in the scheme (verify mode requires it; establish ignores it).
export EXPECTED_TX
EXPECTED_TX=$(grep -o 'EXPECTED_TX" value="[^"]*"' "$scheme" | head -1 | sed -E 's/.*value="([^"]*)".*/\1/')
if [ "$mode" = verify ] && [ -z "$EXPECTED_TX" ]; then
  echo "BLOCKED: verify run needs a nonempty EXPECTED_TX in the scheme (set-scheme-env.rb first)" >&2
  exit 2
fi

# Release configuration: the app embeds its bundle, so no Metro is needed and
# no stale/plist RCT_jsLocation can redirect it (a Debug-config test build with
# an empty generated RCTMetroPort mis-attached to another tree's Metro and fed
# SDK58 JavaScript into an SDK57 shell, 2026-11-06).
set +e
xcodebuild test \
  -workspace "$wt/ios/OpenReader.xcworkspace" \
  -scheme StoreKitUI \
  -configuration Release \
  -destination "id=$simulator" \
  -derivedDataPath "$dd" \
  -resultBundlePath "$output/result-$stamp-$mode.xcresult" \
  -collect-test-diagnostics never \
  > "$output/ui-test-$stamp-$mode.log" 2>&1
rc=$?
set -e

grep -E "Test Case.*(passed|failed|skipped)|Executed .* test" "$output/ui-test-$stamp-$mode.log" \
  | tail -12 > "$output/ui-summary-$stamp-$mode.txt" || true
grep -E "^PROBE-" "$output/ui-test-$stamp-$mode.log" | head -12 >> "$output/ui-summary-$stamp-$mode.txt" || true
cat "$output/ui-summary-$stamp-$mode.txt"
mkdir -p "$output/ui-attachments-$stamp-$mode"
xcrun xcresulttool export attachments --path "$output/result-$stamp-$mode.xcresult" \
  --output-path "$output/ui-attachments-$stamp-$mode" || true

# Completed xcresult summary must exist and be readable.
xcrun xcresulttool get test-results summary --path "$output/result-$stamp-$mode.xcresult" \
  > "$output/xcresult-summary-$stamp-$mode.json" 2>/dev/null || {
  echo "VALIDATE FAIL: no readable xcresult summary for this run" >&2
  exit 1
}
cat > "$output/check-summary-$stamp-$mode.js" <<'CHECKEOF'
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!['Passed', 'Failed'].includes(d.result)) { console.error('xcresult not completed'); process.exit(1); }
if (Number(d.failedTests || 0) !== 0) { console.error('failed tests present'); process.exit(1); }
CHECKEOF
if ! node "$output/check-summary-$stamp-$mode.js" "$output/xcresult-summary-$stamp-$mode.json"; then
  echo "VALIDATE FAIL: completed xcresult summary check failed" >&2
  exit 1
fi

if ! node "$here/validate-ui-summary.js" "$mode" "$output/ui-test-$stamp-$mode.log"; then
  echo "VALIDATE FAIL for $mode run (log $output/ui-test-$stamp-$mode.log)" >&2
  exit 1
fi
if [ "$rc" != 0 ]; then
  echo "VALIDATE PASS but xcodebuild exited $rc; preserving nonzero" >&2
  exit "$rc"
fi
echo "VALIDATE PASS $mode ($output/ui-test-$stamp-$mode.log)"
exit 0
