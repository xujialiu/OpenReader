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
# Stop rules: two reds on the SAME path, MAX_CYCLES fully qualified cycles
# (default/max 4), or two TOTAL control-failed cycles (never reset by positives).
# Stop reasons are not verdicts. APP_RED exits 1 even if cleanup is uncertain;
# incomplete controls/cleanup without RED exit 2; only fully clean cycles exit 0.
# Control failures (setup/precondition — never scored as
# application red; a failed run-probe run terminates the staged app, so the
# loop re-stages and counts it as a control failure). Read-only diagnostics
# only: selection-diagnostics.js at baseline and after each fold; no
# focus/Selection/CSS/layout/scroll mutation, no event/prototype wrappers, no
# synthetic clocks. Wash/handle thresholds come exclusively from the preserved
# pre-test calibration JSON (PIN); the whole-frame fallback thresholds come
# from the same pre-test baselines; duo-loop-verdict.py classifies unchanged
# duo-wash-measure.py measurements.
#
#   python3 test/manual-test/kit/ios_guard.py run --wait 600 --timeout 2400 \
#     --record OUT/loop.json -- bash test/manual-test/duo-verification/duo-red-loop.sh \
#     UDID METRO OUT_DIR PIN_JSON CAPTURE_PROBE_DIR PRESS_PROBE_DIR [MAX_CYCLES]
#
# Must run inside one ios_guard admission (run-probe children inherit the
# token; no nested acquisition). Requires a Metro log the HX answers can be
# read back from (OPENREADER_METRO_LOG, default this lane's).
set -uo pipefail
# Replay is deliberately before every native prerequisite/resource access.
if [ "${1:-}" = "--replay" ]; then
  [ "$#" = 3 ] || { echo 'usage: duo-red-loop.sh --replay HOST_MANIFEST NEW_OUT' >&2; exit 2; }
  exec python3 "$(dirname "$0")/duo-loop-verdict.py" replay "$2" "$3"
fi
UDID=${1:?UDID}
METRO=${2:?METRO}
OUT=${3:?OUT_DIR}
PIN=${4:?PIN_JSON (preserved pre-test calibration)}
CAPDIR=${5:?existing DuoScreenCaptureProbe project dir}
PRESSDIR=${6:?existing LookupFoldPressProbe project dir}
MAX_CYCLES=${7:-4}
case "$MAX_CYCLES" in 1|2|3|4) ;; *) echo 'MAX_CYCLES must be 1-4' >&2; exit 2;; esac
DEV="iPhone Duo duo-sim-runtime-01"
KIT=test/manual-test/kit
AREA=test/manual-test/duo-verification
METRO_LOG=${OPENREADER_METRO_LOG:-/tmp/openreader-duosim-01/metro.log}
export OPENREADER_METRO="$METRO" OPENREADER_DEVICE="$DEV"
cd "$(cd "$(dirname "$0")/../../.." && pwd)" || exit 2
mkdir -p "$OUT"
RUN="$OUT/redloop-$(date +%H%M%S)"
mkdir "$RUN" || exit 2
note(){ echo "=== [$(date '+%H:%M:%S')] $*" | tee -a "$RUN/loop.log"; }
POINTFILE="/tmp/openreader-lookup-$UDID.point"
DOCS="$(xcrun simctl get_app_container "$UDID" top.xujialiu.openreader data)/Documents"
LIB="$DOCS/library.json"
libhash(){ shasum -a 256 "$LIB" 2>/dev/null | cut -d' ' -f1; }

