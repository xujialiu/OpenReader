#!/bin/bash
# Does a swipe in from the left edge go up a Folder, as the top-left arrow does (#317)?
#
#   bash test/manual-test/library-and-reader/folder-edge-swipe.sh SIMULATOR_UDID [folder|settings]
#
# folder   (default) seeds `library-folders.json` with Outer → Inner and Inner
#          being browsed, relaunches, swipes in from the left edge twice, and
#          reads the bar's title after each: PASS is Inner → Outer → Library.
# settings the control: opens Settings from the Library root and swipes once;
#          PASS is Settings → Library. It proves the swipe reaches UIKit as the
#          phone's own back gesture, so a folder FAIL is the app, not AXe.
#
# Prerequisites: a Debug app installed on that simulator and its Metro running
# (the launch needs the bundle). It overwrites the app's Folder organization
# (`Documents/library-folders.json`); the Documents themselves are untouched,
# and every Document lands back at the Library root. Plays nothing.
#
# It cannot prove how the swipe looks while the finger is down (a native pop
# drags the screen; that needs a recording), only where it ends.
set -u
UDID=${1:?usage: folder-edge-swipe.sh SIMULATOR_UDID [folder|settings]}
MODE=${2:-folder}
HERE=$(cd "$(dirname "$0")" && pwd)
AX="python3 $HERE/../kit/ax.py $UDID"
AXE=${AXE:-$(ls -t ~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe | head -1)}
APP=top.xujialiu.openreader

# The bar's title is the one Heading in the navigation bar: the top 120 points.
title() { $AX tree | awk -F' \\| ' '/^ *Heading \|/ { split($4, f, /[ ,x]/); if (f[2] + 0 < 120) { print $2; exit } }'; }
# Wait up to $1 seconds for the title to read $2.
wait_title() {
  local deadline=$((SECONDS + $1)) now
  while ((SECONDS < deadline)); do
    now=$(title)
    [[ $now == "$2" ]] && { echo "$now"; return 0; }
    sleep 0.5
  done
  echo "${now:-<none>}"; return 1
}
# `axe drag`, which sends every touch move: on iOS 26.5 (2026-10-23) neither
# AXe's `gesture swipe-from-left-edge` preset nor `axe swipe` from x = 0 or 1
# popped Settings, and this did, from x = 0, 2 and 5. --duration is seconds.
swipe() {
  "$AXE" drag --start-x 2 --start-y 437 --end-x 300 --end-y 437 --duration 0.4 --steps 30 --udid "$UDID" >/dev/null
  sleep 1.2 # the pop animation, 0.35 s, and the header's settle
}

xcrun simctl terminate "$UDID" "$APP" 2>/dev/null
DATA=$(xcrun simctl get_app_container "$UDID" "$APP" data) || { echo "BLOCKED: $APP is not installed"; exit 2; }
if [[ $MODE == folder ]]; then
  printf '%s' '{"version":1,"folders":[{"id":"folder-edge-outer","name":"Outer","parent":null},{"id":"folder-edge-inner","name":"Inner","parent":"folder-edge-outer"}],"documents":{},"current":"folder-edge-inner"}' \
    > "$DATA/Documents/library-folders.json"
  START=Inner STEPS=(Outer Library)
else
  printf '%s' '{"version":1,"folders":[],"documents":{},"current":null}' > "$DATA/Documents/library-folders.json"
  START=Library STEPS=(Library)
fi
xcrun simctl launch "$UDID" "$APP" >/dev/null
seen=$(wait_title 60 "$START") || { echo "BLOCKED: the app did not open on $START (title: $seen)"; exit 2; }
if [[ $MODE == settings ]]; then
  $AX touch Settings >/dev/null
  seen=$(wait_title 10 Settings) || { echo "BLOCKED: Settings did not open (title: $seen)"; exit 2; }
  START=Settings
fi
path=$START verdict=PASS
for want in "${STEPS[@]}"; do
  swipe
  got=$(title); got=${got:-<none>}
  path="$path → $got"
  [[ $got == "$want" ]] || verdict=FAIL
done
expected=$START; for want in "${STEPS[@]}"; do expected="$expected → $want"; done
echo "$verdict $MODE: $path (expected $expected)"
[[ $verdict == PASS ]]
