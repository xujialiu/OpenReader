# Duo acceptance controls (#350–#354)

**Preparation, not verification.** No simulator, native compilation, playback or
system-window check ran when these controls were added. Run against the final
parent revision with the default ios-tester, in one admitted lane. Script/host
test success does not close an issue. Do not change the app or its Beta to run
these tests. A genuine new app failure needs its own red, minimized feedback
loop and ranked hypotheses before a repair.

## Phase 0 — admission, provenance and working controls

Read `MEMORY/device-testing.md`, `kit/ios-verification.md`, and the relevant
pitfalls. Use an owned simulator, current SDK27.1 shell, final integrated Metro
bundle and explicit device name/UDID on every call. Keep new attempt paths,
all raw failed logs/images and the tested git SHA, native/Settings version,
launch line, tool versions, device/runtime and active display. Never reuse the
old #346 Beta as current evidence. The old artifacts are read-only controls:
`/tmp/openreader-issue346-native-01/pending-result-b14.json` proves one response
released at4267ms, not visible output. The old DOM range pair proves boundaries,
not painting. Parent #348/#349 fold/rotation artifacts calibrate tool behavior,
not today's pose, coordinates or platform window support.

Inside the single admitted phase:

```sh
# Variables refer to THIS tester's resources, never another session's device.
# OUT is a new external attempt directory; METRO_LOG is its owned raw Metro log.
python3 test/manual-test/kit/ios_ready.py "$UDID" "$OUT/readiness" \
  --timeout 20 --metro "$METRO"
export UDID OUT OPENREADER_DEVICE="$DEVICE_NAME" OPENREADER_METRO="$METRO"
# The reader must be mounted, not merely the Library/CDP connection.
node test/manual-test/kit/reading.cjs state
```

The existing `reading.cjs` helper requires exactly one OpenReader on its Metro
(it does not honor the device-name filter). Use the owned single-target Metro;
a refusal on an ambiguous Metro is not a failed Reading assertion.

Obtain a clean active-display image and live native window/safe-area/WebView
geometry using the existing diagnostics/real-input driver. Capture display1
(outer) or3 (inner), not an assumed `XCUIScreen.main`. For the #350 loop, capture only owned XCTest screens0/1 with the
fresh restricted-v2 marker and exactly two attachments; never capture a host
Mac screen. Identify the actually rendered display in the report. Keep GUI/AX, LLDB, native input and screenshot operations serial.
Never keep LLDB attached during a timed lookup or audio run: that pauses the
app and invalidates the measurement. Use the parent's #357/#358 diagnostic
controls rather than adding another debugger/volume workaround here.

Stage the intended Document and permitted dictionary/Provider/Voice. For lookup,
first demonstrate a normal request and an actual parsed visible definition;
answer Consent for the correct recipient. Close that Drawer and require an
empty DOM selection before each fresh lookup. For speech, first demonstrate
real audio and real Word Timings; `playing=true`, a spinner, monotone IDs or a
fake silent Provider without timings is not a working control. If any working
control fails, stop its dependent cases as BLOCKED.

Prebuild native probes before timed tests. `run-probe.sh` accepts `--mode` as a
string in the generated probe Info.plist; this avoids unreliable environment
forwarding. For `DuoAcceptanceLookupProbe` that string is an **absolute external
JSON path**, not inline JSON. Always use exactly one `-only-testing` method.
Use `-collect-test-diagnostics never`. A failed runner may terminate the app;
re-stage and re-establish the control, rather than treating the next empty
screen as a second app failure. Preserve every attempt. One recorded readiness
recovery at most, shared across the lane.

## Phase 1 — visible selection and native handles (#350)

Use a real native long press, not `Selection.addRange`, on a word above the
lookup Drawer's opening edge. Reuse `lookup-word-frame.js` and
`LookupFoldPressProbe` for calibration/press, or a verified native input channel.
The Drawer must not obscure either handle. If it does, change the initial
passage before a new attempt; do not scroll/tap/reselect after the fold and
then claim the original range remained visible.

