#!/bin/bash
# #338: a flick whose momentum carries the Library list past its top must not
# show "Search Library" (design 0090: only a pull at the top previews it).
#
#   bash test/manual-test/library-and-reader/flick-to-top.sh SIMULATOR_UDID OUTPUT_DIR [RUNS]
#
# Prerequisites: an iPhone 17 simulator (1206x2622 screenshots), light or dark
# theme, the app on a Library or Folder page that is at its top with search
# CLOSED (a field showing in the first screenshot makes every run INVALID, and
# pressing a bar button can leave it up: relaunch first), and at least 12 rows
# (library-search.md stages 16 Folders without Documents).
# Each run scrolls the list away from its top with two 0.8 s drags (shorter AXe
# drags can press the row under them, pitfalls/mcp.md), records the
# screen, flicks the finger down 400 pt in 0.12 s from mid-list (the finger lifts
# before the top; momentum reaches it), stops recording and scores every frame
# with field-visible.py, and measures the bounce with bounce.py. Exit 0: no run showed the field. 1: some run showed it.
# 2: some run was invalid (the list did not leave its top or did not end there).
# About 12 s a run. Uses the AXe bundled with mobilebuildmcp, as ax.py does.
set -uo pipefail
UDID=$1; OUT=$2; RUNS=${3:-3}
AXE=${AXE:-$(ls -t ~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe 2>/dev/null | head -1)}
[[ -x $AXE ]] || { echo 'No AXe: set AXE or run mobilebuildmcp once (pitfalls/mcp.md)' >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
xcrun simctl io "$UDID" screenshot "$OUT/top.png" >/dev/null 2>&1
verdict=0
for i in $(seq 1 "$RUNS"); do
  for _ in 1 2; do
    "$AXE" swipe --start-x 201 --start-y 620 --end-x 201 --end-y 380 --duration 0.8 --udid "$UDID" >/dev/null
    sleep 1.5
  done
  xcrun simctl io "$UDID" screenshot "$OUT/run$i-before.png" >/dev/null 2>&1
  xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT/run$i.mp4" >/dev/null 2>&1 &
  recorder=$!
  sleep 1.0
  "$AXE" swipe --start-x 201 --start-y 300 --end-x 201 --end-y 700 --duration 0.12 --udid "$UDID" >/dev/null
  sleep 2.5
  kill -INT $recorder; wait $recorder 2>/dev/null
  xcrun simctl io "$UDID" screenshot "$OUT/run$i-after.png" >/dev/null 2>&1
  python3 -I "$HERE/field-visible.py" "$OUT/run$i.mp4" "$OUT/run$i-before.png" "$OUT/run$i-after.png" "$OUT/top.png" > "$OUT/run$i.txt"
  rc=$?
  # How far the bounce carried the list past its top: the fix keeps UIKit's own bounce (bounce.py).
  python3 -I "$HERE/bounce.py" "$OUT/run$i.mp4" "$OUT/top.png" > "$OUT/run$i-bounce.txt" 2>&1
  peak=$(sed -E -n 's/.*peak_overshoot_pt=([0-9.-]+).*/bounce \1 pt/p' "$OUT/run$i-bounce.txt")
  case $rc in
    0) echo "run $i: hidden  $(tail -1 "$OUT/run$i.txt") ${peak:-bounce not measured}" ;;
    1) echo "run $i: SHOWN   $(tail -1 "$OUT/run$i.txt") ${peak:-bounce not measured}"; [[ $verdict -eq 0 ]] && verdict=1 ;;
    *) echo "run $i: INVALID $(tail -1 "$OUT/run$i.txt")"; verdict=2 ;;
  esac
done
exit $verdict
