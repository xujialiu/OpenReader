#!/usr/bin/env bash
# What a physical iPhone's Now Playing daemon believes after Play and Pause (#66).
#
#   bash test/manual-test/lock-screen-state.sh IPHONE_UDID SEQ [SECONDS_AFTER_PAUSE]
#
# Prerequisites: the iPhone connected by cable and unlocked, OpenReader in front
# with a Document open whose Voice is ready (saved offline narration costs
# nothing), and `pymobiledevice3` on PATH or named by $PYMOBILEDEVICE3 (see
# README, "The lock screen's playing state on a physical iPhone"). SEQ is the
# first of two harness sequence numbers; each run needs new ones.
#
# Sends Play through the walkthrough harness, waits until `mediaremoted` says
# OpenReader is playing, lets two seconds play, sends Pause, and waits
# SECONDS_AFTER_PAUSE (default 5) for `isPlaying changed to false`. Exit 0 (GREEN)
# when it comes, 1 (RED) when it does not, 2 when Play itself was never seen.
# The audio is audible on the phone for about two seconds.
set -u
U=${1:?IPHONE_UDID}
SEQ=${2:?first harness seq}
HOLD=${3:-5}
PMD=${PYMOBILEDEVICE3:-pymobiledevice3}
OUT=$(mktemp -d)
LOG=$OUT/mediaremoted.log

send() {
  printf '%s' "$1" > "$OUT/harness.json"
  xcrun devicectl device copy to --device "$U" --domain-type appDataContainer \
    --domain-identifier top.xujialiu.openreader --source "$OUT/harness.json" \
    --destination Documents/harness.json >/dev/null 2>&1 || { echo "could not write the harness file"; exit 3; }
}
states() { sed -E 's/【[^】]*】/[OpenReader]/g' "$1" | grep -E "isPlaying changed|PlaybackState changed|playbackRate changed|playback state" | cut -c12-26,60-220; }

"$PMD" syslog live --udid "$U" -pn mediaremoted > "$LOG" 2>&1 &
LP=$!; disown $LP
trap 'kill $LP 2>/dev/null' EXIT
sleep 2

send "{\"seq\":$SEQ,\"do\":\"play\"}"
t0=$(date +%s)
playing=no
while (( $(date +%s) - t0 < 15 )); do
  grep -q "isPlaying changed to true.*openreader" "$LOG" && { playing=yes; break; }
  sleep 0.2
done
sleep 2
mark=$(wc -l < "$LOG" | tr -d ' ')
send "{\"seq\":$((SEQ + 1)),\"do\":\"pause\"}"
tp=$(date +%T)
t1=$(date +%s)
paused=no
while (( $(date +%s) - t1 < HOLD )); do
  tail -n +"$((mark + 1))" "$LOG" | grep -q "isPlaying changed to false.*openreader" && { paused=yes; break; }
  sleep 0.2
done
kill $LP 2>/dev/null
echo "pause written at $tp; log in $LOG"
states "$LOG"
if [ "$playing" = no ]; then echo "NO PLAY: isPlaying never turned true within 15 s"; exit 2; fi
if [ "$paused" = yes ]; then echo "GREEN: not playing after the pause"; exit 0; fi
echo "RED: still playing ${HOLD} s after the pause"; exit 1
