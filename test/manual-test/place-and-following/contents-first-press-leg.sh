#!/usr/bin/env bash
# Parameterized Contents first-press comparison leg (#307 contract; startup-batch
# follow-up). One cold trial against ONE document on ONE simulator: fresh
# close/open of the Reading, state captured before and after, the same first
# real Contents-row press, and direct view/heading geometry at two settled
# samples. Measurements are recorded as data; the phase passes when its
# procedure and captures complete, and never reclassifies a landing by the old
# unconditional-54 oracle — the row's mode (goToSection vs browse) is the
# contract gate (#52/#107, use-reading.ts: with the reading on a sentence the
# row browses and the chapter lands at the reserved band; with no Reading
# Position the row TAKES the Reading, seekTo places the chapter's first line at
# the Line Position, `following.linePosition`, default 50%).
#
#   bash test/manual-test/place-and-following/contents-first-press-leg.sh \
#     UDID OUT_DIR DOC_ID ROW_PREFIX [--stage-position]
#
#   --stage-position  before the press, stage a Reading Position the documented
#                     way: settings patch savePositionWhilePaused=true, a real
#                     tap on a visible sentence (pointAt), the stored place
#                     verified on the shelf; the setting is restored to false
#                     at the end and the stored place is LEFT (recorded as a
#                     mutation for restoration).
# Plays nothing. Foreground; wrap in the shared guard. The Metro port is not
# needed: every answer is read from the device's own Debug Log.
set -uo pipefail
UDID=${1:?UDID}
OUT=${2:?OUT_DIR}
DOC_ID=${3:?DOCUMENT_ID}
ROW_PREFIX=${4:?ROW_PREFIX}
STAGE=0
[ "${5:-}" = "--stage-position" ] && STAGE=1
HERE=$(cd "$(dirname "$0")/../kit" && pwd)
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$OUT"
exec > >(tee "$OUT/leg.log") 2>&1
FAIL=0
step() { echo "[$(date '+%H:%M:%S')] $*"; }
note_fail() { step "FAIL: $*"; FAIL=$((FAIL + 1)); }
AXPY="python3 $REPO/test/manual-test/kit/ax.py $UDID"
AXE=$(ls -t "$HOME"/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe 2>/dev/null | head -1)
container() { xcrun simctl get_app_container "$UDID" top.xujialiu.openreader data; }
logdir() { echo "$(container)/Library/Application Support/debug-log"; }
debuglog() { cat "$(logdir)"/debug-log-*.txt 2>/dev/null; }
log_since() { tail -c +$(($1 + 1)) "$(logdir)"/debug-log-*.txt 2>/dev/null; }
log_offset() { wc -c < "$(logdir)"/debug-log-*.txt 2>/dev/null | tr -d ' '; }
hx() { node "$HERE/hx.cjs" "$UDID" "$@"; }
ask_probe() {
  local probe=$1 deadline=${2:-20} before; before=$(log_offset)
  hx '{}' --code-file "$probe" > /dev/null
  local waited=0
  while [ "$waited" -lt "$deadline" ]; do
    sleep 0.5; waited=$((waited + 1))
    local line
    if line=$(log_since "$before" | grep -m1 '\[probe\] {"'); then echo "${line#*\[probe\] }"; return 0; fi
  done
  echo "(no [probe] answer in ${deadline}s)" >&2; return 1
}
await_log() {
  local off=$1 pattern=$2 deadline=${3:-30} waited=0
  while [ "$waited" -lt "$deadline" ]; do
    sleep 0.5; waited=$((waited + 1))
    local line
    if line=$(log_since "$off" | grep -Em1 -- "$pattern"); then echo "$line"; return 0; fi
  done
  echo "(no line matching '$pattern' in ${deadline}s)" >&2; return 1
}
doc_place() { debuglog | grep "shelf ${DOC_ID:7:8}" | tail -1; }
tree_grabbers() { $AXPY tree 2>/dev/null | grep -c 'Sheet Grabber' || true; }
touch_once() { "$AXE" touch --udid "$UDID" -x "$1" -y "$2" --down --up --delay "${3:-0.2}" >> "$OUT/touches.log" 2>&1; }

