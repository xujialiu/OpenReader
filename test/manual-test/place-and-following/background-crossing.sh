#!/bin/bash
# A Reading crosses into the next section with the app away from the screen
# (#112; background-crossing.md). GREEN when the section after that one is
# rendered within WAIT s of the crossing, with the app still away; RED when it is
# not, or only once the app came back; VOID when the setup did not hold.
#
#   bash test/manual-test/place-and-following/background-crossing.sh SIMULATOR_UDID METRO_PORT DOCUMENT_ID
#
# Env: AWAY (s away from the screen, default 45), WAIT (s, default 15), OFFSET
# (Utterances before the crossing to start from, default 64: far enough that the
# page has unloaded the next section's view), FRONT=1 (come back after AWAY and
# stay 10 s, as the owner did in #112). Needs the book in the Library, a
# Provider that answers quickly (fake-kokoro.cjs with
# OPENREADER_FAKE_TTS_SECONDS=0.2), and the simulator's volume at zero, which is
# checked before the play.
set -u
UDID=${1:?SIMULATOR_UDID}
PORT=${2:?METRO_PORT}
DOC=${3:?DOCUMENT_ID}
HERE=$(cd "$(dirname "$0")" && pwd)
KIT="$HERE/../kit"
DATA=$(xcrun simctl get_app_container "$UDID" top.xujialiu.openreader data)
DLOG="$DATA/Library/Application Support/debug-log"
OUT=$(mktemp -d /tmp/openreader-background-crossing-XXXX)
WAIT=${WAIT:-15}
hx() { node "$KIT/hx.cjs" "$UDID" "$1" >/dev/null; sleep "${2:-1}"; }
# The Reader's status line as the Debug Log last has it (appended within 2 s).
last() { sleep 2.5; cat "$DLOG"/debug-log-*.txt | grep '\[hx\] playing=' | tail -1 | cut -c1-170; }
front() { xcrun simctl launch "$UDID" top.xujialiu.openreader -RCT_jsLocation "localhost:$PORT" >/dev/null; }

front
sleep 2
hx '{"do":"pause"}'
# The Reader open first: a seek sent while the Library shows is dropped, and the
# last status line in the file would be a stale one from before.
SINCE=$(date '+%Y-%m-%d %H:%M:%S')
hx "{\"do\":\"open\",\"id\":\"$DOC\"}" 8
FRESH=$(last)
[[ "$FRESH" > "$SINCE" ]] || { echo "VOID: no status line since the Reader was opened; is it open?"; exit 3; }
# The place on the last Utterance the Reader holds, which is in the last section
# rendered (a Contents row while paused moves only the page, #52, so it cannot
# set the place). Reopened, the page holds that section and the next one.
NOW=$(echo "$FRESH" | grep -o 'known=[0-9]*' | cut -d= -f2)
hx "{\"do\":\"seek\",\"utterance\":$((NOW - 1))}" 1
hx '{"do":"shut"}' 3
hx "{\"do\":\"open\",\"id\":\"$DOC\"}" 8
OPENED=$(last)
echo "opened: $OPENED"
P=$(echo "$OPENED" | grep -o 'utterance=[0-9]*' | cut -d= -f2)
S=$(echo "$OPENED" | grep -o 'section=[0-9]*' | cut -d= -f2)
ENTER=$((S + 1))
START=$((P + 1 - ${OFFSET:-64}))
hx "{\"do\":\"seek\",\"utterance\":$START}" 1
BEFORE=$(last)
echo "before play: $BEFORE"
echo "$BEFORE" | grep -q "section=$S rendered=$ENTER/" || { echo "VOID: not in section $S with only $ENTER rendered ahead"; exit 3; }

MARK=$(date '+%Y-%m-%d %H:%M:%S')
bash "$KIT/silence.sh" check "$UDID" >/dev/null && hx '{"do":"play"}' 0 || { echo "VOID: the simulator's volume is not zero"; exit 3; }
xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null   # away from the screen
echo "played and left at $(date +%T); crossing into $ENTER from utterance $START"
# The verdict comes from the Debug Log's own stamps afterwards: away from the
# screen the app's timers barely run, and its lines reach the file late.
sleep "${AWAY:-45}"
if [ "${FRONT:-0}" = 1 ]; then
  front
  echo "back at $(date +%T)"
  sleep 10
fi
hx '{"do":"pause"}' 2
front   # leaving the background appends what was waiting
sleep 3
awk -v m="$MARK" 'substr($0,1,19) >= m' "$DLOG"/debug-log-*.txt > "$OUT/window.txt"
grep '\[renderer\]\|\[app\]' "$OUT/window.txt" | grep -v 'display "epubcfi' | cut -c12-230
echo "the window's lines: $OUT/window.txt"
python3 - "$ENTER" "$WAIT" "$OUT/window.txt" <<'PY'
import datetime as dt, re, sys
enter, wait, path = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
stamp = lambda line: dt.datetime.strptime(line[:23], '%Y-%m-%d %H:%M:%S.%f')
state, entered, rendered, where, then = 'active', None, None, None, None
for line in open(path, encoding='utf-8'):
    found = re.search(r'\[app\] app (\w+)', line)
    if found: state = found.group(1)
    if entered is None and f'the voice is in section {enter}' in line:
        entered, where = stamp(line), state
    if rendered is None and (f'renderAhead: section {enter + 1} done' in line or f'view {enter + 1} displayed in' in line):
        rendered, then = stamp(line), state
if entered is None:
    print(f'VOID: the reading never entered section {enter}'); sys.exit(3)
if rendered is None:
    print(f'RED: entered {enter} at {entered:%H:%M:%S} ({where}), {enter + 1} never rendered'); sys.exit(1)
gap = (rendered - entered).total_seconds()
verdict = 'RED' if gap > wait or then != where else 'GREEN'
print(f'{verdict}: entered {enter} at {entered:%H:%M:%S} ({where}), {enter + 1} rendered {gap:.1f} s later ({then})')
sys.exit(1 if verdict == 'RED' else 0)
PY