Arm the nonholding passthrough counter (never stack it with the pending gate,
`watchfetch`, `breakfetch` or another fetch wrapper):

```sh
node test/manual-test/kit/cdp.cjs --eval \
  test/manual-test/duo-verification/DuoAcceptanceLookupTraffic.js "$METRO"
# Native long press, settle the normal result, then snapshot both seams:
node test/manual-test/kit/hx.cjs "$UDID" '{}' --code-file \
  test/manual-test/duo-verification/DuoAcceptanceSelection.js
node test/manual-test/kit/cdp.cjs --eval \
  test/manual-test/duo-verification/DuoAcceptanceLookupState.js "$METRO" \
  > "$OUT/selection-before-state.json"
```

Retain the tagged `[probe]` selection answer and active-display image. Make one
actual fold with the existing verified Device Hub input. Repeat both snapshots
and image after native reflow settles (bound it at8s, as in the existing driver).
Require equal section, exact range CFI, direction (`backward`) and selected text; compare
text-node offsets as corroboration. The native image must show the selected
text painted, both handles exposed and the same lookup task. Count must remain
N, not N+1. Do a return transition separately, also requiring unchanged count.

For a real handle adjustment, screenshot-calibrate the actual **native WebView
frame** and handle/destination in screen points after the fold. Do not use the
Duo's stale portrait `app.frame`, DOM rects as native handle locations, or old
fractional coordinates. Write this external config (numbers/text below are
schema descriptions, not usable coordinates):

- `runID`: unique nonsecret token; `query`: current exact query.
- `webViewFrame`: `[x,y,width,height]` from the native element.
- `handle`, `destination`: `[x,y]` from the visible handle and intended endpoint.
- `changedQuery`: exact expected selected text after that one drag.

```sh
bash test/manual-test/kit/run-probe.sh DuoAcceptanceLookupProbe "$UDID" \
  "$OUT/native-lookup" --mode "$OUT/handle.json" \
  -only-testing:DuoAcceptanceLookupProbe/testNativeHandleDrag \
  -collect-test-diagnostics never
```

Immediately repeat the range/state snapshots. Require a genuinely changed CFI
and query, the same task, **exactly one** new request for the deliberate change,
and no additional request through a2s quiet window (180ms release debounce plus
multiple settled polls). The counter covers dictionary and translation routes,
so a phrase's automatic mode switch is not missed. Correlate the query/mode
with the app's `[lookup]` request log; no credentials are captured by the counter.
An error/404 for the deliberately changed text is not a handle failure, but
must not be described as a displayed successful definition. Keep native before/
after images; an unchanged query is a failed input/control, not a passed drag.

In `finally`, evaluate an external file containing this expression through CDP:
`globalThis.__duoAcceptanceLookupTraffic?.restore()`. Restore before Phase2.

## Phase 2 — one held real lookup, actual fold, parsed and visible (#351)

`duo-pending-lookup.cjs` reuses the existing real Free Dictionary response gate.
It holds **delivery of an already received response**, not a delayed network.
It does not substitute JSON, extend the app's15s timeout, or supply a fixture
result. Its device-filtered CDP calls read real state. Keep the same gate
installed through native capture so the final count includes late duplicates.

Prepare two external, bounded scripts under this attempt:

1. `verified-fold.sh`: confirm the owned Device Hub window and current pose,
   send one real fold/unfold input, retain its system-input receipt. No app
   relaunch, geometry injection, debugger attach or expensive result export.
   It must finish within6.5s; parent native diagnostics bracket the timed run.
2. `assert-definition.sh CONFIG`: wait at most30s for the joined press probe's
   successful result-export receipt (abort on its failure). **Never overlap two
   XCTest sessions on the device.** Folding/parsed delivery must not wait for
   that export, but the subsequent native result assertion must. Then invoke:
   `exec bash test/manual-test/duo-verification/duo-visible-definition.sh "$UDID" "$OUT/native-lookup" "$1"`.
   Reuse the prebuilt native-probe directory. The adapter requires exactly one
   passing test and this run's exported definition receipt/screenshots, not
   optional print output or a helper that merely exits zero. Retain raw XCTest
   results. Do not scroll/expand, change the query or retry to make it visible.