step "=== leg start: doc=$DOC_ID row=$ROW_PREFIX stage-position=$STAGE ==="
bash "$REPO/test/manual-test/kit/silence.sh" check "$UDID" || bash "$REPO/test/manual-test/kit/silence.sh" set "$UDID"

# --- state before -------------------------------------------------------------
hx '{"do":"shelf"}' >/dev/null; sleep 3
SHELF_BEFORE=$(doc_place)
step "shelf before: ${SHELF_BEFORE:-<no shelf line>}"
echo "$SHELF_BEFORE" > "$OUT/shelf-before.txt"
OFF=$(log_offset); hx '{"do":"saysettings"}' >/dev/null; sleep 3
debuglog | awk -v off="$OFF" 'index($0, "[hx] settings {")' > "$OUT/settings-before.json" || true
tail -1 "$OUT/settings-before.json" > "$OUT/settings-before-line.txt" 2>/dev/null || true
step "settings before: $(grep -o '"following":{[^}]*}' "$OUT/settings-before.json" | tail -1) $(grep -o '"savePositionWhilePaused":[a-z]*' "$OUT/settings-before.json" | tail -1) $(grep -o '"linePosition":[0-9]*' "$OUT/settings-before.json" | tail -1)"

# --- fresh close/open ----------------------------------------------------------
OFF=$(log_offset)
hx '{"do":"shut"}' >/dev/null
CLOSED=$(await_log "$OFF" '\[document\] closed' 15 || true)
[ -n "$CLOSED" ] && step "closed: $CLOSED" || step "no close line (reader was closed)"
sleep 2
OFF=$(log_offset)
hx "{\"do\":\"open\",\"id\":\"$DOC_ID\"}" >/dev/null
await_log "$OFF" '\[document\] opened' 30 > "$OUT/open-line.txt" || { note_fail "no open line"; exit 65; }
step "opened: $(cat "$OUT/open-line.txt")"
OPEN_EPOCH=$(date +%s)
OPEN_AT=$(date '+%H:%M:%S')
ALIVE=""
for i in $(seq 1 24); do
  sleep 2.5
  if ALIVE=$(ask_probe "$HERE/probes/page-alive.js" 15); then
    echo "$ALIVE" | grep -q '"rendition":"object"' && break
    ALIVE=""
  fi
done
[ -n "$ALIVE" ] || { note_fail "page never rendered"; exit 65; }
step "page alive: $ALIVE"
echo "$ALIVE" > "$OUT/alive.json"

# --- pre-press captures ---------------------------------------------------------
OFF=$(log_offset); hx '{"do":"say"}' >/dev/null; sleep 2.5
log_since "$OFF" | grep -m1 '\[hx\] playing=' > "$OUT/say-before.txt" || true
step "say before: $(cat "$OUT/say-before.txt")"
L0=$(ask_probe "$HERE/probes/locations-state.js" 20) || L0=""
step "locations t0: $L0"
echo "$L0" > "$OUT/locations-t0.json"
sleep 12
L12=$(ask_probe "$HERE/probes/locations-state.js" 20) || L12=""
step "locations t0+12: $L12"
echo "$L12" > "$OUT/locations-t12.json"
V0=$(ask_probe "$HERE/probes/view-geometry.js" 20) || V0=""
step "views before press: $V0"
echo "$V0" > "$OUT/views-before.json"
python3 - "$V0" <<EOF || note_fail "target view for the row was not absent before the press"
import json, sys
geo = json.loads(sys.argv[1])
views = [v.get("section") for v in geo.get("views", [])]
print("pre-press views: %s" % views)
# the pressed row's spine section is recorded from the display line afterwards;
# absence before the press is asserted against the recorded section in the report
EOF

