#!/bin/bash
# Read any page's title, back-button label, long-press back menu and nav state
# (#317). The reads folder-back-menu.sh is built from, not tied to its Folder
# seeding: for walking other stacks (Settings, Acknowledgements, the Reader)
# and asserting who the back button names at each level.
#
#   source test/manual-test/library-and-reader/back-menu-read.sh SIMULATOR_UDID
#   title            # the bar's heading, left-aligned
#   back_label       # the phone back button's label (x = 16); '' when absent
#   menu_rows DIR PREFIX   # hold the back button down 1.8 s, photograph and
#                          # tree-read the menu into DIR/PREFIX-menu.{png,txt},
#                          # release away from it and tap there to close it;
#                          # prints the row labels, top first, comma-joined
#   navstate         # the harness's route stack from Metro's log, ` → `-joined
#
# Prerequisites: a Debug app on that simulator and its Metro running (navstate
# reads METRO_LOG, default /tmp/or317/metro.log). menu_rows holds the back
# button at (38, 84) and REFUSES on a page without one — with no back button
# the hold presses whatever sits there (the Library's Settings button) and the
# dismiss tap can reach a row that opens Safari (pitfalls/mcp.md). It plays
# nothing.
#
# Cannot prove: that a menu row navigates (the release tap is away from the
# menu); that the label is tappable; how the screen animates. Pair with a real
# back tap or swipe and read the title after.
set -u
UD=${1:?usage: source back-menu-read.sh SIMULATOR_UDID}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/../kit" && pwd)
AXE=${AXE:-$(ls -t ~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe | head -1)}
METRO_LOG=${METRO_LOG:-/tmp/or317/metro.log}

title() { python3 "$HERE/ax.py" "$UD" tree | awk -F' \\| ' '/^ *Heading \|/ { split($4, f, /[ ,x]/); if (f[2] + 0 < 120) { print $2; exit } }'; }
back_label() { python3 "$HERE/ax.py" "$UD" tree | awk -F' \\| ' '$1 ~ /^ *Button$/ && $4 ~ /^16,6[0-9] / { print $2; exit }'; }
navstate() {
  node "$HERE/hx.cjs" "$UD" '{"do":"navstate"}' >/dev/null; sleep 1.5
  grep -a "HX navstate" "$METRO_LOG" | tail -1 | python3 -c '
import json, sys
line = sys.stdin.read(); state = json.loads(line[line.index("{"):])
def name(r):
    params = r.get("params") or {}
    detail = next(iter(params.values()), None) if params else None
    return r["name"] + ("(" + str(detail) + ")" if detail is not None else "")
print(" → ".join(name(r) for r in state["routes"]))'
}
menu_rows() {
  OUT=$1; PREFIX=$2; mkdir -p "$OUT"
  [[ -n $(back_label) ]] || { echo "menu_rows: no back button at (38, 84); refusing" >&2; return 2; }
  "$AXE" touch -x 38 -y 84 --down --udid "$UD" >/dev/null; sleep 1.8
  xcrun simctl io "$UD" screenshot "$OUT/$PREFIX-menu.png" >/dev/null 2>&1
  python3 "$HERE/ax.py" "$UD" tree > "$OUT/$PREFIX-menu-tree.txt"
  "$AXE" touch -x 300 -y 700 --up --udid "$UD" >/dev/null; sleep 0.8
  # The touch-up outside an open menu dismisses it without choosing. Only when
  # the menu is still up does it need a dismiss tap — a blind one lands on
  # whatever row sits at (300, 700) now that the menu is gone.
  still_open=$(awk -F' \\| ' '$1 ~ /^ *Button$/ && $4 ~ /^16,/ { split($4, f, /[ ,x]/); if (f[3] + 0 > 100) print "x" }' "$OUT/$PREFIX-menu-tree.txt")
  if [[ -n $still_open ]]; then
    "$AXE" touch -x 300 -y 700 --down --up --udid "$UD" >/dev/null; sleep 1
  fi
  awk -F' \\| ' '$1 ~ /^ *Button$/ && $4 ~ /^16,/ { split($4, f, /[ ,x]/); if (f[3] + 0 > 100) printf "%s,", $2 }' "$OUT/$PREFIX-menu-tree.txt" | sed 's/,$//'
}
