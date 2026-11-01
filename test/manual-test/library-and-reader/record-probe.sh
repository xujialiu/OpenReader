#!/bin/bash
# Records the simulator screen around one XCTest probe run, so that something that
# lasts a few frames (a search field flashing for 0.15 s, #338) can be found afterwards.
#
#   bash test/manual-test/library-and-reader/record-probe.sh SIMULATOR_UDID OUTPUT_DIR PROBE [run-probe.sh arguments]
#   python3 -I test/manual-test/library-and-reader/field-visible.py --scan OUTPUT_DIR/screen.mp4
#
# Sets the simulator's own volume to zero (kit/silence.sh), starts one `simctl io
# recordVideo`, runs kit/run-probe.sh PROBE through the guarded runner with the same
# arguments, stops the recorder and prints where the video is. The video is variable
# rate (only changes cost frames), its first frame is 1 to 2 s after the recorder
# starts, and its clock is not the probe log's (pitfalls/verification-runs.md, #338).
# One recorder per device: a second one never writes its file. Exit status: run-probe.sh's.
set -uo pipefail
[[ $# -ge 3 ]] || { echo 'Usage: record-probe.sh SIMULATOR_UDID OUTPUT_DIR PROBE [run-probe.sh arguments]' >&2; exit 2; }
UDID=$1; OUT=$2; PROBE=$3; shift 3
KIT=$(cd "$(dirname "$0")/../kit" && pwd)
mkdir -p "$OUT"
cd "$KIT/../../.." || exit 2
bash "$KIT/silence.sh" set "$UDID" >/dev/null
xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT/screen.mp4" >/dev/null 2>&1 &
recorder=$!
date +%s.%N > "$OUT/recorder-started-at.txt"
bash "$KIT/run-probe.sh" "$PROBE" "$UDID" "$OUT" "$@"
rc=$?
kill -INT "$recorder" 2>/dev/null
wait "$recorder" 2>/dev/null
echo "run-probe rc=$rc; video: $OUT/screen.mp4"
exit $rc
