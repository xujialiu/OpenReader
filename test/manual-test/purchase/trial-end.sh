#!/bin/bash
# The end of the Trial reached mid-use (#148): a Reading that is playing when the
# Trial ends keeps playing, and the next Play after a Pause meets the gate.
#
#   bash test/manual-test/purchase/trial-end.sh SIMULATOR_UDID [SECONDS] [--ask]
#
# Needs the reader open on a Document whose Voice is ready, paused, in a Debug
# build (`kit/hx.cjs` writes the harness command; a Provider the Reading can
# reach, or saved audio, so the clips are there). SECONDS (default 3) is how long
# the Trial lasts from the moment the app reads the command; 2 is the least this
# setup allows (see purchase/README.md, "Measured").
#
# What it does, in order:
#   1. sets and checks the simulator's own volume (`silence.sh`), and finds the
#      player's Play button once, so nothing slow sits between command and press;
#   2. `{"do":"store","state":"trial","seconds":SECONDS}`, then a real touch pair
#      (`axe touch`, no `describe-ui` first) on Play about a second later;
#   3. waits until 4 s after the Trial's end, then a real touch on the same point,
#      which reads Pause while it plays, and `{"do":"pause"}` through the harness
#      if the Reading still plays 2 s later;
#   4. prints `TRIALEND` lines from the Debug Log: the Trial's end (`endsAt`, from
#      the app's own `HX store` line), the press, every cue after the end, the
#      pause, and whether any `play while read-aloud is locked` line appeared
#      (none may, before the end);
#   --ask  then touches Play once more: the Trial has ended, so the ended alert
#      must come up. Its words are printed, and Not Now answers it.
#
# Plays for about SECONDS + 5 s, silenced; it stops the Reading however it ends.
# What it cannot prove: what is heard, or that a press landed inside the Trial
# when SECONDS is 1 (the press arrives about 1.4 s after the command is written).
set -euo pipefail
[[ $# -ge 1 ]] || { echo 'Usage: trial-end.sh SIMULATOR_UDID [SECONDS] [--ask]' >&2; exit 2; }
udid=$1; seconds=${2:-3}; ask=no
[[ ${3:-} == --ask || ${2:-} == --ask ]] && ask=yes
[[ $seconds == --ask ]] && seconds=3
[[ $seconds =~ ^[0-9]+$ ]] || { echo 'SECONDS must be a whole number' >&2; exit 2; }
kit=$(cd "$(dirname "$0")/../kit" && pwd)
ax() { python3 "$kit/ax.py" "$udid" "$@"; }
container=$(xcrun simctl get_app_container "$udid" top.xujialiu.openreader data)
debug_log() { cat "$container/Library/Application Support/debug-log/"debug-log-*.txt 2>/dev/null || true; }
axe=$(python3 - "$kit" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
import ax
print(ax.axe_binary())
PY
)
silent() { bash "$kit/silence.sh" set "$udid" >/dev/null && bash "$kit/silence.sh" check "$udid"; }
touch_at() { "$axe" touch -x "$1" -y "$2" --down --up --delay 0.2 --udid "$udid" >/dev/null; }

silent
read -r px py < <(ax find Play)
echo "TRIALEND Play is at ($px, $py); SECONDS=$seconds"
mark=$(debug_log | wc -l | tr -d ' ')

silent && node "$kit/hx.cjs" "$udid" "{\"do\":\"store\",\"state\":\"trial\",\"seconds\":$seconds,\"outcome\":\"purchased\"}" >/dev/null
echo "TRIALEND command written $(date +%H:%M:%S.%N | cut -c1-12)"
sleep 0.3
silent && touch_at "$px" "$py"
echo "TRIALEND Play pressed (touch returned) $(date +%H:%M:%S.%N | cut -c1-12)"

# The app's own answer names the end: `HX store … access={"kind":"trial","endsAt":MS}`.
ends=
for _ in $(seq 1 20); do
  ends=$(debug_log | tail -n +$((mark + 1)) | grep -o '"endsAt":[0-9]*' | tail -1 | cut -d: -f2 || true)
  [[ -n $ends ]] && break
  sleep 0.25
done
[[ -n $ends ]] || { echo 'TRIALEND no HX store line with endsAt: is the app running a Debug build with the harness?' >&2; node "$kit/hx.cjs" "$udid" '{"do":"pause"}' >/dev/null; exit 1; }
now_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
wait_s=$(python3 -c "print(max(0.0, ($ends + 4000 - $now_ms) / 1000.0))")
sleep "$wait_s"
touch_at "$px" "$py"
echo "TRIALEND Pause pressed (touch returned) $(date +%H:%M:%S.%N | cut -c1-12)"
sleep 2
if debug_log | tail -n +$((mark + 1)) | grep '\[hx\] playing=' | tail -1 | grep -q 'playing=true'; then
  echo 'TRIALEND still playing: the harness pauses it'
  node "$kit/hx.cjs" "$udid" '{"do":"pause"}' >/dev/null
  sleep 1.5
fi

end_local=$(python3 -c "import datetime; print(datetime.datetime.fromtimestamp($ends/1000).strftime('%H:%M:%S.%f')[:-3])")
echo "TRIALEND the Trial ended at $end_local (endsAt $ends)"
since=$(debug_log | tail -n +$((mark + 1)))
echo "$since" | grep -E '\[reading\] (play|pause) at|play while read-aloud is locked' | sed 's/^/TRIALEND   /' | cut -c1-200
echo "TRIALEND cues (utterance changes while playing), with the end at $end_local:"
echo "$since" | grep '\[hx\] playing=true' | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^utterance=/) print $2, $i }' | uniq -f1 | sed 's/^/TRIALEND   /'
asks=$(echo "$since" | grep -c 'play while read-aloud is locked' || true)
echo "TRIALEND 'play while read-aloud is locked' lines: $asks (0 expected: the press was inside the Trial)"

if [[ $ask == yes ]]; then
  silent && ax touch Play
  sleep 1
  ax alert || true
  ax alert-touch "Not Now" || true
  sleep 3.5   # the Debug Log lands on disk about 2 s after the event
  echo "TRIALEND the ended alert was answered Not Now; last reading lines:"
  debug_log | tail -n +$((mark + 1)) | grep -E 'play while read-aloud is locked|read-aloud still locked' | tail -2 | sed 's/^/TRIALEND   /' | cut -c1-200
fi
