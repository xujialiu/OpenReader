#!/bin/bash
# HOST-only old-vs-new scanner repro controls from the ACTUAL retained
# attempt-02 artifacts (no native replay, no device, no network).
#
# Background (2026-11-15): attempt-02's probe PASSED (1 test, 0 failures,
# 6.857 s) but the framework echoed a TRUNCATED 18-character prefix of the
# typed input (`Type 'OPENREADER_PUBLIC_...`) into the test log and activity
# titles — PRIVACY FAIL for this transport. The old scanner could not see it:
# it only matched the full 36-character sentinel (false clean), and its
# per-character `.{0,300}` backtracking regex hung for minutes on the retained
# diagnostics session log.
#
# This script proves, with per-process deadlines:
#   1. OLD scanner (git blob FISH_SCANNER_OLD_REF, default 6adabe7) on a fake
#      tree carrying the ACTUAL retained test/build/activity/diagnostic logs:
#      must go RED — either it exceeds the deadline or it completes with a
#      false PRIVACY-CLEAN. Either outcome is recorded as the old failure.
#   2. NEW scanner (working tree) on the SAME tree with a 60 s budget: must
#      finish quickly with PRIVACY-NOT-QUALIFIED citing the truncated prefix.
#   3. NEW scanner against the ACTUAL saved attempt-02 outputs (report written
#      OUTSIDE the immutable originals via --report-path): must be
#      PRIVACY-NOT-QUALIFIED.
#
# Usage: bash test/manual-test/duo-verification/fish-scanner-repro-controls.sh
#   SRC defaults to the preserved tester copy of attempt-02.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
scanner="$root/test/manual-test/duo-verification/fish-privacy-scan.py"
runner="$root/test/manual-test/duo-verification/fish-classifier-red-green.sh"
old_ref=${FISH_SCANNER_OLD_REF:-6adabe7}
src=${FISH_ATTEMPT02_SRC:-$HOME/OpenReader-test-records/issue-353-2026-11-15/public-attempt-02/attempt-02}
out=${FISH_RESCAN_REPORT:-$HOME/OpenReader-test-records/issue-353-2026-11-15/public-attempt-02/new-scanner-rescan-report.json}
deadline() { # SECONDS CMD... — per-process deadline via perl alarm
  perl -e 'alarm shift @ARGV; exec @ARGV or die "exec: $!"' "$@"
}

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

echo "== fixture: fake tree carrying the ACTUAL retained logs =="
P="$work/A/public-probe"; mkdir -p "$P/result-T.xcresult" "$P/attachments-export" "$P/diagnostics"
mkdir -p "$work/A" "$work/repo" "$work/prep"
printf 'Artifacts: %s (result: %s, log: %s)\n' "$P" "$P/result-T.xcresult" "$P/test-T.log" > "$work/A/probe-invocation.log"
cp "$src/public-probe/"test-*.log "$P/test-T.log"
cp "$src/public-probe/"build-*.log "$P/build-0001.log"
cp "$src/public-probe/activities-export.json" "$P/activities-export.json"
cp "$src/summary-export.json" "$work/A/summary-export.json"
printf '{"result":"Passed"}\n' > "$P/result-T.xcresult/Info.plist"
printf '[]\n' > "$P/attachments-export/manifest.json"
if [ -d "$src/public-probe/diagnostics" ]; then
  cp -R "$src/public-probe/diagnostics/." "$P/diagnostics/"
fi
printf '// fake probe source\nlet publicSentinel = "OPENREADER_PUBLIC_FISH_SENTINEL_8437"\n' > "$work/repo/FishKeyEntryProbe.swift"
printf 'SENTINEL="OPENREADER_PUBLIC_FISH_SENTINEL_8437"\n' > "$work/prep/public-phase.sh"
du -sh "$P/diagnostics" | awk '{print "diagnostics copy: " $1}'
grep -c "OPENREADER_PUBLIC_" "$P/test-T.log" | awk '{print "truncated Type lines in copied test log: " $0}'

