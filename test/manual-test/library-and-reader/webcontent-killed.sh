#!/usr/bin/env bash
# The reader's web content process ends, and the page must come back with text
# on it. On the phone iOS ended it while the app was suspended
# (JETSAM_REASON_MEMORY_LONGIDLE_EXIT) and the reader stayed blank when the app
# came back. Here `kill -9` ends it the same way WebKit sees it: the app's
# WebPageProxy reports `processDidTerminate: reason=Crash`.
#
#   bash test/manual-test/library-and-reader/webcontent-killed.sh SIMULATOR_UDID METRO_LOG [--away] [--wait S]
#
# Needs: the Debug app on SIMULATOR_UDID connected to the Metro writing
# METRO_LOG, with a Document open in the Reader and its text on the page.
# --away    leave the app for Settings before the kill and come back after it,
#           as on the phone (the app suspended while the process ends)
# --wait S  seconds between the kill (or the return) and the check, default 5
#
# Prints PASS when the page-alive probe finds epub.js on the page with a
# displayed view taller than zero, FAIL otherwise; exit 0 / 1, 2 for a setup
# problem. Plays nothing. It cannot prove what the owner sees: the probe reads
# the page's DOM, and a screenshot goes to /tmp/openreader-webcontent-killed.png.
set -u
U=${1:?SIMULATOR_UDID}
LOG=${2:?METRO_LOG}
shift 2
AWAY=0
WAIT=5
while [ $# -gt 0 ]; do
  case "$1" in
    --away) AWAY=1 ;;
    --wait) WAIT=$2; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
HERE=$(cd "$(dirname "$0")/../kit" && pwd)
PROBE="$HERE/probes/page-alive.js"

# The simulator's processes are the Mac's, children of the device's launchd_sim.
launchd=$(ps -axo pid,command | awk -v u="$U" '/launchd_sim/ && index($0, u) { print $1; exit }')
[ -n "$launchd" ] || { echo "no launchd_sim for $U (is it booted?)" >&2; exit 2; }
webcontent() { ps -axo pid,ppid,command | awk -v p="$launchd" '$2 == p && /WebContent/ { print $1 }'; }

# One probe; its answer is the first `HX PROBE {"href"` line after the send.
ask() {
  local before
  before=$(wc -l < "$LOG")
  node "$HERE/hx.cjs" "$U" '{}' --code-file "$PROBE" > /dev/null
  for _ in $(seq 1 20); do
    sleep 0.5
    local line
    line=$(tail -n +$((before + 1)) "$LOG" | grep -m1 'HX PROBE {"href"')
    if [ -n "$line" ]; then echo "${line#*HX PROBE }"; return 0; fi
  done
  echo "(no answer in 10 s)"
}
alive() { echo "$1" | grep -q '"rendition":"object"' && echo "$1" | grep -Eq '"[0-9]+:d:[1-9][0-9]*"'; }

before=$(ask)
echo "before: $before"
alive "$before" || { echo "the page has no text before the kill: open a Document first" >&2; exit 2; }
pids=$(webcontent)
[ "$(echo "$pids" | grep -c .)" = 1 ] || { echo "expected one WebContent process under launchd_sim $launchd, found: ${pids:-none}" >&2; exit 2; }

if [ $AWAY = 1 ]; then
  xcrun simctl launch "$U" com.apple.Preferences > /dev/null
  sleep 3
fi
kill -9 "$pids"
echo "killed WebContent $pids at $(date +%T)"
if [ $AWAY = 1 ]; then
  sleep 3
  xcrun simctl launch "$U" top.xujialiu.openreader > /dev/null
  echo "back in the app at $(date +%T)"
fi
sleep "$WAIT"

after=$(ask)
echo "after:  $after"
echo "WebContent now: $(webcontent | tr '\n' ' ')"
xcrun simctl io "$U" screenshot /tmp/openreader-webcontent-killed.png > /dev/null 2>&1
if alive "$after"; then echo PASS; exit 0; fi
echo "FAIL: the reader's page has no book on it after its web content process ended"
exit 1
