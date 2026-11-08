#!/bin/bash
# duo-red-loop.sh — #350 red-capable loop (beta18 continuation, tester lane).
#
# Bounded cycles of: normalize pose → verify clean lookup (null task, empty
# DOM, no fetch observers) → DOM-derived hope press point → real native long
# press (exact CFI 33-37 forward, painted baseline + both handles, exactly one
# 200 non-aborted, real result) → real measured outward fold D1→D3 (settle
# ≤8s) → same invariants + current-channel native image → only if the outward
# selection is still valid, the return fold D3→D1 with the same assertions.
# A fold that drops the range or the paint is an application FAIL (red), never
# scored as a control outcome. Pixel-ambiguous reads stay BLOCKED, separately.
#
# Stop rules: two reds on the SAME path (outward-range / outward-paint /
# return-range / return-paint), MAX_CYCLES valid cycles (default 4), or two
# consecutive control failures (setup/precondition — never scored as
# application red; a failed run-probe run terminates the staged app, so the
# loop re-stages and counts it as a control failure). Read-only diagnostics
# only: selection-diagnostics.js at baseline and after each fold; no
# focus/Selection/CSS/layout/scroll mutation, no event/prototype wrappers, no
# synthetic clocks. Wash/handle thresholds come exclusively from the preserved
# pre-test calibration JSON (PIN); the whole-frame fallback thresholds come
# from the same pre-test baselines and are fixed in duo-wash-measure.py.
#
#   python3 test/manual-test/kit/ios_guard.py run --wait 600 --timeout 2400 \
#     --record OUT/loop.json -- bash test/manual-test/duo-verification/duo-red-loop.sh \
#     UDID METRO OUT_DIR PIN_JSON CAPTURE_PROBE_DIR PRESS_PROBE_DIR [MAX_CYCLES]
#
# Must run inside one ios_guard admission (run-probe children inherit the
# token; no nested acquisition). Requires a Metro log the HX answers can be
# read back from (OPENREADER_METRO_LOG, default this lane's).
set -uo pipefail
UDID=${1:?UDID}
METRO=${2:?METRO}
OUT=${3:?OUT_DIR}
PIN=${4:?PIN_JSON (preserved pre-test calibration)}
CAPDIR=${5:?existing DuoScreenCaptureProbe project dir}
PRESSDIR=${6:?existing LookupFoldPressProbe project dir}
MAX_CYCLES=${7:-4}
RED_STOP=2
CONTROL_STOP=2
DEV="iPhone Duo duo-sim-runtime-01"
KIT=test/manual-test/kit
AREA=test/manual-test/duo-verification
METRO_LOG=${OPENREADER_METRO_LOG:-/tmp/openreader-duosim-01/metro.log}
export OPENREADER_METRO="$METRO" OPENREADER_DEVICE="$DEV"
cd "$(cd "$(dirname "$0")/../../.." && pwd)" || exit 2
mkdir -p "$OUT"
RUN="$OUT/redloop-$(date +%H%M%S)"
mkdir -p "$RUN"
note(){ echo "=== [$(date '+%H:%M:%S')] $*" | tee -a "$RUN/loop.log"; }
POINTFILE="/tmp/openreader-lookup-$UDID.point"
DOCS="$(xcrun simctl get_app_container "$UDID" top.xujialiu.openreader data)/Documents"
LIB="$DOCS/library.json"
libhash(){ shasum -a 256 "$LIB" 2>/dev/null | cut -d' ' -f1; }

# CDP heartbeat: keep the Metro debugger device registered during timed gaps
# (test-only session reuse; no app hooks).
( end=$((SECONDS + 2400))
  while [ "$SECONDS" -lt "$end" ]; do
    echo '1' > "$RUN/_heartbeat.js"
    node $KIT/cdp.cjs --eval "$RUN/_heartbeat.js" "$METRO" >/dev/null 2>&1 || true
    sleep 0.3
  done ) &
HEARTBEAT=$!
trap 'kill "$HEARTBEAT" 2>/dev/null; true' EXIT