echo "== extract OLD scanner verbatim from blob $old_ref =="
git -C "$root" show "$old_ref:test/manual-test/duo-verification/fish-privacy-scan.py" > "$work/old-scanner.py"
[ -s "$work/old-scanner.py" ] || { echo "FAIL: old scanner blob missing" >&2; exit 2; }
grep -F -q '.{0,300}' "$work/old-scanner.py" \
  || { echo "FAIL: blob $old_ref does not carry the unbounded per-char regex" >&2; exit 2; }

echo "== OLD scanner under a 30 s deadline (expect RED: timeout or false clean) =="
set +e
deadline 30 python3 "$work/old-scanner.py" --attempt "$work/A" --prep "$work/prep" \
  --repo-source "$work/repo/FishKeyEntryProbe.swift" --runner-source "$runner" \
  > "$work/old.out" 2>&1
old_rc=$?
set -e
OLD_SECONDS=$(python3 -c "import json;print(json.load(open('$work/A/privacy-scan-report.json')).get('elapsed_seconds'))" 2>/dev/null || echo none)
echo "OLD-EXIT=$old_rc OLD-ELAPSED-JSON=$OLD_SECONDS"
tail -3 "$work/old.out" || true
if [ "$old_rc" -eq 142 ] || [ "$old_rc" -eq 124 ]; then
  OLD_VERDICT="RED-TIMEOUT"
elif [ "$old_rc" -eq 0 ]; then
  OLD_VERDICT="RED-FALSE-CLEAN"
else
  OLD_VERDICT="RED-OTHER-EXIT-$old_rc"
fi
echo "OLD-VERDICT=$OLD_VERDICT"
case "$OLD_VERDICT" in
  RED-TIMEOUT|RED-FALSE-CLEAN) : ;;
  *) echo "FAIL: old scanner neither timed out nor produced a false clean" >&2; exit 1 ;;
esac

echo "== NEW scanner, same tree, 60 s budget (expect quick NOT QUALIFIED) =="
NEW_START=$(date +%s)
set +e
deadline 90 python3 "$scanner" --attempt "$work/A" --prep "$work/prep" \
  --repo-source "$work/repo/FishKeyEntryProbe.swift" --runner-source "$runner" \
  --budget-seconds 60 --report-path "$work/new-report.json" \
  > "$work/new.out" 2>&1
new_rc=$?
set -e
NEW_END=$(date +%s)
echo "NEW-EXIT=$new_rc NEW-WALL-SECONDS=$((NEW_END - NEW_START))"
tail -8 "$work/new.out"
[ "$new_rc" -eq 1 ] || { echo "FAIL: new scanner must be NOT QUALIFIED on the actual leak shape" >&2; exit 1; }
python3 - "$work/new-report.json" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report["verdict"] == "PRIVACY-NOT-QUALIFIED", report["verdict"]
assert any("type-payload" in str(l.get("encoding")) for l in report["leaks"]), report["leaks"]
assert report["elapsed_seconds"] < 60, report["elapsed_seconds"]
print("NEW-REPORT leaked-prefixes:", sorted({l["payload"] for l in report["leaks"] if "payload" in l}))
PY

echo "== NEW scanner against the ACTUAL saved attempt-02 outputs (report outside the originals) =="
mkdir -m 700 -p "$(dirname "$out")"
set +e
deadline 120 python3 "$scanner" --attempt "$src" --prep "$work/prep" \
  --repo-source "$work/repo/FishKeyEntryProbe.swift" --runner-source "$runner" \
  --budget-seconds 120 --report-path "$out" \
  > "$work/rescan.out" 2>&1
rescan_rc=$?
set -e
echo "RESCAN-EXIT=$rescan_rc"
tail -8 "$work/rescan.out"
python3 - "$out" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report["verdict"] == "PRIVACY-NOT-QUALIFIED", report["verdict"]
assert report["leaks"], "no leaks recorded"
print("RESCAN-VERDICT:", report["verdict"], "leaks:", len(report["leaks"]),
      "elapsed:", report["elapsed_seconds"])
PY

echo "REPRO-CONTROLS-OK: old=$OLD_VERDICT on blob $old_ref; new=PRIVACY-NOT-QUALIFIED (fast) on the same tree and on the actual saved attempt-02 outputs (report: $out)"
