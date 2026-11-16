#!/bin/bash
# Diagnostic-only cached StoreKit probe. This is not App Store acceptance:
# run-storekit-ui.sh remains the canonical establish/verify validator.
#
#   bash storekit-fast-diagnostic.sh WORKTREE UDID DERIVED_DATA OUTDIR
#
# The DerivedData directory must already contain a formal StoreKitUI build.
# Exit status: 0 GREEN, 1 RED, 69 BLOCKED/ambiguous.
set -euo pipefail
[[ $# -eq 4 ]] || { echo 'usage: storekit-fast-diagnostic.sh WORKTREE UDID DERIVED_DATA OUTDIR' >&2; exit 2; }
worktree=$1
simulator=$2
derived_data=$3
output=$4
mkdir -p "$output"
stamp=$(date +%H%M%S)
log="$output/test-$stamp.log"
result="$output/result-$stamp.xcresult"
python3 "$worktree/test/manual-test/kit/ios_guard.py" check-owner
bash "$worktree/test/manual-test/kit/silence.sh" set "$simulator"
bash "$worktree/test/manual-test/kit/silence.sh" check "$simulator"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode-27.1.0.app/Contents/Developer}
set +e
xcodebuild test-without-building -workspace "$worktree/ios/OpenReader.xcworkspace" -scheme StoreKitUI -configuration Release -destination "id=$simulator" -derivedDataPath "$derived_data" -resultBundlePath "$result" -only-testing:StoreKitSessionUI/StoreKitSessionUI/test01BuyTrialAndSeeDaysLeft > "$log" 2>&1 &
xcode_pid=$!
set -e

for _ in $(seq 1 150); do
  if grep -q 'PROBE-TRANSACTIONS-BEFORE 0' "$log"; then break; fi
  if ! kill -0 "$xcode_pid" 2>/dev/null; then
    echo "BLOCKED xcodebuild exited before StoreKit evidence" >&2
    tail -n 80 "$log" >&2
    exit 69
  fi
  sleep 0.2
done
if ! grep -q 'PROBE-TRANSACTIONS-BEFORE 0' "$log"; then
  echo "BLOCKED StoreKit transaction marker did not appear within 30s" >&2
  kill "$xcode_pid" 2>/dev/null || true
  wait "$xcode_pid" 2>/dev/null || true
  exit 69
fi
for _ in $(seq 1 50); do
  if grep -Eq "Test Case .*test01BuyTrialAndSeeDaysLeft.*(passed|failed)" "$log"; then break; fi
  sleep 0.2
done

classification="$output/classification-$stamp.json"
set +e
node "$worktree/test/manual-test/purchase/classify-storekit-fast.js" "$log" > "$classification"
classification_rc=$?
set -e
cat "$classification"
kill "$xcode_pid" 2>/dev/null || true
wait "$xcode_pid" 2>/dev/null || true
exit "$classification_rc"