The native wrapper can be written directly under the fresh attempt directory:

```sh
cat > "$OUT/assert-definition.sh" <<'SH'
set -euo pipefail
python3 - "$OUT" <<'PY'
from pathlib import Path
import sys, time
out = Path(sys.argv[1]); end = time.monotonic() + 30
while not (out / 'press-export.passed').is_file():
    if (out / 'press-export.failed').exists() or time.monotonic() >= end:
        raise SystemExit('BLOCKED: native press/result export did not succeed')
    time.sleep(.05)
PY
exec bash test/manual-test/duo-verification/duo-visible-definition.sh \
  "$UDID" "$OUT/native-lookup" "$1"
SH
```

Inside the guarded foreground phase, start the coordinator as a joined child:

```sh
node test/manual-test/duo-verification/duo-pending-lookup.cjs \
  "$DEVICE_NAME" "$METRO" "$OUT/verified-fold.sh" \
  "$OUT/assert-definition.sh" "$OUT/pending-01" &
COORDINATOR=$!
python3 - "$OUT/pending-01/gate.ready" <<'PY'
from pathlib import Path
import sys, time
end = time.monotonic() + 10
while not Path(sys.argv[1]).is_file():
    if time.monotonic() >= end:
        raise SystemExit('BLOCKED: no gate.ready within10s')
    time.sleep(.05)
PY
# The outer-pose point file must already be freshly calibrated.
(
  if bash test/manual-test/kit/run-probe.sh LookupFoldPressProbe "$UDID" \
    "$OUT/native-press" -only-testing:LookupFoldPressProbe/testLongPressHope \
    -collect-test-diagnostics never; then
    touch "$OUT/press-export.passed"
  else
    touch "$OUT/press-export.failed"
    exit 1
  fi
) &
PRESS=$!
status=0
wait "$COORDINATOR" || status=$?
wait "$PRESS" || status=$?
# In a foreground phase script: exit "$status". Its guard/trap owns cancellation.
# Never wait for press export before allowing the coordinator's fold/parse.
```

The cold press setup budget is120s; it does not start the request deadline.
After real request start: require held response age<=2.5s at fold start, actual
app window dimension change within the action's6.5s plus2s settle budget,
release<12s, and parsed state observed<15s. The parser/native config is derived
from the actual `LookupDrawer.result.text`, not a separately requested service
answer. A substantial definition line, matching selected query, no spinner or
error, exactly one released/non-aborted request and no stacked traffic observer
are required. The native method requires the query and that definition in
hittable native Text; its **active-display image must additionally show the
exact definition excerpt**, not merely query, Copy, source or a spinner.

`report.json` retains before/after windows, gate timestamps, parsed state,
native subprocess result, final query/result/count and wrapper restoration.
Its success status deliberately ends `VISUAL_REVIEW_PENDING`: inspect the
image and explicitly accept/reject it. Native capture can occur after15s, but
the parsed-result observation must be inside the original deadline. If the
instrument/control itself overruns, report CONTROL_INCOMPLETE, not a fold bug.
A native-test failure that terminates the app can prevent fetch restoration;
retain `cleanupError`, discard diagnostic globals by controlled restaging, and
re-establish the working control before proceeding.

## Phase 3 — actual system split/resized windows (#352)

First record supported operations on this runtime/device, from **actual system
UI**, not plist flags or changed dimensions. Capture the system window menu,
resize affordance and one permitted operation (or its actual refusal/absence).
Distinguish split alongside another app, free resize, and full-screen-only.
Do not presume Duo has iPad Stage Manager or that a fold is split. Mark each
operation SUPPORTED / UNSUPPORTED / BLOCKED with the system evidence. If none
is permitted, retain that explicit platform result; other-platform/iPad controls
and injected geometry do not complete Duo split-window verification.

