#!/bin/bash
# Runs one XCTest probe (a `*Probe.swift` anywhere under test/manual-test)
# against a booted simulator: generates the disposable project with project.rb,
# runs `xcodebuild test`, and exports the attachments.
#
#   bash test/manual-test/kit/run-probe.sh PROBE SIMULATOR_UDID OUTPUT_DIR \
#     [--mode MODE] [--bundle BUNDLE_ID] [--expect-player] [-only-testing:METHOD ...] [XCODEBUILD_ARG ...]
#
# PROBE is the class name (`AlignmentProbe`). --mode, --bundle and
# --expect-player become the probe's `ManualMode` (default inspect),
# `ManualTargetBundleIdentifier` (default top.xujialiu.openreader) and
# `ManualExpectPlayer` (default NO); only the probes that read them care.
# -only-testing takes a method (`testFlicks`), `Class/method` or the full
# `LockScreenProbe/Class/method`; without it the whole class runs. Any other
# argument goes to xcodebuild as it is: after a failed test xcodebuild can wait
# ten minutes collecting diagnostics, which `-collect-test-diagnostics never`
# skips at the cost of the probe's own print() lines in the log
# (pitfalls/screenshots.md, pitfalls/verification-runs.md).
#
# A new OUTPUT_DIR gets the project; an existing one reuses it (with the mode,
# bundle and player flag of this call), and refuses a project generated for a
# different probe or from another worktree. Each run writes
# result-STAMP.xcresult, test-STAMP.log and attachments-STAMP/ there. The
# simulator's own volume must already be zero (kit/silence.sh), whether or not
# this probe plays.
#
# Exit status: xcodebuild's; 2 setup, 69 readiness/incomplete result, 75 slot
# busy, 124 deadline, 130/143 cancellation. Budgets (seconds) are separate:
# OPENREADER_PROBE_BUILD_SECONDS=1200, OPENREADER_PROBE_TEST_SECONDS=180,
# OPENREADER_IOS_WAIT_SECONDS=0. Long tests must declare their test budget.
set -euo pipefail
kit=$(cd "$(dirname "$0")" && pwd)
build_seconds=${OPENREADER_PROBE_BUILD_SECONDS:-1200}
test_seconds=${OPENREADER_PROBE_TEST_SECONDS:-180}
for seconds in "$build_seconds" "$test_seconds"; do
  [[ $seconds =~ ^[1-9][0-9]*$ ]] || { echo 'Probe budgets must be positive integer seconds' >&2; exit 2; }
done
if [[ ${1:-} == --under-guard ]]; then
  shift
  python3 "$kit/ios_guard.py" check-owner || exit 69