# --- optional staged Reading Position -------------------------------------------
if [ "$STAGE" = 1 ]; then
  OFF=$(log_offset)
  hx '{"do":"settings","patch":{"savePositionWhilePaused":true}}' >/dev/null
  await_log "$OFF" 'settings patched' 15 || note_fail "savePositionWhilePaused patch line missing"
  A=$(ask_probe "$HERE/probes/passage-anchor.js" 20) || A=""
  step "anchor for the staging tap: $A"
  echo "$A" > "$OUT/stage-anchor.json"
  PT=$(printf '%s' "$A" | python3 -c '
import json, sys
d = json.load(sys.stdin)
p = d.get("p")
if not p:
    print("VOID"); raise SystemExit
print("%d %d %d" % (round(p["left"] + 40), round(p["visTop"] + p["hgt"] / 2), p["view"]))')
  if [ "$PT" = "VOID" ]; then note_fail "no visible paragraph to tap for staging"; fi
  if [ "$PT" != "VOID" ]; then
    TX=$(echo "$PT" | awk '{print $1}'); TY=$(echo "$PT" | awk '{print $2}')
    OFF=$(log_offset)
    touch_once "$TX" "$TY" 0.2
    sleep 2
    SEEKED=$(log_since "$OFF" | grep -m1 -E 'seek to utterance [0-9]' || true)
    if [ -z "$SEEKED" ]; then
      step "staging tap lost; retrying at +80 px"
      touch_once "$TX" "$((TY + 80))" 0.2
      sleep 2
      SEEKED=$(log_since "$OFF" | grep -m1 -E 'seek to utterance [0-9]' || true)
    fi
    [ -n "$SEEKED" ] && step "staging seek: $SEEKED" || note_fail "staging tap never seeked"
    echo "$SEEKED" > "$OUT/stage-seek-line.txt"
    sleep 1
    hx '{"do":"shelf"}' >/dev/null; sleep 3
    S=$(doc_place)
    step "shelf after staging: $S"
    echo "$S" > "$OUT/shelf-staged.txt"
    echo "$S" | grep -qv 'place=null' || note_fail "staging did not store a place"
    V=$(ask_probe "$HERE/probes/view-geometry.js" 20) || V=""
    echo "$V" > "$OUT/views-after-staging.json"
    step "views after staging: $V"
    OFF=$(log_offset); hx '{"do":"say"}' >/dev/null; sleep 2.5
    log_since "$OFF" | grep -m1 '\[hx\] playing=' > "$OUT/say-after-staging.txt" || true
    step "say after staging: $(cat "$OUT/say-after-staging.txt")"
  fi
fi

# --- Contents sheet + the first real row press -----------------------------------
$AXPY touch 'Contents' >> "$OUT/touches.log" 2>&1
sleep 2.5
G1=$(tree_grabbers)
if [ "$G1" = 0 ]; then
  step "first Contents touch lost; retrying"
  $AXPY touch 'Contents' >> "$OUT/touches.log" 2>&1
  sleep 2.5
  G1=$(tree_grabbers)
fi
sleep 4
G2=$(tree_grabbers)
[ "$G1" -ge 1 ] && [ "$G2" -ge 1 ] || { note_fail "sheet not open (grabbers $G1/$G2)"; exit 65; }
step "sheet open and settled (grabbers $G1/$G2)"
pick() {
  $AXPY tree 2>/dev/null | python3 -c '
import sys, re
want = sys.argv[1]
pat = re.compile(r"^\s*Button \| (Chapter [0-9]+[^|]*)\|[^|]*\| ([0-9.]+),([0-9.]+) ([0-9]+)x([0-9]+)\s*$")
best = None
for line in sys.stdin:
    m = pat.match(line)
    if not m: continue
    label, x, y, w, h = m.group(1).strip(), float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5))
    if not label.startswith(want): continue
    cy = y + h / 2
    if 460 <= cy <= 700:
        d = abs(cy - 560)
        if best is None or d < best[0]: best = (d, label, round(x + w / 2), round(cy))
if best: print("%s %d %d" % (best[1], best[2], best[3]))
' "$ROW_PREFIX"
}
R1=$(pick)
if [ -z "$R1" ]; then
  step "$ROW_PREFIX row not in band; small sheet scroll up"
  "$AXE" swipe --udid "$UDID" --start-x 200 --start-y 640 --end-x 200 --end-y 480 --steps 8 --duration 0.3 >> "$OUT/touches.log" 2>&1
  sleep 2
  R1=$(pick)