For each permitted distinct window mechanism, record a real narrower/wider
round trip with measured native bounds, current safe areas, page viewport,
stage and **every live displayed iframe** (`viewport-size.js`; existing native
driver/diagnostics). No forced scene geometry or dimension mocks. Use fresh
screenshot-derived system-handle points; `ipad-window.md` documents units and
pitfalls, not a promise that those iPad controls exist on Duo.

Run these bounded states serially, not all Drawers stacked together:

- Paused Browsing: choose a long real passage away from the last spoken
  sentence. Capture an exact upper **visible** character below the header.
  Reuse `resize-anchor.js`, seeding its retained `{cfi,section}` with that
  visible character if the raw viewport start is under the header. Measure
  the SAME CFI after each resize; it must remain at the upper visible edge
  (within two measured line heights), not merely somewhere on the page.
- Save independent `library.json` positions including Stamp before/after,
  not just cursor/Utterance or top-level settings keys. Paused resize, browse,
  Drawer opening/closure and edits must not create a speech-owned position.
  `reading.cjs state` must remain paused. Establish two identical saved-position
  snapshots after earlier speech/Pause writeback has settled before injecting
  layout; a pending prior speech write is not a layout-caused write. Copy only
  to the external attempt; never put private documents/credentials in Git.
- Repeat with Contents and Appearance separately at opening/expanded detents;
  require the same task/detent, reachable controls, dismissal and exposed
  Document preview. Check narrow Player controls and return-to-reading.
- Completed lookup: selected range/result preserved, no layout-only request.
  Pending lookup: reuse the real held gate with that **system resize** action,
  release inside12s and observe parsed+native result as in Phase2. Label this
  resized-window case separately; it is not the required fold control.
- Benign unsaved editing in the Library (e.g. Create Folder with a nonword
  token): capture exact text, caret/selection and keyboard state; resize,
  use `DuoCaretTypeProbe/testTypeAtExistingCaret` without refocusing, and assert
  exact insertion at the prior caret from the native field. Cancel; create no
  saved object. That probe's `done` print alone proves no caret/text outcome.
- Playing Following and playing Browsing are Phase4 controls. For Browsing,
  deliberately keep speech in a distant section so automatic recovery when
  the spoken line becomes visible cannot masquerade as a lost browse. A
  changing speech-owned Reading Position is expected ONLY for actually heard
  new speech, never for the resized/Browsing passage.

## Phase 4 — real audio progression and word-timed Following (#353)

**Required separate output gate:** the kit's host queue/WSOLA waveform tests
replace iOS scheduling and cannot prove this. `correct.elapsedMs` is a useful
real native-source coordinate delivered through the bridge, but is not an
independent measurement of rendered PCM. No reusable iOS app-output PCM capture
through a display change was found in the kit during preparation. If ios-tester
has no owned-target, pre-device-gain output capture compatible with simulator
volume0, mark sample continuity BLOCKED and escalate the missing method. Never
unmute the simulator/Mac, replace narration with a tone/new graph, or call
source-clock monotonicity sample proof. Microphone/video sound at volume0 is
not a positive audio control. No new permanent app instrumentation is authorized
by this recipe.

With an admitted independent output method, retain real rendered samples from
the existing Reading graph, source clip/Word Timings and time base. Establish a
working no-change positive control first; verify the analyser rejects a known
removed/repeated interval in an **external copy** of that capture (not an app
mutation). Compare actual output content before/during/after the change, not
only counters. Record any output silence, restart, skip or repeated interval
with source and wall times. Source-to-output/word mismatches approaching100ms
need review (ADR0005 requires well under100ms); do not invent a new tolerance
or silently average over a transition. Any uncertain capture/matching window
is BLOCKED, not continuous audio.

For the complementary word/placement observation:

```sh
node test/manual-test/kit/hx.cjs "$UDID" '{}' --code-file \
  test/manual-test/duo-verification/DuoAcceptanceWordTrace.js
# Retain armed startedAt. Immediately before EACH Play, including this one:
bash test/manual-test/kit/silence.sh set "$UDID" && \
  bash test/manual-test/kit/silence.sh check "$UDID" && \
  node test/manual-test/kit/reading.cjs play-for 8 "$UDID"
```

Run `play-for` as a joined child alongside the one calibrated native transition,
not as a blocking step followed by a resize of an already paused Reading. Its
in-app watchdog and host `finally` both pause. Retain the silence receipts,
Play/Pause timestamps and post-state; if Pause is unconfirmed stop natively.
Derive8s as <=2s working cue + <=4s calibrated transition + >=2s after-change
words. If that action cannot fit, pre-calibrate it; do not pad playback while
reading trees or collecting results. Stop earlier as soon as the asserted fact
is established. The trace self-stops/restores the dispatcher at10s; it never
starts/stops audio itself. A paused initial state and an enabled working
Provider are mandatory; replaying a cached clip is acceptable only with its
actual source samples and Word Timings known.

The observer records real speak/Word Timing arrays, correct/hold messages and
20Hz actual CSS-highlight Range text/CFI/rects plus stage size/scroll. It does
not synthesize timings, change dispatch results or write a Reading Position.
Require no recorder error/overflow, sufficient samples on both sides, real
nonempty Word Timings and actual highlighted-word changes. Inspect the maximum
frame gap; sampling is not a sub50ms certificate and a dropped interval cannot
be called passing timing evidence. Pair with active-display native images or a
bounded display recording proving that the CSS range actually paints.

After playback is paused and the10s observer deadline has expired:

```sh
node test/manual-test/kit/hx.cjs "$UDID" '{}' --code-file \
  test/manual-test/duo-verification/DuoAcceptanceWordTraceRead.js
# STARTED_AT is the exact armed receipt, not a guessed latest run.
python3 - "$METRO_LOG" "$STARTED_AT" "$OUT/word-trace.json" <<'PY'
import json
from pathlib import Path
import sys
decoder = json.JSONDecoder(); matches = []
for line in Path(sys.argv[1]).read_text().splitlines():
    if 'HX PROBE ' not in line:
        continue
    try:
        value, _ = decoder.raw_decode(line.split('HX PROBE ', 1)[1].lstrip())
    except ValueError:
        continue
    if isinstance(value, dict) and value.get('marker') == 'DuoAcceptanceWordTrace-v1' and value.get('startedAt') == int(sys.argv[2]):
        matches.append(value)
if not matches or any(value != matches[0] for value in matches):
    raise SystemExit('BLOCKED: missing/truncated/ambiguous full raw trace; no new playback needed to re-export')
with Path(sys.argv[3]).open('x') as target:
    json.dump(matches[0], target, indent=2)
PY
# Device Debug Log truncates at2KB; preserve the owned raw Metro log instead.
node test/manual-test/kit/hx.cjs "$UDID" '{}' --code-file \
  test/manual-test/duo-verification/DuoAcceptanceWordTraceClear.js
node test/manual-test/kit/reading.cjs state
```

Use By line and a measured nondefault Line Position first. Target is
`stage.top + barReserved + (stage.height - barReserved - openPlayer) * share`,
using current actual reserved header and open-player-without-notes measurements,
not arbitrary whole-screen fractions. Compare the actual word line's midpoint
before/after settled reflow; keep the actual error and settle duration. For
Continuous, the deliberate word-progress lead puts the line above that target;
compare with its lead/line-pitch behavior, not By line's resting equality.
Return/M must preserve Word Timings without restarting the Clip. Layout-only
no-write checks use paused pairs and complete saved positions/Stamps; playing
writes must agree with actual heard speech, not merely a relocated highlight.