# CDP heartbeat: keep the Metro debugger device registered during timed gaps
# (fresh CDP connection on every cdp.cjs call; no persistent session/app hooks).
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
      | grep "HX PROBE" | grep -F "$pattern" > "$out"
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
  node $KIT/hx.cjs "$UDID" '{}' --code-file test/manual-test/duo-verification/DuoAcceptanceSelection.js >/dev/null 2>&1 || return 1
  hq_answer "$before" "$1" '"ranges"' 25
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
cleanup_cycle(){ # restoration is attempted even after a close/selection control failure
  local clean="$RUN/cycle-$CYCLE/cleanup" failed=0 floor ceiling
  mkdir -p "$clean"
  floor=$(now_ms)
  lookup_state "$clean/initial.json" || failed=1
  if [ "$(state_field "$clean/initial.json" "d['selection'] is not None")" = True ]; then
    # Historical lane-specific callout coordinates/PID need fresh qualification
    # before a live run; failure cannot be accepted as verified cleanup.
    orca computer list-windows --app pid:88167 --json > "$clean/windows.json" 2>&1 || failed=1
    WIDC="$(python3 - "$clean/windows.json" <<'WINDOW'
import json, sys
with open(sys.argv[1]) as source:
    windows = json.load(source)['result']['windows']
owned = [w for w in windows if 'iPhone Duo duo-sim-runtime-01' in w.get('title', '')]
print(owned[0]['id'] if len(owned) == 1 else '')
WINDOW
)"
    if [ -n "$WIDC" ]; then
      orca computer click --app pid:88167 --window-id "$WIDC" --x 583 --y 343 \
        --restore-window --no-screenshot --json > "$clean/callout-dismiss.json" 2>&1 || failed=1
      sleep 1.5
    else failed=1; fi
    bash $KIT/run-probe.sh DuoFrameCalibrationProbe "$UDID" "$CLOSEDIR" \
      -only-testing:DuoFrameCalibrationProbe/testCloseDrawerGrabber -collect-test-diagnostics never \
      > "$clean/drawer-close.log" 2>&1 || failed=1
    sleep 2
  fi
  # Diagnostics do not return ranges; ask the actual selection probe separately.
  sel_probe "$clean/selection.txt" || failed=1
  echo 'globalThis.__duoAcceptanceLookupTraffic?.restore()' > "$clean/restore.js"
  node $KIT/cdp.cjs --eval "$clean/restore.js" "$METRO" > "$clean/restore.json" 2>&1 || failed=1
  lookup_state "$clean/state.json" || failed=1
  node $KIT/hx.cjs "$UDID" '{"do":"noop"}' >/dev/null 2>&1 || failed=1
  sleep 0.6
  rm -f "$DOCS/harness.json" || failed=1
  [ ! -e "$DOCS/harness.json" ] || failed=1
  ceiling=$(now_ms)
  python3 "$ORACLE" cleanup "$clean" "$floor" "$ceiling" "$failed"
}
restricted_capture(){ # prefix — owned panels 0/1 only, oriented; marker asserted
  local prefix="$RUN/cycle-$CYCLE/$1"
  touch "$prefix.capture-start"
  bash $KIT/run-probe.sh DuoScreenCaptureProbe "$UDID" "$CAPDIR" \
    -only-testing:DuoScreenCaptureProbe/testCaptureAllScreens -collect-test-diagnostics never \
    > "$prefix.capture.log" 2>&1 || { echo "capture probe failed"; return 1; }
  local newest; newest=$(find "$CAPDIR" -maxdepth 1 -name 'test-*.log' -newer "$prefix.capture-start" -print | sort | tail -1)
  [ -n "$newest" ] && grep -q "restricted-v2 owned-panels-only started" "$newest" \
    || { echo "fresh restricted-v2 marker missing (stale binary?)"; return 1; }
  grep -q "screen 0 captured" "$newest" && grep -q "screen 1 captured" "$newest" \
    || { echo "owned panels 0/1 not both captured"; return 1; }
  local atts; atts=$(find "$CAPDIR" -maxdepth 1 -type d -name 'attachments-*' -newer "$prefix.capture-start" -print | sort | tail -1)
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
# Measurement only. All thresholds/invariants/verdicts live in the shared oracle.
measure_paint(){ # phase image selection receipt -> unchanged pinned wash measurement
  python3 - "$1" "$2" "$3" "$PIN" "$RUN/cycle-$CYCLE" <<'MEASURE'
import json, subprocess, sys
from pathlib import Path
phase, image, selection, pin_path, directory = sys.argv[1:]
text = Path(selection).read_text().split('HX PROBE ', 1)[-1].strip()
ranges = json.loads(text)['ranges']
box = None
if ranges:
    x, y, w, h = [round(v * 3) for v in ranges[0]['rects'][0]]
    box = [max(x - 14, 0), max(y - 14, 0), w + 28, h + 28]
pin = json.loads(Path(pin_path).read_text())
cmd = {'image': image, 'box': box, 'wash': pin['wash'], 'tol': 12, 'dots': box is not None}
path = Path(directory) / ('measure-' + phase + '.json')
path.write_text(json.dumps(cmd))
result = subprocess.run(['python3', 'test/manual-test/duo-verification/duo-wash-measure.py', str(path)],
                        capture_output=True, text=True, check=True)
name = {'baseline': 'press', 'outward': 'd3' if ranges else 'd3null',
        'return': 'ret' if ranges else 'retnull'}[phase]
(Path(directory) / ('paint-' + name + '.json')).write_text(result.stdout)
MEASURE
}

CLOSEDIR=${CLOSEDIR:-/tmp/openreader-duosim-01/beta18-final-01/d2/frameclose}
ORACLE="$AREA/duo-loop-verdict.py"
now_ms(){ python3 -c 'import time; print(time.time_ns() // 1000000)'; }
control(){
  note "control: $1 $2"
  python3 "$ORACLE" control "$RUN/cycle-$CYCLE" "$1" "$2"
  return 2
}
settle_height(){
  local h
  for _ in $(seq 1 16); do h=$(dims_height); [ "$h" = "$1" ] && return 0; sleep 0.5; done
  return 1
}
checkpoint(){ # phase; only called after successful input/settle
  local phase=$1 tag image floor ceiling
  case "$phase" in baseline) tag=press;; outward) tag=d3;; return) tag=return;; esac
  floor=$(now_ms)
  sel_probe "$RUN/cycle-$CYCLE/selection-$tag.txt" || { control "$phase" "selection answer missing"; return 2; }
  lookup_state "$RUN/cycle-$CYCLE/state-$tag.json" || { control "$phase" "lookup state failed"; return 2; }
  ceiling=$(now_ms)
  libhash > "$RUN/cycle-$CYCLE/library-$phase.txt"
  if [ "$phase" = baseline ]; then
    image="$RUN/cycle-$CYCLE/painted-press-outer.png"
    xcrun simctl io "$UDID" screenshot "$image" > "$RUN/cycle-$CYCLE/baseline.capture.log" 2>&1 \
      || { control "$phase" "baseline capture failed"; return 2; }
  else
    restricted_capture "$tag" || { control "$phase" "restricted capture failed"; return 2; }
    if [ "$phase" = outward ]; then image="$RUN/cycle-$CYCLE/d3-inner-oriented.png"
    else image="$RUN/cycle-$CYCLE/return-outer.png"; fi
  fi
  measure_paint "$phase" "$image" "$RUN/cycle-$CYCLE/selection-$tag.txt" \
    || { control "$phase" "paint measurement failed"; return 2; }
  python3 "$ORACLE" phase "$RUN/cycle-$CYCLE" "$phase" "$BASELIB" "$floor" "$ceiling"
}
read_diagnostics(){
  local before; before=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
  node $KIT/hx.cjs "$UDID" '{}' --code-file "$AREA/selection-diagnostics.js" >/dev/null 2>&1
  diag_answer "$before" "$RUN/cycle-$CYCLE/diag-$1.txt" \
    || note "$1 diagnostics unavailable (recorded; no causal trace at this checkpoint)"
}
run_cycle(){
  local h local_lb presspoint phase_status
  h=$(dims_height)
  if [ "$h" != 678 ]; then
    RECEIPT_DIR="$RUN/cycle-$CYCLE" bash "$AREA/duo-fold-input.sh" closed > "$RUN/cycle-$CYCLE/pose-fold.log" 2>&1 \
      && settle_height 678 || { control baseline "pose normalize failed"; return 2; }
  fi
  lookup_state "$RUN/cycle-$CYCLE/pre-state.json" || { control baseline "pre-state failed"; return 2; }
  if [ "$(state_field "$RUN/cycle-$CYCLE/pre-state.json" "(d['selection'],d['result'],d['gate'],d['traffic'])==(None,None,None,None)")" != True ]; then
    cleanup_cycle || { control baseline "could not reach clean lookup"; return 2; }
  fi
  bash $KIT/silence.sh set "$UDID" >/dev/null 2>&1 && bash $KIT/silence.sh check "$UDID" >/dev/null 2>&1 \
    || { control baseline "silence check failed"; return 2; }
  local_lb=$(wc -l < "$METRO_LOG" 2>/dev/null || echo 0)
  node $KIT/hx.cjs "$UDID" '{}' --code-file "$AREA/duo-hoperect.js" >/dev/null 2>&1 \
    && hq_answer "$local_lb" "$RUN/cycle-$CYCLE/hoperect.txt" '"rect"' \
    && grep -q '"viewport":\[382,678\]' "$RUN/cycle-$CYCLE/hoperect.txt" \
    || { control baseline "missing hoperect / not closed pose"; return 2; }
  presspoint=$(python3 - "$RUN/cycle-$CYCLE/hoperect.txt" <<'POINT'
import json, sys
from pathlib import Path
r = json.loads(Path(sys.argv[1]).read_text().split('HX PROBE ', 1)[1])['rect']
x, y, w, h = r
print('%d %d 466 678' % (round(x + w / 2), round(y + h / 2)))
POINT
) || { control baseline "press point derivation failed"; return 2; }
  printf '%s\n' "$presspoint" > "$POINTFILE"
  node $KIT/cdp.cjs --eval "$AREA/DuoAcceptanceLookupTraffic.js" "$METRO" \
    > "$RUN/cycle-$CYCLE/traffic-arm.txt" 2>&1 \
    && grep -qi armed "$RUN/cycle-$CYCLE/traffic-arm.txt" \
    || { control baseline "traffic arm failed"; return 2; }
  if ! bash $KIT/run-probe.sh LookupFoldPressProbe "$UDID" "$PRESSDIR" \
    -only-testing:LookupFoldPressProbe/testLongPressHope -collect-test-diagnostics never \
    > "$RUN/cycle-$CYCLE/press.log" 2>&1; then
    restage || note "restage failed (control remains incomplete)"
    control baseline "native press failed (runner may terminate app)"; return 2
  fi
  sleep 1.5
  checkpoint baseline || return $?
  read_diagnostics baseline
  RECEIPT_DIR="$RUN/cycle-$CYCLE" bash "$AREA/duo-fold-input.sh" open > "$RUN/cycle-$CYCLE/fold-open.log" 2>&1 \
    && settle_height 669 || { control outward "outward input/settle failed"; return 2; }
  sleep 3
  phase_status=0
  checkpoint outward || phase_status=$?
  read_diagnostics d3 # retain the read-only trace even on RED; never change its verdict
  [ "$phase_status" = 0 ] || return "$phase_status"
  # Return only after the SAME qualified outward range/task/result/count/store/paint.
  RECEIPT_DIR="$RUN/cycle-$CYCLE" bash "$AREA/duo-fold-input.sh" closed > "$RUN/cycle-$CYCLE/fold-closed.log" 2>&1 \
    && settle_height 678 || { control return "return input/settle failed"; return 2; }
  sleep 3
  phase_status=0
  checkpoint return || phase_status=$?
  read_diagnostics return
  return "$phase_status"
}

CYCLE=0
BASELIB=$(libhash)
note "red-loop start pin=$PIN max=$MAX_CYCLES baselineLibrary=$BASELIB"
while :; do
  CYCLE=$((CYCLE+1))
  mkdir "$RUN/cycle-$CYCLE" || exit 2
  note "----- attempted cycle $CYCLE"
  run_cycle || true # verdict was retained by the shared oracle, never shell status alone
  cleanup_status=0
  cleanup_cycle > "$RUN/cycle-$CYCLE/cleanup.log" 2>&1 || cleanup_status=$?
  python3 "$ORACLE" cycle "$RUN/cycle-$CYCLE" "$BASELIB" "$cleanup_status" | tee -a "$RUN/loop.log"
  status=0
  python3 "$ORACLE" summary "$RUN" "$MAX_CYCLES" NATIVE || status=$?
  should_stop=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["shouldStop"])' "$RUN/summary.json")
  [ "$should_stop" = True ] && break
  # Two total control-failed cycles stop the loop; success never resets that budget.
done
exit "$status"
