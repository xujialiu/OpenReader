#!/bin/bash
# One real XCUITest touch on the reader's page (ReaderTouchProbe/testTouchPoint),
# with the page's recorder armed first and read after, so that a result says
# whether the touch ARRIVED and what the page and the app did with it:
#
#   * the events every section document heard, with the element hit
#     (kit/probes/touch-record-arm.js and touch-record-read.js);
#   * the taps the page program posted to the app (none under the Tap Lock);
#   * the Debug Log lines written since the touch, without the periodic status
#     lines (`[reading] seek to utterance N`, `[renderer] a tap on block B did
#     nothing: the Tap Lock is on`, `[reading] tap lock …`);
#   * the harness's `say`, which prints the Reading's place and `tapLock=…`.
#
#   OPENREADER_METRO_PORT=8095 \
#     bash test/manual-test/library-and-reader/recorded-touch.sh SIMULATOR_UDID OUT_DIR X Y
#
# X and Y are points in the app's coordinate space (the space `ax.py tree`
# prints; screenshot pixels / 3 on a 3x iPhone). OUT_DIR is reused for the same
# probe from the same worktree, so the first call builds the probe and the
# others only run it (`run-probe.sh`, which takes the shared slot and checks
# the simulator's volume). Prerequisites: a Debug build with Debug Mode, its
# Metro on OPENREADER_METRO_PORT, the reader open on the text to touch, and the
# simulator's own volume at zero. It plays nothing. Screenshot right before the
# call: after an unlocked tap the page glides, and an older picture's
# coordinates are stale.
#
# Every harness write is atomic (a temp file renamed over harness.json: a plain
# write truncates the file in place while the app's 250 ms poll reads it and
# poisons it, README Pitfalls, #325/#326), and every command is followed by a
# `noop`, because a freshly mounted view runs whatever harness.json still holds
# (README Pitfalls, #336). It prints the probe's exit status last and exits with it.
set -uo pipefail
if [[ $# -ne 4 || -z ${OPENREADER_METRO_PORT:-} ]]; then
  echo 'Usage: OPENREADER_METRO_PORT=PORT recorded-touch.sh SIMULATOR_UDID OUT_DIR X Y' >&2
  exit 2
fi
udid=$1; out=$2; x=$3; y=$4
here=$(cd "$(dirname "$0")" && pwd)
kit="$here/../kit"
mkdir -p "$out"
data=$(xcrun simctl get_app_container "$udid" top.xujialiu.openreader data) || exit 2
documents="$data/Documents"
logdir="$data/Library/Application Support/debug-log"

# Highest-numbered Debug Log file: the one being written.
current_log() { ls "$logdir"/debug-log-*.txt 2>/dev/null | sort | tail -1; }
log_lines() { wc -l < "$(current_log)" | tr -d ' '; }

# harness JSON_COMMAND | harness --code-file PROBE.js
harness() {
  python3 - "$documents" "$1" "${2:-}" <<'PY'
import json, os, sys
doc, first, second = sys.argv[1:4]
command = {'do': 'js', 'code': open(second).read() + '\nreturn probe();'} if first == '--code-file' else json.loads(first)
try:
    seq = int(json.load(open(os.path.join(doc, 'harness.json')))['seq']) + 1
except Exception:
    seq = 1
temp = os.path.join(doc, '.harness-%d.json' % seq)
with open(temp, 'w') as handle:
    handle.write(json.dumps({'seq': seq, **command}))
os.rename(temp, os.path.join(doc, 'harness.json'))
PY
}

# run_probe FILE: runs a page probe and prints its `[probe]` answer (the Debug
# Log reaches the file up to 2 s late, so it polls).
run_probe() {
  local before; before=$(log_lines)
  harness --code-file "$1"
  local answer=
  for _ in $(seq 1 30); do
    sleep 0.5
    answer=$(tail -n +$((before + 1)) "$(current_log)" | grep '\[probe\]' | tail -1)
    [[ -n $answer ]] && break
  done
  sleep 0.3
  printf '%s\n' "${answer#*\[probe\] }"
}

echo "== touch at ($x, $y) $(date +%H:%M:%S)"
echo "recorder: $(run_probe "$kit/probes/touch-record-arm.js")"
sleep 3.2; harness '{"do":"noop"}'; sleep 0.8
marker=$(log_lines)
TEST_RUNNER_OPENREADER_TOUCH_X=$x TEST_RUNNER_OPENREADER_TOUCH_Y=$y TEST_RUNNER_OPENREADER_METRO_PORT=$OPENREADER_METRO_PORT \
  bash "$kit/run-probe.sh" ReaderTouchProbe "$udid" "$out" -only-testing:ReaderTouchProbe/testTouchPoint \
  > "$out/recorded-touch-$(date +%Y%m%d-%H%M%S).log" 2>&1
status=$?
latest=$(ls -t "$out"/recorded-touch-*.log | head -1)
echo "probe exit $status: $(grep -E 'Executed [0-9]+ test|READERTOUCH' "$latest" | tr -s ' \t' ' ' | tr '\n' ' ')"
grep -E 'Artifacts:' "$latest" | tail -1
echo "heard: $(run_probe "$kit/probes/touch-record-read.js")"
sleep 3.2; harness '{"do":"say"}'; sleep 4
harness '{"do":"noop"}'
echo '--- Debug Log since the touch (periodic status lines dropped)'
tail -n +$((marker + 1)) "$(current_log)" | grep -vE '\[hx\] playing=|\[probe\]|\[playback\]' | cut -c1-260
exit $status
