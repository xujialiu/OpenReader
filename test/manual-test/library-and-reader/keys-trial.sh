#!/bin/bash
# Command-F and Escape on the Library page with real macOS key events (#339 verification, 2026-11-01), outside XCTest.
#
#   bash test/manual-test/library-and-reader/keys-trial.sh SIMULATOR_UDID DEVICE_HUB_PID WINDOW_ID
#
# XCTest's `typeKey` (Command-F and Escape alike) never reached the app (`LibrarySearchProbe.testHardwareCmdFAndEscape`,
# `testEscapeEndsSelectionThenSearch`, `testSelectionBlocksCmdF` failed on a build that has the keys), and AXe's HID
# keyboard stopped delivering after the first hour of the run. What did reach it: `orca computer hotkey|press-key|type-text`
# into the Device Hub window showing the simulator (`orca computer list-windows --app pid:PID --json` for the id of the window
# titled `DEVICE – iOS 27.0`; `ps -eo pid,comm | grep DeviceHub` for the pid, one per Xcode). The events are synthetic macOS
# key events posted to the Device Hub process (`path: synthetic`, `delivery: background`, verification `unverified`); the Device
# Hub hands them to the simulated device as a Mac keyboard's keys, the route of a physical keyboard, but nobody pressed a key.
#
# Each step prints what the page shows afterwards, read from the accessibility tree (field, its value, `N selected`, title).
# Needs the staged Library (stage-search-fixtures.sh) with the app on its root and the keyboard of the Mac not captured elsewhere.
# It never plays anything. Run it on a device of its own: it sends keys to a window of the Mac.
set -uo pipefail
[[ $# -eq 3 ]] || { echo 'Usage: keys-trial.sh SIMULATOR_UDID DEVICE_HUB_PID WINDOW_ID' >&2; exit 2; }
U=$1; PID=$2; WIN=$3
cd "$(dirname "$0")/../../.."
ax() { timeout 40 python3 test/manual-test/kit/ax.py "$U" "$@" 2>&1; }
hot() { orca computer hotkey --app "pid:$PID" --window-id "$WIN" --key "$1" --no-screenshot --json >/dev/null 2>&1; sleep 2; }
key() { orca computer press-key --app "pid:$PID" --window-id "$WIN" --key "$1" --no-screenshot --json >/dev/null 2>&1; sleep 2; }
typ() { orca computer type-text --app "pid:$PID" --window-id "$WIN" --text "$1" --no-screenshot --json >/dev/null 2>&1; sleep 2; }
state() {
  local tree; tree=$(ax tree)
  local field; field=$(grep -c 'TextField | Search Library' <<<"$tree")
  local value; value=$(grep -m1 'TextField | Search Library' <<<"$tree" | sed -E 's/.*TextField \| Search Library \| (.*) \| [0-9]+,[0-9]+ .*/\1/')
  local sel; sel=$(grep -m1 -oE '[0-9]+ selected' <<<"$tree")
  local title; title=$(grep -m1 -E 'Heading \| ' <<<"$tree" | sed -E 's/.*Heading \| (.*) \| .*/\1/')
  local rows; rows=$(grep -cE 'Button \| .*, Library' <<<"$tree")
  echo "   -> field=$field value='${value:-}' selecting='${sel:-no}' heading='${title:-?}' result rows=$rows"
}
echo "start"; state
echo "1. Command-F opens search"; hot "Cmd+F"; state
echo "2. type 'Diag 1' with the Mac keyboard"; typ "Diag 1"; state
echo "3. Return puts the keyboard away (the field keeps its text)"; key Return; state
echo "4. Command-F again: returns the cursor to the open field"; hot "Cmd+F"; state
echo "5. Escape closes search (query goes, list back)"; key Escape; state
echo "6. Escape with nothing to end: nothing happens"; key Escape; state
echo "7. open search, type, put the keyboard away, select all results through the menu"
hot "Cmd+F"; typ "Diag 1"; key Return
ax touch "Library actions" >/dev/null; sleep 2; ax touch "Select" >/dev/null; sleep 2; ax touch "Select all" >/dev/null; sleep 2; state
echo "8. Command-F while selecting: does nothing"; hot "Cmd+F"; state
echo "9. Escape while selecting: ends the selection, keeps search"; key Escape; state
echo "10. Escape again: closes search"; key Escape; state