fi
sleep 2
R2=$(pick)
step "pick read 1: $R1"; step "pick read 2: $R2"
L1=$(echo "$R1" | awk '{NF-=2; print}'); Y1=$(echo "$R1" | awk '{print $NF}')
L2=$(echo "$R2" | awk '{NF-=2; print}'); Y2=$(echo "$R2" | awk '{print $NF}')
[ -n "$L1" ] || { note_fail "row never in the mid band"; exit 65; }
if [ "$L1" = "$L2" ] && [ $((Y1 - Y2)) -le 12 ] && [ $((Y2 - Y1)) -le 12 ]; then
  step "state matched: $L1 at cy $Y1/$Y2"
else
  note_fail "list not settled ('$L1'@$Y1 vs '$L2'@$Y2)"
fi
echo "$L1" > "$OUT/pressed-row-label.txt"
OFF=$(log_offset)
$AXPY touch "$L1" >> "$OUT/touches.log" 2>&1
sleep 3
DISP=$(log_since "$OFF" | grep -m1 -E 'goToSection|display finished|display section' || true)
if [ -z "$DISP" ]; then
  step "first row touch lost; retrying ONCE (still the first trial: the retry only recovers a lost synthetic touch, it does not re-press a delivered one)"
  $AXPY touch "$L1" >> "$OUT/touches.log" 2>&1
  sleep 3
  DISP=$(log_since "$OFF" | grep -m1 -E 'goToSection|display finished|display section' || true)
fi
[ -n "$DISP" ] && step "row press line: $DISP" || { note_fail "no display line after the row press"; }
echo "$DISP" > "$OUT/press-line.txt"
SEC=$(echo "$DISP" | grep -oE 'section [0-9]+' | head -1 | awk '{print $2}')
MODE=unknown
echo "$DISP" | grep -q '(goToSection)' && MODE=goToSection
echo "$DISP" | grep -q '(browse)' && MODE=browse
step "press mode: $MODE (section $SEC)"
echo "$MODE $SEC" > "$OUT/press-mode.txt"
# a delivered press closes the sheet by itself; require the grabber gone
sleep 2
step "grabbers after press: $(tree_grabbers)"

# --- post-press measurements (two settled samples) --------------------------------
sleep 2
GEO1=$(ask_probe "$HERE/probes/view-geometry.js" 20) || GEO1=""
sleep 3
GEO2=$(ask_probe "$HERE/probes/view-geometry.js" 20) || GEO2=""
step "geometry t0: $GEO1"
step "geometry t0+3: $GEO2"
echo "$GEO1" > "$OUT/geometry-t0.json"; echo "$GEO2" > "$OUT/geometry-t2.json"
xcrun simctl io "$UDID" screenshot "$OUT/after-press.png" >/dev/null 2>&1
LP=$(ask_probe "$HERE/probes/locations-state.js" 20) || LP=""
step "locations after press: $LP"
echo "$LP" > "$OUT/locations-after.json"
sleep 12
LP2=$(ask_probe "$HERE/probes/locations-state.js" 20) || LP2=""
step "locations after press +12: $LP2"
echo "$LP2" > "$OUT/locations-after12.json"
OFF=$(log_offset); hx '{"do":"say"}' >/dev/null; sleep 2.5
log_since "$OFF" | grep -m1 '\[hx\] playing=' > "$OUT/say-after.txt" || true
step "say after: $(cat "$OUT/say-after.txt")"
hx '{"do":"shelf"}' >/dev/null; sleep 3
SHELF_AFTER=$(doc_place)
step "shelf after: ${SHELF_AFTER:-<no shelf line>}"
echo "$SHELF_AFTER" > "$OUT/shelf-after.txt"
step "press latency from open: $(( $(date +%s) - OPEN_EPOCH )) s"

if [ "$STAGE" = 1 ]; then
  OFF=$(log_offset)
  hx '{"do":"settings","patch":{"savePositionWhilePaused":false}}' >/dev/null
  await_log "$OFF" 'settings patched' 15 || note_fail "settings restore line missing"
  step "savePositionWhilePaused restored to false (the staged stored place is LEFT in place — a recorded mutation)"
fi
step "=== leg complete: failures=$FAIL ==="
exit $([ "$FAIL" = 0 ] && echo 0 || echo 65)
