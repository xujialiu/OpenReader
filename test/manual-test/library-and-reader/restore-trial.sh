#!/bin/bash
# One "Close puts the list back where it was" trial with real AXe touches (#339), outside XCTest.
#
#   bash test/manual-test/library-and-reader/restore-trial.sh SIMULATOR_UDID LABEL SWIPES [TYPED]
#
# It presses `…` (the Library actions drawer), scrolls the list BEHIND the open half sheet with SWIPES
# swipes (the sheet lets touches through to the page up to its half detent), chooses Search, optionally
# types TYPED, presses Close, and prints the list's offset at each step. The offset is read from the row
# `Folder, Search Folder, 1 document` (ROW=… names another row), whose y is 128 at the top while the
# field is closed and 62 more while it is open. END_Y=300 makes the swipe short (about 110 pt before its
# coast), END_Y=140 long enough to reach the bottom.
#
# What it shows (iPhone 17, iOS 27.0, 1.0.4 (27)-beta3-debug, 2026-11-01): `…` itself sends the list to
# its top before the drawer is up (the line "drawer open"), so only a position made AFTER that press, as
# here, can be restored: 352 came back as 352, and the very bottom (392) as 358, 34 pt short, which is the
# height of the home-indicator inset (inferred: React Native's `scrollTo` clamps to its explicit inset,
# which has no bottom inset, where a finger can go 34 pt further). The probe's flow, scroll first and
# then `…`, cannot be tested by this script: that is `testCancelRestoresNonzeroBrowse`. Needs the staged
# Library of library-search.md (`stage-search-fixtures.sh` and the Folder) and the app on its root.
set -uo pipefail
[[ $# -ge 3 ]] || { echo 'Usage: restore-trial.sh SIMULATOR_UDID LABEL SWIPES [TYPED]' >&2; exit 2; }
U=$1; label=$2; swipes=$3; typed=${4:-}
ROW=${ROW:-"Folder, Search Folder, 1 document"}
AXE=${AXE:-$(ls -t "$HOME"/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe 2>/dev/null | head -1)}
[[ -x $AXE ]] || { echo 'No AXe found; set AXE=/path/to/axe' >&2; exit 2; }
cd "$(dirname "$0")/../../.."
y() { timeout 60 python3 test/manual-test/kit/ax.py "$U" tree 2>&1 | grep -F "$ROW" | grep -v "Actions for" | head -1 | sed -E 's/.*\| (-?[0-9.]+),(-?[0-9.]+) .*/\2/'; }
echo "== $label (swipes=$swipes typed='$typed') $(date +%T)"
echo "closed, before ...: row y=$(y)"
timeout 60 python3 test/manual-test/kit/ax.py "$U" touch "Library actions" >/dev/null 2>&1; sleep 2
echo "drawer open (after the ... press): row y=$(y)"
for _ in $(seq 1 "$swipes"); do
  "$AXE" swipe --start-x 200 --start-y 410 --end-x 200 --end-y "${END_Y:-140}" --duration 0.8 --udid "$U" >/dev/null 2>&1; sleep 1.2
done
sleep 1
before=$(y)
echo "scrolled behind the drawer, before Search: row y=$before  (offset $((128 - ${before%.*})))"
timeout 60 python3 test/manual-test/kit/ax.py "$U" touch "Search" >/dev/null 2>&1; sleep 2.5
echo "search open, empty: row y=$(y)"
if [[ -n $typed ]]; then timeout 30 "$AXE" type "$typed" --udid "$U" >/dev/null 2>&1; sleep 1.5; fi
timeout 60 python3 test/manual-test/kit/ax.py "$U" touch "Close" >/dev/null 2>&1; sleep 2.5
after=$(y)
echo "after Close: row y=$after  (offset $((128 - ${after%.*}))), delta vs before = $((${after%.*} - ${before%.*})) pt"
