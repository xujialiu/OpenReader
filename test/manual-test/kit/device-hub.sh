#!/bin/bash
# What reaches the simulated app only through the Device Hub window (Xcode 27's replacement for Simulator.app): Mac key
# events, the software keyboard's visibility, and the Accessibility inspector's switches (Reduce Motion, ...). Written while
# verifying #341 (pitfalls/mcp.md and pitfalls/simulators.md, 2026-11-02, "Keys through the Device Hub").
#
#   bash test/manual-test/kit/device-hub.sh DEVICE_NAME key Cmd+F | key Escape
#   bash test/manual-test/kit/device-hub.sh DEVICE_NAME switch "Reduce Motion"
#   bash test/manual-test/kit/device-hub.sh DEVICE_NAME toggle-keyboard
#   bash test/manual-test/kit/device-hub.sh DEVICE_NAME keyboard SIMULATOR_UDID
#
# DEVICE_NAME is the simulator's name as its Device Hub window is titled (`iPhone 17 animation`). Each Xcode has a Device Hub of
# its own and every one of them lists a window for the device, but only the Device Hub of the Xcode that owns the runtime delivers
# keys: DEVICE_HUB_APP selects it (default Xcode-27.0.0, which is what delivered on 2026-11-02; the 27.1.0 one answered `ok`
# and reached nothing).
#
# key           Cmd+F, Escape, ...: `orca computer hotkey` (a chord) or `press-key`, with `--no-screenshot` and without
#               `--restore-window`. It returns after 1.1 to 1.4 s and the app acts 0.6 to 0.9 s after the call began; two calls
#               started together are served one after the other, so two keys cannot be made to fall 0.3 s apart.
#               A key event puts the device into the hardware-keyboard state: from then on a focused field shows no software keyboard.
# switch        AXPress on the inspector switch that follows the text NAME. Element indexes move with what the app lists above the
#               inspector (two more while the search field is open), so the index is looked up every time, never kept.
# toggle-keyboard  Device > Keyboard > Toggle Software Keyboard, the only way back to the software keyboard. The menu item is enabled
#               only while the Device Hub is frontmost: this makes it frontmost for about a second and puts the previous app back.
#               Run it with a text field focused (open Library Search first) and read `keyboard` after.
# keyboard      One screenshot of that simulator: `keyboard visible` (the keys' bluish share of y 620 to 840 above 0.3; 0.44 to 0.49
#               with the keyboard, 0.01 without) or `no keyboard`. The accessibility tree cannot tell: a hidden keyboard keeps its keys
#               in the tree, below the screen.
set -euo pipefail
[[ $# -ge 2 ]] || { sed -n '2,24p' "$0" >&2; exit 2; }
device=$1; action=$2; shift 2
app=${DEVICE_HUB_APP:-Xcode-27.0.0}
pid=$(pgrep -f "$app.app/Contents/Applications/DeviceHub.app/Contents/MacOS/DeviceHub" | head -1 || true)
[[ -n $pid ]] || { echo "no Device Hub of $app is running" >&2; exit 2; }
window() {
  orca computer list-windows --app "pid:$pid" --json | python3 -c "
import json, sys
for w in json.load(sys.stdin)['result']['windows']:
    if sys.argv[1] in w['title']: print(w['id']); break
" "$device"
}
case $action in
  key)
    win=$(window); [[ -n $win ]] || { echo "no Device Hub window titled for $device" >&2; exit 2; }
    key=$1
    verb=press-key; [[ $key == *+* ]] && verb=hotkey
    orca computer "$verb" --app "pid:$pid" --window-id "$win" --key "$key" --no-screenshot --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
a = r['result']['action']
print('ok' if r['ok'] else 'FAILED', a['actionName'], a['path'], a['delivery'])" ;;
  switch)
    win=$(window); name=$1
    idx=$(orca computer get-app-state --app "pid:$pid" --window-id "$win" --no-screenshot --query "$name" | grep -E "^[[:space:]]*[0-9]+ text $name" | awk '{print $1}')
    [[ -n $idx ]] || { echo "no inspector text $name" >&2; exit 1; }
    orca computer click --app "pid:$pid" --window-id "$win" --element-index $((idx + 1)) --no-screenshot --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
print('ok' if r['ok'] else 'FAILED', r['result']['action']['actionName'])" ;;
  toggle-keyboard)
    osascript <<AS
tell application "System Events"
  set prevProc to first process whose frontmost is true
  set dhProc to first process whose unix id is $pid
  set frontmost of dhProc to true
  delay 0.8
  click menu item "Toggle Software Keyboard" of menu 1 of menu item "Keyboard" of menu "Device" of menu bar item "Device" of menu bar 1 of dhProc
  delay 0.4
  set frontmost of prevProc to true
end tell
AS
    ;;
  keyboard)
    udid=$1
    shot=$(mktemp -t keyboard-state).png
    xcrun simctl io "$udid" screenshot "$shot" >/dev/null 2>&1
    python3 -c "
import sys, cv2, numpy as np
f = cv2.imread(sys.argv[1]); s = f.shape[1] / 402.0
region = f[int(620 * s):int(840 * s), :, :].astype(np.float32)
share = float(((region[:, :, 0] - region[:, :, 2]) >= 5).mean())
print('keyboard visible' if share > 0.3 else 'no keyboard', round(share, 3))" "$shot"
    rm -f "$shot" ;;
  *) echo "unknown action $action" >&2; exit 2 ;;
esac
