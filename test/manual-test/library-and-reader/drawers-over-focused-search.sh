#!/bin/bash
# Real touches on the drawers opened from a FOCUSED search field (#339, 1.0.4 (25)-beta5), outside XCTest's taps.
#
#   bash test/manual-test/library-and-reader/drawers-over-focused-search.sh SIMULATOR_UDID OUTPUT_DIR
#
# It runs `LibrarySearchProbe.testStageFocusedSearchAndWait` under the guarded runner in the background of this one foreground
# command (search open, "Scroll Diag 1" typed, the cursor in the field, the keyboard up) and drives the page with AXe touch pairs
# (`ax.py touch`), printing after each step the field's value, whether the keyboard's keys are in the tree, the drawer's grabber
# and the headings, with a screenshot per step in OUTPUT_DIR:
#   S1 a result's `…`, then ONE touch on `Move to…`    -> the Move page ("Move to…") opens
#   S2 the field touched (cursor back), a result's `…`, ONE touch on `Select` -> `1 selected`, search kept, then Cancel
#   S3 the same, ONE touch on `Delete`                 -> the confirmation `Delete this book?` (Cancel is touched)
#   S4 the bar's `…`, ONE touch on `Create folder`     -> the `Create folder` alert (Cancel is touched)
#   S5 the bar's `…`, ONE touch on `Select`            -> `0 selected`, search kept, then Cancel
#   S6 a drawer closed without choosing                -> search open, query kept, keyboard down
#   S7 `…` > Search while search is open               -> keyboard up again (the cursor is back)
#   S8 Close                                           -> the field is gone, which ends the staging test
# Before 1.0.4 (25)-beta5 the keyboard stayed up in S1, S2, S3, S4 and S5, the drawers rose under it, and `Move to…` took two
# touches' worth of nothing: the first press on a row only put the keyboard away.
#
# Needs the staged Library (stage-search-fixtures.sh and the Folder), the app on its root with its Debug bundle, the volume at zero
# (kit/silence.sh) and AXe (found under ~/.npm/_npx, or AXE=...). AXe's touches are what it uses: if AXe's keyboard is dead, as
# it was late in the beta4 run, the typing is XCTest's. It cannot show a press by a finger, only the touch events AXe sends.
set -uo pipefail
[[ $# -eq 2 ]] || { echo 'Usage: drawers-over-focused-search.sh SIMULATOR_UDID OUTPUT_DIR' >&2; exit 2; }
U=$1; O=$2
AXE=${AXE:-$(ls -t "$HOME"/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe 2>/dev/null | head -1)}
[[ -x $AXE ]] || { echo 'No AXe found; set AXE=/path/to/axe' >&2; exit 2; }
cd "$(dirname "$0")/../../.."
mkdir -p "$O"
ax() { timeout 40 python3 test/manual-test/kit/ax.py "$U" "$@" 2>&1; }
shot() { xcrun simctl io "$U" screenshot "$O/$1.png" >/dev/null 2>&1; }
drag_away() { "$AXE" drag --start-x 201 --start-y 445 --end-x 201 --end-y 860 --duration 0.8 --udid "$U" >/dev/null 2>&1; sleep 2; }
state() {
  local t field value kb grab head
  t=$(ax tree)
  field=$(grep -c 'TextField | Search Library' <<<"$t")
  value=$(grep -m1 'TextField | Search Library' <<<"$t" | sed -E 's/.*TextField \| Search Library \| (.*) \| [0-9]+,[0-9]+ .*/\1/')
  kb=$(grep -c 'Button | q ' <<<"$t")
  grab=$(grep -c 'Sheet Grabber' <<<"$t")
  head=$(grep -E 'Heading \| ' <<<"$t" | sed -E 's/.*Heading \| (.*) \| .*/\1/' | sed 's/ *$//' | tr '\n' ',' | sed 's/,$//')
  echo "   -> field=$field value='${value:-}' keyboard keys=$kb drawer grabber=$grab headings=[$head]"
}
(
  OPENREADER_PROBE_TEST_SECONDS=500 bash test/manual-test/kit/run-probe.sh LibrarySearchProbe "$U" "$O/probe" \
    -only-testing:LibrarySearchProbe/testStageFocusedSearchAndWait -collect-test-diagnostics never > "$O/probe-run.out" 2>&1 &
  probe=$!
  echo "waiting for the staged state"
  for _ in $(seq 1 90); do t=$(ax tree); grep -q "TextField | Search Library | Scroll Diag 1 " <<<"$t" && grep -q 'Button | q ' <<<"$t" && break; sleep 3; done
  echo "S0 staged: search open, query typed, cursor in the field"; state; shot s0-staged
  echo "S1 result …, then ONE touch on Move to…"
  ax touch "Actions for Scroll Diag 12 of 12" >/dev/null; sleep 2.5; state; shot s1-result-drawer
  ax touch "Move to…" >/dev/null; sleep 2.5; state; shot s1-after-one-touch-on-move
  drag_away; state
  echo "S2 the field touched, result …, ONE touch on Select"
  ax touch "Search Library" >/dev/null; sleep 2; state; shot s2-focused-again
  ax touch "Actions for Scroll Diag 12 of 12" >/dev/null; sleep 2.5; state; shot s2-result-drawer
  ax touch "Select" >/dev/null; sleep 2.5; state; shot s2-after-one-touch-on-select
  ax touch "Cancel" >/dev/null; sleep 2; state
  echo "S3 cursor back, result …, ONE touch on Delete (stop at its confirmation)"
  ax touch "Search Library" >/dev/null; sleep 2
  ax touch "Actions for Scroll Diag 12 of 12" >/dev/null; sleep 2.5; state; shot s3-result-drawer
  ax touch "Delete" >/dev/null; sleep 3; echo "   alert:"; ax alert | head -5 | sed 's/^/      /'; shot s3-after-one-touch-on-delete
  ax alert-touch Cancel >/dev/null; sleep 2; state; drag_away; state
  echo "S4 cursor back, bar …, ONE touch on Create folder"
  ax touch "Search Library" >/dev/null; sleep 2
  ax touch "Library actions" >/dev/null; sleep 2.5; state; shot s4-bar-drawer
  ax touch "Create folder" >/dev/null; sleep 3; echo "   alert:"; ax alert | head -5 | sed 's/^/      /'; shot s4-after-one-touch-on-create-folder
  ax alert-touch Cancel >/dev/null; sleep 2; state
  echo "S5 bar …, ONE touch on Select (the drawer is still up after the alert)"
  if ! ax tree | grep -q 'Button | Select '; then ax touch "Search Library" >/dev/null; sleep 2; ax touch "Library actions" >/dev/null; sleep 2.5; fi
  ax touch "Select" >/dev/null; sleep 2.5; state; shot s5-after-one-touch-on-select
  ax touch "Cancel" >/dev/null; sleep 2; state
  echo "S6 closing a drawer without choosing: cursor back, bar …, drag the drawer away"
  ax touch "Search Library" >/dev/null; sleep 2; state
  ax touch "Library actions" >/dev/null; sleep 2.5; state; drag_away; state; shot s6-closed-without-choosing
  echo "S7 … > Search while search is open: the cursor comes back"
  ax touch "Library actions" >/dev/null; sleep 2.5; ax touch "Search" >/dev/null; sleep 3; state; shot s7-search-refocused
  echo "S8 Close"
  ax touch "Close" >/dev/null; sleep 2; state
  wait "$probe"; echo "staging probe exit $?"
)