Minimum matrix: outer↔inner real fold, fixed-inner real rotation, and each
permitted system-window mechanism. For each use a paused no-write pair and a
bounded playing Following case. Add one playing Browsing fold and supported
window resize, and one Continuous fold control. Do not infer physical Duo,
Mac or long-run drift acceptance from these short simulator intervals.

## Phase 5 — registered Appearance opening and reversible change (#354)

At outer upright, inner upright and inner sideways (plus a genuinely supported
narrow window), pause, leave the same exposed passage and unchanged Appearance,
close all Drawers and dismiss selection/callouts/Debug banners. Capture an
active-display **before-opening** PNG, native window/header geometry, saved
Appearance and same visible-character CFI/rect. Open Appearance with real native
More actions→Appearance taps; do not expand it. After animation settles (<=2s),
capture the **opened** PNG and identical checkpoints. The same exposed glyphs
and adjacent blank Document background must remain visible above the Drawer.
Do not sample the material/blur/shadow edge, the Drawer itself, status controls,
a newly exposed paragraph or a part hidden behind it. If no useful region is
left, report occlusion/unreadability rather than dimming.

Write an external pair JSON with `before`/`opened` objects containing
`passageCFI`, full `appearance`, actual `window`, `pose`, `region`, `paused:true`
and `appearanceOpen:false`/`true`; `cropPixels` is the same `[x,y,width,height]`
in both **oriented active-display images**. Document the crop's glyphs and
background and screenshot scale; no guessed3x conversion or automatic align.
Metadata equality alone is not registration: review the actual glyph shapes/
positions and the independent same-CFI/style observations first.

```sh
python3 test/manual-test/duo-verification/duo-preview-compare.py \
  "$OUT/before.png" "$OUT/opened.png" "$OUT/pair.json" > "$OUT/pixel-diff.json"
```

Exit0 means identical pixels in that registered crop, not full UI acceptance.
Exit1 means different pixels requiring review, **not automatically dimming**;
retain signed/absolute deltas and distinguish motion, antialiasing, occlusion,
blur and a true overlay. Exit2 means an invalid pair. Use a new properly
registered control instead of changing thresholds to pass. Then make a real,
visible Font Size change through native stepper taps, capture its useful live
Document preview and computed style, restore the exact original value and
capture again. Restore Font/Font Size/Margins/alignment/Theme to their baseline.
Those change/restore images are separate controls and cannot replace the
closed→opened pair. Verify task/Reading Position integrity and clean final
paused controls after closing Appearance.

## Results and cleanup

For each issue/pose/window/state retain: PASS / FAIL / BLOCKED / UNSUPPORTED,
tested SHA/version, exact native input, before/after state/range/count, active
images and timed assertions. Describe a failure's actual symptom, not a nearby
instrument refusal. Count one current native result only; synthetic host tests
are labeled HOST throughout. Parent accepts the measurements; leave issues
open until their native evidence and limits are reviewed.

Always pause, restore the fetch observer/gate and word dispatcher, delete this
attempt's calibration files/harness command (after preserving its receipt),
restore any setting/unsaved edit and frontmost-app state, and leave the latest
app paused on a clean screen. Record all ports/PIDs/devices/output paths
started by the tester; use the standard parent cleanup gate. This preparation
starts none of those resources.

Host checks (no simulator/native input):

```sh
npx vitest run test/manual-test/duo-verification/duo-acceptance.test.ts
python3 test/manual-test/duo-verification/duo_preview_compare_test.py
python3 test/manual-test/duo-verification/duo_native_definition_adapter_test.py
npm run typecheck
npx eslint test/manual-test/duo-verification
node --check test/manual-test/duo-verification/duo-pending-lookup.cjs
bash -n test/manual-test/duo-verification/duo-visible-definition.sh
swiftc -frontend -parse test/manual-test/duo-verification/DuoAcceptanceLookupProbe.swift
```

Swift parse is **not** XCTest typecheck/native compilation. Native probe build
and executed-action provenance remain mandatory in the admitted runtime lane.
