#!/bin/bash
# duo-fold-input.sh TARGET (open|closed) — ONE real Device Hub pose input for
# the duo-sim-runtime session-owned Duo (window-title matched, geometry
# guarded), with system-input receipt. Pose points were visually re-identified
# on a fresh window capture (open-book=(606,774), blue upright=(573,774)
# window-local; upright was the highlighted current pose). One focus retry
# after a benign title-bar click when the hub reports window_not_focused.
# ≤6.5s when focused. Delivery must be judged by the measured app window
# change (CDP Dimensions), never by the receipt alone.
set -uo pipefail
target=${1:?usage: duo-fold-input.sh open|closed}
HUB_PID=${HUB_PID:-88167}
GEOM=${GEOM:-206 123 1100 800}
case "$target" in
  open)   X=606; Y=774 ;;
  closed) X=573; Y=774 ;;
  *) echo "unknown target $target"; exit 2 ;;
esac
receipt=${RECEIPT_DIR:-/tmp}/fold-receipt-$target.json
LIST="$(orca computer list-windows --app "pid:$HUB_PID" --json 2>&1)" || { echo "BLOCKED: list-windows failed: $LIST"; exit 69; }
PARSED="$(python3 -c "
import json
d=json.loads('''$LIST''')
for w in d['result']['windows']:
    if 'iPhone Duo duo-sim-runtime-01' in w.get('title',''):
        print(w['id'], w['x'], w['y'], w['width'], w['height']); break
")"
WID="$(echo "$PARSED" | cut -d' ' -f1)"
[ -n "$WID" ] || { echo "BLOCKED: hub window not found: $PARSED"; exit 69; }
WX=$(echo "$PARSED" | cut -d' ' -f2); WY=$(echo "$PARSED" | cut -d' ' -f3)
WW=$(echo "$PARSED" | cut -d' ' -f4); WH=$(echo "$PARSED" | cut -d' ' -f5)
[ "$WX $WY $WW $WH" = "$GEOM" ] || {
  echo "BLOCKED: hub window geometry changed: $WX,$WY ${WW}x$WH — recalibrate pose points"; exit 69; }
CLICK="$(orca computer click --app "pid:$HUB_PID" --window-id "$WID" --x "$X" --y "$Y" \
  --restore-window --no-screenshot --json 2>&1)"
RC=$?
if [ $RC -ne 0 ] || ! echo "$CLICK" | grep -q '"ok": true'; then
  if echo "$CLICK" | grep -q 'window_not_focused'; then
    echo "window_not_focused; focusing hub window via title bar, one retry"
    orca computer click --app "pid:$HUB_PID" --window-id "$WID" --x 550 --y 12 \
      --restore-window --no-screenshot --json > /dev/null 2>&1
    sleep 1
    CLICK="$(orca computer click --app "pid:$HUB_PID" --window-id "$WID" --x "$X" --y "$Y" \
      --restore-window --no-screenshot --json 2>&1)"
    RC=$?
  fi
fi
echo "$CLICK" > "$receipt"
if [ $RC -eq 0 ] && echo "$CLICK" | grep -q '"ok": true'; then
  echo "fold $target delivered (receipt ok, window $WID)"
  exit 0
fi
if echo "$CLICK" | grep -q 'action_timeout'; then
  echo "TIMEOUT-DELIVERY-UNKNOWN: hub AX timed out; delivery judged by measured window change"
  exit 0
fi
echo "BLOCKED: fold click failed rc=$RC: $CLICK"
exit 69