elif [[ $# -ge 3 ]]; then
  # Hold one slot over setup, build, test and cleanup, including nested guards.
  exec python3 "$kit/ios_guard.py" run --timeout "$((build_seconds + test_seconds + 180))" \
    --grace 15 --wait "${OPENREADER_IOS_WAIT_SECONDS:-0}" \
    --record "$3/phase-$(date +%Y%m%d-%H%M%S)-$$.json" \
    -- bash "$0" --under-guard "$@"
fi
usage='Usage: run-probe.sh PROBE SIMULATOR_UDID OUTPUT_DIR [--mode MODE] [--bundle BUNDLE_ID] [--expect-player] [-only-testing:METHOD ...] [XCODEBUILD_ARG ...]'
if [[ $# -lt 3 ]]; then echo "$usage" >&2; exit 2; fi
probe=${1%.swift}
simulator=$2
output=$3
shift 3
[[ $probe =~ ^[A-Za-z0-9]+$ ]] || { echo "PROBE is a class name such as AlignmentProbe, not '$probe'" >&2; exit 2; }
[[ -n $(find "$kit/.." -name "$probe.swift" -not -path '*/archive/*') ]] || { echo "No $probe.swift under test/manual-test" >&2; exit 2; }
mode=inspect
bundle=top.xujialiu.openreader
expect_player=NO
extra=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) [[ $# -ge 2 ]] || { echo "$usage" >&2; exit 2; }; mode=$2; shift 2 ;;
    --bundle) [[ $# -ge 2 ]] || { echo "$usage" >&2; exit 2; }; bundle=$2; shift 2 ;;
    --expect-player) expect_player=YES; shift ;;
    -only-testing:*)
      method=${1#-only-testing:}
      method=${method#LockScreenProbe/}
      method=${method#"$probe"/}
      if [[ $method == "$probe" ]]; then extra+=("-only-testing:LockScreenProbe/$probe")
      else extra+=("-only-testing:LockScreenProbe/$probe/$method"); fi
      shift ;;
    *) extra+=("$1"); shift ;;
  esac
done

mkdir -p "$output"
output=$(cd "$output" && pwd)
# A failed/aborted probe must not leave its target playing. Only this explicitly
# selected simulator and target are touched; cleanup has its own deadline.
finish() {
  status=$?
  trap - EXIT INT TERM
  if [[ $status -ne 0 ]]; then
    python3 "$kit/ios_guard.py" run --timeout 10 -- \
      xcrun simctl terminate "$simulator" "$bundle" > "$output/stop-target.log" 2>&1 || true
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 "$kit/ios_ready.py" "$simulator" "$output/readiness" || exit $?
python3 "$kit/ios_guard.py" run --timeout 20 -- bash "$kit/silence.sh" check "$simulator" || exit 2
# The project names its Swift file by absolute path, so a directory generated
# from another worktree would build that tree's probe (pitfalls/verification-runs.md).
built_for="$probe from $(cd "$kit/../../.." && pwd)"
if [[ -e "$output/ManualTests.xcodeproj" ]]; then
  holds=$(cat "$output/probe.txt" 2>/dev/null || echo 'an unknown probe')
  [[ $holds == "$built_for" ]] || { echo "$output holds a project for $holds; use a new directory for $built_for" >&2; exit 2; }
  plutil -replace ManualMode -string "$mode" "$output/Probe-Info.plist"
  plutil -replace ManualTargetBundleIdentifier -string "$bundle" "$output/Probe-Info.plist"
  plutil -replace ManualExpectPlayer -string "$expect_player" "$output/Probe-Info.plist"
else
  ruby "$kit/project.rb" "$output" "$bundle" "$expect_player" "$mode" "$probe.swift" || exit 2
  printf '%s\n' "$built_for" > "$output/probe.txt"
fi

stamp=$(date +%Y%m%d-%H%M%S)-$$
result="$output/result-$stamp.xcresult"
log="$output/test-$stamp.log"
status=0
# A cold compile gets a build budget; diagnostic collection after a failed test
# cannot spend that budget again. Both foreground process groups are bounded.
python3 "$kit/ios_guard.py" run --timeout "$build_seconds" --record "$output/build-$stamp.json" -- \
  xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  ${extra[@]+"${extra[@]}"} build-for-testing > "$output/build-$stamp.log" 2>&1 || status=$?
if [[ $status -ne 0 ]]; then
  echo "Build failed or timed out; artifacts: $output/build-$stamp.log" >&2
  exit "$status"
fi
python3 "$kit/ios_guard.py" run --timeout "$test_seconds" --record "$output/test-$stamp.json" -- \
  xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" ${extra[@]+"${extra[@]}"} test-without-building > "$log" 2>&1 || status=$?
summary="$output/summary-$stamp.json"
complete=NO
if [[ -f "$result/Info.plist" ]] && python3 "$kit/ios_guard.py" run --timeout 20 -- \
  xcrun xcresulttool get test-results summary --path "$result" > "$summary" 2> "$output/summary-$stamp.log"; then
  complete=YES
  python3 "$kit/ios_guard.py" run --timeout 30 -- \
    xcrun xcresulttool export attachments --path "$result" --output-path "$output/attachments-$stamp" \
    > "$output/export-$stamp.log" 2>&1 || true
fi
if [[ $status -eq 0 ]]; then
  if [[ $complete != YES ]] || ! python3 - "$summary" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    result = json.load(source)
sys.exit(0 if result.get('result') == 'Passed' and result.get('failedTests') == 0 and result.get('passedTests', 0) > 0 else 1)
PY
  then
    echo 'BLOCKED: no completed, passing test-result summary' >&2
    status=69
  elif ! grep -Eq 'Executed [1-9][0-9]* test.*, with 0 failures' "$log" || grep -Eq 'Executed .*with [1-9][0-9]* failures' "$log"; then
    echo 'BLOCKED: no unambiguous executed, zero-failure result in the log' >&2
    status=69
  fi
fi
grep -E 'Executed [0-9]+ test|error:|\*\* TEST' "$log" | sed -E 's/ \([0-9.]+\) seconds$/ seconds/' | awk '!seen[$0]++' | tail -4 || true
printf 'Artifacts: %s (result: %s, log: %s)\n' "$output" "$result" "$log"
exit "$status"
