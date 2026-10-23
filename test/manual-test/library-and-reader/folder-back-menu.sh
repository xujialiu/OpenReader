#!/bin/bash
# Does every page behind a Folder page have its name in the back button's label
# and its long-press menu (#317)?
#
#   bash test/manual-test/library-and-reader/folder-back-menu.sh SIMULATOR_UDID [relaunch|moved] [ARTIFACT_DIR]
#
# relaunch (default) seeds Outer → Inner, Inner being browsed, and relaunches:
#          the app opens on pages iOS has not shown. PASS is the back label
#          `Outer` and the menu rows `Outer`, `Library`.
# moved    seeds Other and Outer → Inner at the root, opens Inner's actions on
#          Outer's page, taps Inner's row (the drawer stays up over the pushed
#          page), and moves Inner into Other from that drawer: the shell puts a
#          page for Other under Inner's. PASS is the stack Library → Other →
#          Inner, the back label `Other`, the menu rows `Other`, `Library`, and
#          one left-edge swipe landing on Other.
#
# Prerequisites: a Debug app installed on that simulator and its Metro running
# (it relaunches the app, and reads the harness's `navstate` from Metro's log
# at METRO_LOG, default /tmp/or317/metro.log). It overwrites the Folder
# organization (`Documents/library-folders.json`); every Document lands back at
# the Library root, none is touched. Plays nothing. The menu is held open with
# a touch down on the back button and read while held; the touch is then let go
# away from the menu and a tap there closes it, so nothing is chosen.
#
# Before the react-native-screens patch (`patches/react-native-screens+*.patch`)
# both modes FAIL: a blank menu row for the page iOS had not shown, and `Back`
# as the label in `moved`.
set -u
UDID=${1:?usage: folder-back-menu.sh SIMULATOR_UDID [relaunch|moved] [ARTIFACT_DIR]}
MODE=${2:-relaunch}
OUT=${3:-$(mktemp -d /tmp/folder-back-menu.XXXXXX)}
METRO_LOG=${METRO_LOG:-/tmp/or317/metro.log}
HERE=$(cd "$(dirname "$0")" && pwd)
AX="python3 $HERE/../kit/ax.py $UDID"
AXE=${AXE:-$(ls -t ~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe | head -1)}
APP=top.xujialiu.openreader
mkdir -p "$OUT"

title() { $AX tree | awk -F' \\| ' '/^ *Heading \|/ { split($4, f, /[ ,x]/); if (f[2] + 0 < 120) { print $2; exit } }'; }
# The bar's leading button, at x = 16 (the phone's back button; 20 for the app's own).
back_label() { $AX tree | awk -F' \\| ' '$1 ~ /^ *Button$/ && $4 ~ /^16,6[0-9] / { print $2; exit }'; }
stack() {
  node "$HERE/../kit/hx.cjs" "$UDID" '{"do":"navstate"}' >/dev/null; sleep 1.5
  grep -a "HX navstate" "$METRO_LOG" | tail -1 | python3 -c '
import json, sys
line = sys.stdin.read(); state = json.loads(line[line.index("{"):])
print(" → ".join(r["name"] + ("(" + r["params"]["id"] + ")" if r.get("params") else "") for r in state["routes"]))'
}
# The menu's rows: buttons at x = 16 wider than the 44-point back button, in the order shown; a blank row has no label and is not listed.
rows_in() { awk -F' \\| ' '$1 ~ /^ *Button$/ && $4 ~ /^16,/ { split($4, f, /[ ,x]/); if (f[3] + 0 > 100) printf "%s,", $2 }' "$1" | sed 's/,$//'; }
# Held only over the phone's back button (the caller has read its label): on a
# page without one, (38, 84) is the Library's Settings button (pitfalls/mcp.md).
menu_rows() {
  "$AXE" touch -x 38 -y 84 --down --udid "$UDID" >/dev/null; sleep 1.8
  xcrun simctl io "$UDID" screenshot "$OUT/$MODE-menu.png" >/dev/null 2>&1
  $AX tree > "$OUT/$MODE-menu-tree.txt"
  "$AXE" touch -x 300 -y 700 --up --udid "$UDID" >/dev/null; sleep 0.8
  # Letting go outside the menu usually closes it; tap outside only if it is still up.
  $AX tree > "$OUT/$MODE-after-release-tree.txt"
  [[ -n $(rows_in "$OUT/$MODE-after-release-tree.txt") ]] && { "$AXE" touch -x 300 -y 700 --down --up --udid "$UDID" >/dev/null; sleep 1; }
  rows_in "$OUT/$MODE-menu-tree.txt"
}

xcrun simctl terminate "$UDID" "$APP" 2>/dev/null; sleep 1
DATA=$(xcrun simctl get_app_container "$UDID" "$APP" data) || { echo "BLOCKED: $APP is not installed"; exit 2; }
printf '%s' '{"do":"noop","seq":1}' > "$DATA/Documents/harness.json"
if [[ $MODE == relaunch ]]; then
  printf '%s' '{"version":1,"folders":[{"id":"f-outer","name":"Outer","parent":null},{"id":"f-inner","name":"Inner","parent":"f-outer"}],"documents":{},"current":"f-inner"}' \
    > "$DATA/Documents/library-folders.json"
  WANT_STACK='Library → Folder(f-outer) → Folder(f-inner)' WANT_LABEL=Outer WANT_ROWS=Outer,Library
else
  printf '%s' '{"version":1,"folders":[{"id":"f-other","name":"Other","parent":null},{"id":"f-outer","name":"Outer","parent":null},{"id":"f-inner","name":"Inner","parent":"f-outer"}],"documents":{},"current":null}' \
    > "$DATA/Documents/library-folders.json"
  WANT_STACK='Library → Folder(f-other) → Folder(f-inner)' WANT_LABEL=Other WANT_ROWS=Other,Library
fi
xcrun simctl launch "$UDID" "$APP" >/dev/null; sleep 8
if [[ $MODE == moved ]]; then
  for step in "Folder, Outer, 1 folder" "Actions for folder Inner" "Folder, Inner, Empty" "Move to…" "Back to Library" "Other" "Move"; do
    $AX touch "$step" >/dev/null || { echo "BLOCKED: no \"$step\" to touch"; exit 2; }
    sleep 1.2
  done
  sleep 1.3
fi
[[ $(title) == Inner ]] || { echo "BLOCKED: not on Inner's page (title: $(title))"; exit 2; }
got_label=$(back_label)
[[ -n $got_label ]] || { echo "BLOCKED: Inner's page shows no back button"; exit 2; }
got_stack=$(stack) got_rows=$(menu_rows)
verdict=PASS
[[ $got_stack == "$WANT_STACK" && $got_label == "$WANT_LABEL" && $got_rows == "$WANT_ROWS" ]] || verdict=FAIL
line="stack $got_stack; label ${got_label:-<none>}; menu ${got_rows:-<none>}"
if [[ $MODE == moved ]]; then
  "$AXE" drag --start-x 2 --start-y 437 --end-x 300 --end-y 437 --duration 0.4 --steps 30 --udid "$UDID" >/dev/null; sleep 1.5
  after=$(title); line="$line; swipe → ${after:-<none>}"
  [[ $after == Other ]] || verdict=FAIL
fi
echo "$verdict $MODE: $line (artifacts $OUT)"
[[ $verdict == PASS ]]