hq_answer(){ # before out pattern loops
  local before=$1 out=$2 pattern=$3 loops=${4:-25}
  : > "$out"
  for _ in $(seq 1 "$loops"); do
    tail -n +"$((before+1))" "$METRO_LOG" 2>/dev/null \
      | grep "HX PROBE" | grep -F "$pattern" | tail -1 > "$out"
    [ -s "$out" ] && return 0
    sleep 0.4
  done
  return 1
}
diag_answer(){ # before out — capture the DEBUG-SELECTION diagnostics answer only
  local before=$1 out=$2
  : > "$out"
  for _ in $(seq 1 25); do
    tail -n +"$((before+1))" "$METRO_LOG" 2>/dev/null \
      | grep "HX PROBE" | grep "DEBUG-SELECTION" | tail -1 > "$out"
    [ -s "$out" ] && return 0
    sleep 0.4
  done
  return 1
}
dims_height(){
  node $KIT/cdp.cjs --eval "$AREA/duo-dims-height.js" "$METRO" 2>/dev/null \
    | python3 -c "import json,sys
try: print(json.load(sys.stdin)['value'])
except Exception: print('ERR')"
}
lookup_state(){ OPENREADER_METRO="$METRO" node $KIT/cdp.cjs --eval \
  test/manual-test/duo-verification/DuoAcceptanceLookupState.js "$METRO" > "$1" 2>&1; }
state_field(){ python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))['value']
    print(eval(sys.argv[2], {"d": d}))
except Exception:
    print('ERR')
