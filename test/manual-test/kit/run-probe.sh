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
# Exit status is xcodebuild's; 2 is a usage or setup error.
set -euo pipefail
usage='Usage: run-probe.sh PROBE SIMULATOR_UDID OUTPUT_DIR [--mode MODE] [--bundle BUNDLE_ID] [--expect-player] [-only-testing:METHOD ...] [XCODEBUILD_ARG ...]'
if [[ $# -lt 3 ]]; then echo "$usage" >&2; exit 2; fi
probe=${1%.swift}
simulator=$2
output=$3
shift 3
[[ $probe =~ ^[A-Za-z0-9]+$ ]] || { echo "PROBE is a class name such as AlignmentProbe, not '$probe'" >&2; exit 2; }
kit=$(cd "$(dirname "$0")" && pwd)
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

bash "$kit/silence.sh" check "$simulator" || exit 2

mkdir -p "$output"
output=$(cd "$output" && pwd)
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

stamp=$(date +%Y%m%d-%H%M%S)
result="$output/result-$stamp.xcresult"
log="$output/test-$stamp.log"
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" ${extra[@]+"${extra[@]}"} test > "$log" 2>&1 || status=$?
if [[ -d "$result" ]]; then
  xcrun xcresulttool export attachments --path "$result" --output-path "$output/attachments-$stamp" > /dev/null 2>&1 || true
fi
grep -E 'Executed [0-9]+ test|error:|\*\* TEST' "$log" | sed -E 's/ \([0-9.]+\) seconds$/ seconds/' | awk '!seen[$0]++' | tail -4 || true
printf 'Artifacts: %s (result: %s, log: %s)\n' "$output" "$result" "$log"
exit "$status"
