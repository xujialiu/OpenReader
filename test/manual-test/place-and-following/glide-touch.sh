#!/bin/bash
# Real drag during a live glide (#71, GlideTouchProbe.swift). Same shape as
# kit/run-probe.sh: a new output directory generates the project, an existing
# one reuses it. Presses Play, so checks the simulator's own volume first.
# Run `node glide-touch.cjs SIMULATOR_UDID METRO_LOG arm` before this, and
# `... analyse` after, to read what the drag actually did.
#
# -only-testing:testName picks a method of GlideTouchProbe (default: its one
# method, testDragDuringLiveGlideStopsThenRecovers). DRAG_DELAY_MS, a whole
# number of milliseconds, is written to /tmp/openreader-glide-touch-params.txt,
# which the probe reads because `xcodebuild … test` does not pass this
# script's environment on (README Pitfalls). Without it the file is left as it
# is, so a value written there by hand still applies; the probe's own default
# is 2000.
set -euo pipefail
usage='Usage: glide-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR [-only-testing:testName] [DRAG_DELAY_MS]'
if [[ $# -lt 2 ]]; then echo "$usage" >&2; exit 2; fi
simulator=$1
output=$2
shift 2
only_testing=()
delay_ms=
for arg in "$@"; do
  case "$arg" in
    -only-testing:*) only_testing+=("-only-testing:LockScreenProbe/GlideTouchProbe/${arg#-only-testing:}") ;;
    *[!0-9]* | '') echo "$usage" >&2; exit 2 ;;
    *) delay_ms=$arg ;;
  esac
done
if [[ ${#only_testing[@]} -eq 0 ]]; then
  only_testing=(-only-testing:LockScreenProbe/GlideTouchProbe/testDragDuringLiveGlideStopsThenRecovers)
fi
source_dir=$(cd "$(dirname "$0")" && pwd)
bash "$source_dir/../kit/silence.sh" check "$simulator"
if [[ -n "$delay_ms" ]]; then
  printf 'DRAG_DELAY_MS=%s\n' "$delay_ms" > /tmp/openreader-glide-touch-params.txt
fi
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ ! -e "$output/ManualTests.xcodeproj" ]]; then
  ruby "$source_dir/../kit/project.rb" "$output" top.xujialiu.openreader NO inspect GlideTouchProbe.swift
fi
result="$output/result-$(date +%s).xcresult"
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$result" \
  "${only_testing[@]}" \
  test > "$output/test-$(date +%s).log" 2>&1 || status=$?
if [[ -d "$result" ]]; then
  xcrun xcresulttool export attachments --path "$result" --output-path "$output/attachments-$(basename "$result" .xcresult)"
fi
printf 'Artifacts: %s (result: %s)\n' "$output" "$result"
exit "$status"