PY
}
sel_probe(){ # outfile
  local before; before=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
  node $KIT/hx.cjs "$UDID" '{}' --code-file test/manual-test/duo-verification/DuoAcceptanceSelection.js >/dev/null 2>&1
  hq_answer "$before" "$1" '"ranges"' 25
}
diag(){ # marker outfile-before — unused placeholder for a future marker'd read
  return 0
}
restage(){
  note "re-stage: relaunch + reopen fixture (a failed probe run terminated the app)"
  xcrun simctl launch "$UDID" top.xujialiu.openreader >> "$RUN/loop.log" 2>&1 || return 1
  sleep 4
  node $KIT/hx.cjs "$UDID" '{"do":"open","id":"sha256:54be80a964a5f11d5df2d97c2597025e090fc368197c3d84b2c07caf899f014d"}' >/dev/null 2>&1
  for _ in $(seq 1 20); do
    node $KIT/reading.cjs state > "$RUN/restage-state.txt" 2>&1
    grep -q '"enabled":true' "$RUN/restage-state.txt" 2>/dev/null \
      && grep -q '"playing":false' "$RUN/restage-state.txt" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
cleanup_cycle(){ # dismiss the iOS callout, close a presented drawer, restore traffic, verify original fetch
  lookup_state "$RUN/clean-state.json"
  if [ "$(state_field "$RUN/clean-state.json" "d['selection'] is not None")" = "True" ]; then
    # The fresh press shows the iOS selection callout, which eats the sheet
    # grabber drag; dismiss it with one tap on the empty title-right area
    # (device pt 350,200 -> window-local (583,343); verified 12:30 cleanup).
    WIDC="$(python3 -c "
import json
d=json.loads('''$(orca computer list-windows --app pid:88167 --json 2>&1)''')
ws=[w for w in d['result']['windows'] if 'iPhone Duo duo-sim-runtime-01' in w.get('title','')]
print(ws[0]['id'] if ws else '')
" 2>/dev/null)"
    if [ -n "$WIDC" ]; then
      orca computer click --app pid:88167 --window-id "$WIDC" --x 583 --y 343 \
        --restore-window --no-screenshot --json > "$RUN/callout-dismiss.json" 2>&1
      sleep 1.5
    fi
    bash $KIT/run-probe.sh DuoFrameCalibrationProbe "$UDID" "$CLOSEDIR" \
      -only-testing:DuoFrameCalibrationProbe/testCloseDrawerGrabber -collect-test-diagnostics never \
      > "$RUN/cycle-$CYCLE-drawer-close.log" 2>&1 || { echo "control-fail: drawer close"; return 1; }
    sleep 2
  fi
  local before; before=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
  node $KIT/hx.cjs "$UDID" '{}' --code-file "$AREA/selection-diagnostics.js" >/dev/null 2>&1
  diag_answer "$before" "$RUN/clean-diag.txt"
  hq_answer "$before" "$RUN/clean-sel.txt" '"ranges"' || { echo "no cleanup selection answer"; return 1; }
  grep -q '"ranges":\[\]' "$RUN/clean-sel.txt" || { echo "selection not empty after cleanup: $(cat "$RUN/clean-sel.txt")"; return 1; }
  echo 'globalThis.__duoAcceptanceLookupTraffic?.restore()' > "$RUN/traffic-restore.js"
  OPENREADER_METRO="$METRO" node $KIT/cdp.cjs --eval "$RUN/traffic-restore.js" "$METRO" > "$RUN/traffic-restore.txt" 2>&1
  grep -qi "restored" "$RUN/traffic-restore.txt" || { echo "traffic restore failed"; return 1; }
  lookup_state "$RUN/clean-state2.json"
  [ "$(state_field "$RUN/clean-state2.json" "(d['selection'],d['result'],d['gate'],d['traffic'])==(None,None,None,None)")" = "True" ] \
    || { echo "post-cleanup state not clean (original fetch not restored)"; return 1; }
  node $KIT/hx.cjs "$UDID" '{"do":"noop"}' >/dev/null 2>&1; sleep 0.6; rm -f "$DOCS/harness.json"
  return 0
}
restricted_capture(){ # prefix — owned panels 0/1 only, oriented; marker asserted
  local prefix="$RUN/cycle-$CYCLE/$1"
  bash $KIT/run-probe.sh DuoScreenCaptureProbe "$UDID" "$CAPDIR" \
    -only-testing:DuoScreenCaptureProbe/testCaptureAllScreens -collect-test-diagnostics never \
    > "$prefix.capture.log" 2>&1 || { echo "capture probe failed"; return 1; }
  local newest; newest=$(grep -l "restricted-v2 owned-panels-only started" "$CAPDIR"/test-*.log 2>/dev/null | sort | tail -1)
  [ -n "$newest" ] || { echo "restricted-v2 marker missing (stale binary?)"; return 1; }
  grep -q "screen 0 captured" "$newest" && grep -q "screen 1 captured" "$newest" \
    || { echo "owned panels 0/1 not both captured"; return 1; }
  local atts; atts=$(ls -dt "$CAPDIR"/attachments-* 2>/dev/null | head -1)
  local count; count=$(ls "$atts"/*.png 2>/dev/null | wc -l | tr -d ' ')
  [ "$count" = "2" ] || { echo "expected exactly 2 owned-panel attachments, got $count"; return 1; }
  python3 - "$atts" "$prefix" <<'PY' || { echo "owned inner/outer attachments not found"; return 1; }
import glob, sys
from PIL import Image
atts, prefix = sys.argv[1], sys.argv[2]
pngs = glob.glob(atts + "/*.png")
inner = [p for p in pngs if Image.open(p).size == (2006, 2852)]
outer = [p for p in pngs if Image.open(p).size == (1398, 2034)]
if not inner or not outer:
    raise SystemExit(1)
Image.open(inner[0]).transpose(Image.ROTATE_270).save(prefix + "-inner-oriented.png")
Image.open(outer[0]).save(prefix + "-outer.png")
with open(prefix + "-capture-files.txt", "w") as f:
    f.write("inner: " + inner[0] + "\nouter: " + outer[0] + "\n")
PY
  return 0
}
paint_classify(){ # image rect_json-or-null → verdict string
  python3 - "$1" "$2" "$PIN" "$RUN" "$CYCLE" > "$RUN/cycle-$CYCLE/paint-$3.json" <<'PY'
import json, subprocess, sys
image, rect, pin_path, run, cyc = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
pin = json.load(open(pin_path))
if rect == "null":
    box = None
else:
    x, y, w, h = [round(v * 3) for v in json.loads(rect)]
    box = [max(x - 14, 0), max(y - 14, 0), w + 28, h + 28]
cmd = {"image": image, "box": box, "wash": pin["wash"], "tol": 12, "dots": box is not None}
with open(f"{run}/cycle-{cyc}/_measure-cmd.json", "w") as f:
    json.dump(cmd, f)
print(subprocess.run(["python3", "test/manual-test/duo-verification/duo-wash-measure.py",
                      f"{run}/cycle-{cyc}/_measure-cmd.json"], capture_output=True, text=True).stdout)
PY
  local mode share dots
  mode=$(python3 -c "import json;print(json.load(open('$RUN/cycle-$CYCLE/paint-$3.json')).get('mode','ERR'))" 2>/dev/null || echo ERR)
  share=$(python3 -c "import json;print(json.load(open('$RUN/cycle-$CYCLE/paint-$3.json'))['washShare'])" 2>/dev/null || echo ERR)
  dots=$(python3 -c "import json;print(json.load(open('$RUN/cycle-$CYCLE/paint-$3.json')).get('handleClusters','n/a'))" 2>/dev/null || echo ERR)
  echo "paint[$mode] washShare=$share dots=$dots" >> "$RUN/loop.log"
  if [ "$share" = "ERR" ]; then echo "BLOCKED-measure-error"; return 0; fi
  if [ "$mode" = "crop" ]; then
    if python3 -c "import sys; sys.exit(0 if float('$share')>=0.4 else 1)"; then
      if [ "$dots" -ge 2 ] 2>/dev/null; then echo "PAINT-PRESENT"; else echo "BLOCKED-dots-ambiguous"; fi
    elif python3 -c "import sys; sys.exit(0 if float('$share')<0.05 else 1)"; then
      echo "PAINT-LOST"
    else
      echo "BLOCKED-pixel-ambiguous"
    fi
  else
    if python3 -c "import sys; sys.exit(0 if float('$share')>=0.001 else 1)"; then
      echo "BLOCKED-paint-visible-without-selection"
    elif python3 -c "import sys; sys.exit(0 if float('$share')<=0.0005 else 1)"; then
      echo "PAINT-LOST"
    else
      echo "BLOCKED-pixel-ambiguous"
    fi
  fi
}

CLOSEDIR=${CLOSEDIR:-/tmp/openreader-duosim-01/beta18-final-01/d2/frameclose}
red_outward_range=0; red_outward_paint=0; red_return_range=0; red_return_paint=0
valid=0; control_fail_streak=0; stop_reason=""; CYCLE=0
echo "red-loop start $(date '+%H:%M:%S') pin=$PIN max=$MAX_CYCLES capdir=$CAPDIR pressdir=$PRESSDIR" | tee -a "$RUN/loop.log"
BASELIB=$(libhash); echo "baseline lib=$BASELIB" | tee -a "$RUN/loop.log"

while [ "$valid" -lt "$MAX_CYCLES" ]; do
  CYCLE=$((CYCLE+1))
  mkdir -p "$RUN/cycle-$CYCLE"
  verdict="CONTROL_INCOMPLETE"; dom="n/a"
  note "----- CYCLE $CYCLE (valid=$valid reds: out-range=$red_outward_range out-paint=$red_outward_paint ret-range=$red_return_range ret-paint=$red_return_paint control-streak=$control_fail_streak)"

  # 1) pose normalize (device pose persists across app relaunches)
  h=$(dims_height)
  if [ "$h" != "678" ]; then
    bash "$AREA/duo-fold-input.sh" closed > "$RUN/cycle-$CYCLE/pose-fold.log" 2>&1
    ok=0
    for _ in $(seq 1 16); do h=$(dims_height); [ "$h" = "678" ] && { ok=1; break; }; sleep 0.5; done
    [ "$ok" = 1 ] || { note "control: pose normalize failed (height=$h)"; control_fail_streak=$((control_fail_streak+1)); }
  fi
  # 2) clean lookup (null task + empty DOM + no fetch observers) + volume
  if [ "$control_fail_streak" -lt "$CONTROL_STOP" ]; then
    lookup_state "$RUN/cycle-$CYCLE/pre-state.json"
    if [ "$(state_field "$RUN/cycle-$CYCLE/pre-state.json" "(d['selection'],d['result'],d['gate'],d['traffic'])==(None,None,None,None)")" != "True" ]; then
      if cleanup_cycle; then note "pre-existing lookup cleared before cycle"; else
        note "control: could not reach clean lookup"; control_fail_streak=$((control_fail_streak+1)); fi
    fi
  fi
  if [ "$control_fail_streak" -lt "$CONTROL_STOP" ]; then
    bash $KIT/silence.sh set "$UDID" >/dev/null 2>&1 && bash $KIT/silence.sh check "$UDID" >/dev/null 2>&1 \
      || { note "control: silence"; control_fail_streak=$((control_fail_streak+1)); }
  fi
  # 3) DOM-derived press point at the current layout + closed-pose viewport
  presspoint=""
  if [ "$control_fail_streak" -lt "$CONTROL_STOP" ]; then
    local_lb=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
    node $KIT/hx.cjs "$UDID" '{}' --code-file "$AREA/duo-hoperect.js" >/dev/null 2>&1
    if hq_answer "$local_lb" "$RUN/cycle-$CYCLE/hoperect.txt" '"rect"' \
      && grep -q '"viewport":\[382,678\]' "$RUN/cycle-$CYCLE/hoperect.txt"; then
      presspoint=$(python3 -c "
import json, re
line = open('$RUN/cycle-$CYCLE/hoperect.txt').read()
d = json.loads(re.search(r'\{.*\}', line).group(0))
x, y, w, h = d['rect']
print('%d %d 466 678' % (round(x + w / 2), round(y + h / 2)))" 2>/dev/null)
      if [ -n "$presspoint" ]; then printf '%s\n' "$presspoint" > "$POINTFILE"; note "press point: $presspoint ($(cat "$RUN/cycle-$CYCLE/hoperect.txt" | head -c 200))"; else
        note "control: press point derivation"; control_fail_streak=$((control_fail_streak+1)); fi
    else
      note "control: no hoperect / not closed pose: $(cat "$RUN/cycle-$CYCLE/hoperect.txt" 2>/dev/null | head -c 200)"; control_fail_streak=$((control_fail_streak+1))
    fi
  fi
  # 4) arm the passthrough counter (this cycle only) + real native long press
  if [ "$control_fail_streak" -lt "$CONTROL_STOP" ]; then
    OPENREADER_METRO="$METRO" node $KIT/cdp.cjs --eval "$AREA/DuoAcceptanceLookupTraffic.js" "$METRO" \
      > "$RUN/cycle-$CYCLE/traffic-arm.txt" 2>&1
    grep -qi "armed" "$RUN/cycle-$CYCLE/traffic-arm.txt" \
      || { note "control: traffic arm"; control_fail_streak=$((control_fail_streak+1)); }
  fi
  if [ "$control_fail_streak" -lt "$CONTROL_STOP" ]; then
    if ! bash $KIT/run-probe.sh LookupFoldPressProbe "$UDID" "$PRESSDIR" \
      -only-testing:LookupFoldPressProbe/testLongPressHope -collect-test-diagnostics never \
      > "$RUN/cycle-$CYCLE/press.log" 2>&1; then
      note "control: press probe failed (runner cleaned up the app)"
      control_fail_streak=$((control_fail_streak+1))
      if restage; then
        control_fail_streak=$((control_fail_streak+1))
      else
        stop_reason="restage-failed"; control_fail_streak=$((CONTROL_STOP))
      fi
    fi
  fi
  # 5) positive control must exist BEFORE any fold
  positive=0
  if [ "$control_fail_streak" -lt "$CONTROL_STOP" ]; then
    sleep 1.5
    sel_probe "$RUN/cycle-$CYCLE/selection-press.txt" || note "control: no selection answer after press"
    lookup_state "$RUN/cycle-$CYCLE/state-press.json"
    python3 - <<PY > "$RUN/cycle-$CYCLE/positive-check.txt" 2>&1 || true
import json, re
ok = True
line = open('$RUN/cycle-$CYCLE/selection-press.txt').read()
d = json.loads(re.search(r'\{.*\}', line).group(0)); r = d['ranges'][0]
ok &= r['text'] == 'hope' and r['cfi'] == 'epubcfi(/6/2!/4/4,/1:33,/1:37)'
ok &= (r['start'], r['end']) == (33, 37) and r['backward'] is False
open('$RUN/cycle-$CYCLE/press-rect.json', 'w').write(json.dumps(r['rects'][0]))
st = json.load(open('$RUN/cycle-$CYCLE/state-press.json'))['value']
t = (st.get('traffic') or {}).get('requests', [])
ok &= len(t) == 1 and t[0]['status'] == 200 and not t[0]['abortedAt']
ok &= (st.get('result') or {}).get('source') == 'Free Dictionary API'
print('POSITIVE-OK' if ok else 'POSITIVE-INVALID')
PY
    if grep -q "POSITIVE-OK" "$RUN/cycle-$CYCLE/positive-check.txt"; then
      xcrun simctl io "$UDID" screenshot "$RUN/cycle-$CYCLE/painted-press-outer.png" >/dev/null 2>&1
      rect1=$(cat "$RUN/cycle-$CYCLE/press-rect.json")
      v=$(paint_classify "$RUN/cycle-$CYCLE/painted-press-outer.png" "$rect1" "press")
      case "$v" in
        PAINT-PRESENT) positive=1; verdict="BASELINE-OK" ;;
        BLOCKED-*) note "baseline paint classify=$v — BLOCKED for this cycle (not red)"; verdict="BLOCKED-$v" ;;
        *) note "control: baseline paint not established ($v)"; verdict="CONTROL_INCOMPLETE" ;;
      esac
    else
      note "control: positive invalid: $(tail -2 "$RUN/cycle-$CYCLE/positive-check.txt" | tr '\n' ' ')"
    fi
  fi
  if [ "$positive" = 1 ]; then
    control_fail_streak=0
    valid=$((valid+1))
    before_diag=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
    # baseline read-only diagnostics (focus/owner/frame; answer captured alone)
    node $KIT/hx.cjs "$UDID" '{}' --code-file "$AREA/selection-diagnostics.js" >/dev/null 2>&1
    diag_answer "$before_diag" "$RUN/cycle-$CYCLE/diag-baseline.txt" \
      || echo "baseline diagnostics unavailable (recorded)" >> "$RUN/loop.log"
    # outward fold, settle ≤8s
    if ! bash "$AREA/duo-fold-input.sh" open > "$RUN/cycle-$CYCLE/fold-open.log" 2>&1; then
      note "control: outward fold input failed"; control_fail_streak=$((control_fail_streak+1)); verdict="CONTROL_INCOMPLETE"
    else
      settle_ok=0
      for _ in $(seq 1 16); do h=$(dims_height); [ "$h" = "669" ] && { settle_ok=1; break; }; sleep 0.5; done
      if [ "$settle_ok" = 1 ]; then sleep 3; else
        note "control: fold dims never reached 669 within budget"; control_fail_streak=$((control_fail_streak+1)); verdict="CONTROL_INCOMPLETE"
      fi
    fi
    if [ "$verdict" = "BASELINE-OK" ]; then
      before_diag=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
      sel_probe "$RUN/cycle-$CYCLE/selection-d3.txt" || note "no selection answer at D3"
      lookup_state "$RUN/cycle-$CYCLE/state-d3.json"
      traffic_d3=$(state_field "$RUN/cycle-$CYCLE/state-d3.json" "len((d['traffic'] or {}).get('requests',[]))")
      task_kept=$(state_field "$RUN/cycle-$CYCLE/state-d3.json" "bool(d['result'] and d['result'].get('text'))")
      libok=$([ "$(libhash)" = "$BASELIB" ] && echo same || echo CHANGED)
      if restricted_capture "d3"; then
        node $KIT/hx.cjs "$UDID" '{}' --code-file "$AREA/selection-diagnostics.js" >/dev/null 2>&1
        diag_answer "$before_diag" "$RUN/cycle-$CYCLE/diag-d3.txt" \
          || echo "D3 diagnostics unavailable (recorded)" >> "$RUN/loop.log"
        if grep -q '"ranges":\[\]' "$RUN/cycle-$CYCLE/selection-d3.txt"; then
          dom=dropped
          v=$(paint_classify "$RUN/cycle-$CYCLE/d3-inner-oriented.png" "null" "d3null")
          case "$v" in
            PAINT-LOST) verdict="RED-outward-range-drop"; red_outward_range=$((red_outward_range+1)) ;;
            BLOCKED-paint-visible-without-selection) verdict="BLOCKED-contradictory (DOM dropped, paint visible)" ;;
            *) verdict="BLOCKED-pixel-ambiguous" ;;
          esac
        else
          dom=kept
          rect3=$(python3 -c "
import json, re
d = json.loads(re.search(r'\{.*\}', open('$RUN/cycle-$CYCLE/selection-d3.txt').read()).group(0))
print(json.dumps(d['ranges'][0]['rects'][0]))")
          v=$(paint_classify "$RUN/cycle-$CYCLE/d3-inner-oriented.png" "$rect3" "d3")
          case "$v" in
            PAINT-PRESENT) verdict="OUTWARD-PASS" ;;
            PAINT-LOST) verdict="RED-outward-paint-only-loss"; red_outward_paint=$((red_outward_paint+1)) ;;
            *) verdict="BLOCKED-$v" ;;
          esac
        fi
        note "cycle $CYCLE outward: dom=$dom rect3=$rect3 traffic=$traffic_d3 taskKept=$task_kept lib=$libok verdict=$verdict"
      else
        verdict="CONTROL_INCOMPLETE(outward-capture)"; control_fail_streak=$((control_fail_streak+1))
        note "control: restricted capture failed at D3"
      fi
      # return fold only if the outward selection is still valid
      if [ "$dom" = "kept" ] && [ "$verdict" = "OUTWARD-PASS" ]; then
        if bash "$AREA/duo-fold-input.sh" closed > "$RUN/cycle-$CYCLE/fold-closed.log" 2>&1; then
          rok=0
          for _ in $(seq 1 16); do h=$(dims_height); [ "$h" = "678" ] && { rok=1; break; }; sleep 0.5; done
          if [ "$rok" = 1 ]; then
            sleep 3
            sel_probe "$RUN/cycle-$CYCLE/selection-return.txt" || note "no selection answer after return"
            lookup_state "$RUN/cycle-$CYCLE/state-return.json"
            if restricted_capture "return"; then
              if grep -q '"ranges":\[\]' "$RUN/cycle-$CYCLE/selection-return.txt"; then
                v=$(paint_classify "$RUN/cycle-$CYCLE/return-inner-oriented.png" "null" "retnull")
                case "$v" in
                  PAINT-LOST) verdict="RED-return-range-drop"; red_return_range=$((red_return_range+1)) ;;
                  BLOCKED-paint-visible-without-selection) verdict="BLOCKED-contradictory (DOM dropped, paint visible)" ;;
                  *) verdict="BLOCKED-pixel-ambiguous" ;;
                esac
              else
                rectr=$(python3 -c "
import json, re
d = json.loads(re.search(r'\{.*\}', open('$RUN/cycle-$CYCLE/selection-return.txt').read()).group(0))
print(json.dumps(d['ranges'][0]['rects'][0]))")
                v=$(paint_classify "$RUN/cycle-$CYCLE/return-outer.png" "$rectr" "ret")
                case "$v" in
                  PAINT-PRESENT) verdict="RETURN-PASS" ;;
                  PAINT-LOST) verdict="RED-return-paint-only-loss"; red_return_paint=$((red_return_paint+1)) ;;
                  *) verdict="BLOCKED-$v" ;;
                esac
              fi
              note "cycle $CYCLE return: verdict=$verdict"
            else
              verdict="CONTROL_INCOMPLETE(return-capture)"; control_fail_streak=$((control_fail_streak+1))
              note "control: restricted capture failed at return"
            fi
          else
            note "control: return dims never 678"; verdict="CONTROL_INCOMPLETE"; control_fail_streak=$((control_fail_streak+1))
          fi
        else
          note "control: return fold input failed"; verdict="CONTROL_INCOMPLETE"; control_fail_streak=$((control_fail_streak+1))
        fi
      fi
    fi
  fi
  # per-cycle cleanup (drawer close only when presented; restore; verify)
  if ! cleanup_cycle; then
    note "cleanup control failure"
    control_fail_streak=$((control_fail_streak+1))
  fi
  echo "CYCLE_RESULT cycle=$CYCLE valid=$verdict" | tee -a "$RUN/loop.log"
  echo "CYCLE_RESULT cycle=$CYCLE verdict=$verdict" >> "$RUN/cycles.txt"
  for n in "$red_outward_range" "$red_outward_paint" "$red_return_range" "$red_return_paint"; do
    if [ "$n" -ge "$RED_STOP" ]; then stop_reason="two-reds-same-path"; fi
  done
  [ -n "$stop_reason" ] && break
  if [ "$control_fail_streak" -ge "$CONTROL_STOP" ]; then stop_reason="control-failures"; break; fi
done
[ -z "$stop_reason" ] && stop_reason="max-valid-cycles-reached"
note "STOP: $stop_reason (valid=$valid reds: out-range=$red_outward_range out-paint=$red_outward_paint ret-range=$red_return_range ret-paint=$red_return_paint)"
cat > "$RUN/summary.json" <<EOF
{"stopReason":"$stop_reason","validCycles":$valid,"redOutwardRange":$red_outward_range,"redOutwardPaint":$red_outward_paint,"redReturnRange":$red_return_range,"redReturnPaint":$red_return_paint,"finishedAt":"$(date '+%H:%M:%S')"}
EOF
exit 0
