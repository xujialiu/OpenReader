# Ordinary iPhone/iPad regression matrix (final candidate)

**Preparation, not a passed run.** Nothing native ran for this matrix: no device
was created, booted, installed, launched, tapped or built. Host checks and the
fixture construction below ran at this worktree's commit; native execution
waits for the parent's explicit ordinary-device admission and the final merged
candidate SHA/Beta. Behavior boundary: [design 0092](../../../../docs/design/0092-duo-keeps-the-current-reading-task.md)
("Ordinary iPhone and iPad require relevant regression checks"); orientation
policy [ADR 0085](../../../../docs/adr/0085-the-app-fits-ipad-and-mac-windows.md);
role identity [ADR 0086](../../../../docs/adr/0086-three-copies-for-three-recipients.md);
the affected-regression obligations are #350 (visible selection, no layout-only
request duplicates), #351 (pending lookup becomes a visible parsed result) and
#354 (undimmed Appearance opening + reversible font) — closed for the scoped
Duo delivery, still required not to regress on the ordinary final candidate.

Zoned to other lanes, not duplicated here: the Duo fold/rotation-native
experiment (tester 1), real-HTTP source qualification and all
Provider/Voice/audio-source work (tester 2), the Mac platform gates. The
ordinary lane plays no audio; #353 word-timed Following waits for the parent's
specific final-test phase.

## Phase 0 — admission, provenance, targets (all of it gated)

**Admission decisions recorded from the parent (2026-11-08, binding for this
lane):** the final merged SHA and Beta are NOT ready — HOLD all native
build/test; never build the current Beta 17 as final; the parent will deliver
the explicit SHA and centrally set Beta (expected 18). Device names approved
(session-owned iPhone + iPad on the iOS 26.5 runtime) but NO creation, metadata
write or boot until the explicit slot grant; then boot/test sequentially and
read `memory_pressure` before EACH boot. Toolchain: per-command
`DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer` for the
fresh-source build, with the 26.5-runtime compatibility explicitly QUALIFIED at
admission (build and launch one smallest probe before scheduling the matrix)
— never a global `xcode-select`. Metro ports 8293 (phone) / 8295 (iPad) are
approved PROPOSALS only if free at admission: re-check `lsof` and record; never
claim an external reservation; never 8437. The P6/P7 layout control is the real
native iPad resize, labeled **ordinary resized-window**, never a Duo fold
result; one real Free Dictionary request plus one correct-recipient Consent
answer is authorized for the PUBLIC fixture word; ONE owner EPUB part may be
copied for the real-navigation case per the standing manual rules (originals
untouched, outside Git; no private book text in reports, Git or any P7
outbound — P7's visible-definition evidence uses the public Word fixture).

One attempt directory for the whole ordinary attempt, one recorded recovery at
most ([kit/ios-verification.md](../kit/ios-verification.md)); a failed recovery
ends the attempt BLOCKED. Heavy work goes through `ios_guard.py run`; probes
through `run-probe.sh` (takes the slot itself). Read `memory_pressure` before
each boot. Session-owned devices only; never touch another session's target
(the booted Duo and its Metro belong to another lane). No global
`xcode-select`; any non-default toolchain is a per-command `DEVELOPER_DIR`.

```sh
# Readiness before any assertion, per owned device, against THIS lane's Metro:
python3 test/manual-test/kit/ios_ready.py "$UDID" "$OUT/readiness-$ROLE" \
  --timeout 20 --metro http://127.0.0.1:$METRO_PORT
# Version-line provenance (Debug role; the probe at
# test/manual-test/settings/SettingsVersionProbe.swift reads the current tree's
# app-version.ts — run it from the parent's final merged tree):
bash test/manual-test/kit/run-probe.sh SettingsVersionProbe "$UDID" \
  "$OUT/version-$ROLE" --mode debug -collect-test-diagnostics never
```

Provenance to record per case: tested SHA (the parent's final merged source,
not this preparation commit), native/Settings version incl. the chosen Beta,
newest Debug Log `[launch]` line validated by CONTENT (version, `Debug Mode on`,
Metro bundle) — never by line count, which a version-changing launch invalidates
(pitfall). Metro is this lane's own named port (not 8081, not another lane's);
readiness matches `appId` + `deviceName` in `/json/list`, never `description`.

Build plan (only after admission): guarded `prebuild` + `xcodebuild
RCT_METRO_PORT=$METRO_PORT` Debug build **from the final merged tree**, install
over the session device's existing app, keep its data. The existing fresh
SDK 27.1 Duo artifact is NOT copied blindly onto ordinary devices; ordinary
SDK/runtime compatibility is qualified by building the ordinary Debug binary
from the same final source. Fixture construction is allowed now (host):

```sh
npx tsx test/manual-test/fixtures/lookup-words-fixture.ts "$FIXTURES"
npx tsx test/manual-test/fixtures/short-test-fixture.ts "$FIXTURES"
# PROVEN (2026-11-08, this commit): both .epub files build; zip leads with
# META-INF/container.xml. Load by copying into Documents/Inbox + harness add.
```

Real-hundred-section navigation needs the owner's epub part; copy it only when
later authorized, originals untouched, outside Git.

## Ordinary phone

### P1 — portrait policy preserved

Existing probe: [kit/PhonePortraitPolicyProbe.swift](../kit/PhonePortraitPolicyProbe.swift)
(attaches to the RUNNING app; never launches; never taps Play).

```sh
bash test/manual-test/kit/run-probe.sh PhonePortraitPolicyProbe "$UDID_PHONE" \
  "$OUT/phone-policy" -collect-test-diagnostics never
```

Preconditions: app foreground on Library or an open Reader, playback stopped,
device physically upright. Expected raw evidence: `PROBE-POLICY` lines in
`test.log` showing `before` frame portrait (width<height), the landscape
attempt frame EQUAL to before, the return, plus the three `policy-*`
screenshots. The XCUIDevice orientation getter is recorded, never asserted.
A frame change under the attempt is a FAIL (portrait policy broken), not a
flaky gesture, unless a separate delivery control shows the input never landed.

### P2 — phone focus guards (critical C1)

C1: closing/hiding the reader, canceling an alert, opening another Document,
or focusing another native editable must not steal focus, pop the keyboard or
scroll the page. Use the checked-input recipe
([input-integrity.md](../../library-and-reader/input-integrity.md)) with
`alert-input.py` for the staged edit and real touches for every guard action;
assert before/after equality of (a) the focused element, (b) the keyboard
state read through the Device Hub `keyboard` command (pitfall: the hardware
keyboard's two states and the one-focus lifetime of a Hub toggle), and (c) the
page's scroll offset via a `viewport-size.js` harness read. Cancel must leave
`library.json`/`library-folders.json` unchanged; an unsubmitted draft stays
unsubmitted. One command per case, in the guarded phase:

```sh
python3 test/manual-test/kit/alert-input.py "$UDID_PHONE" "$OUT/c1-stage" \
  --title 'Create folder' --before '' --value Qwrtz
# (unsubmitted) then per guard action: real touch, then the three equality reads
```

A `done` print from a probe proves no caret/text outcome by itself; the native
field, keyboard and scroll receipts are the assertion.

## Ordinary iPad

### P3 — real system rotation

Existing probe: [IpadRotationProbe.swift](../../place-and-following/IpadRotationProbe.swift).
Run both directions as separate guarded runs; the probe asserts the system
orientation took and screenshots `XCUIScreen.main` (the full-screen capture —
an app-only screenshot after iPad rotation can be cropped wrong). Layout
assertions stay outside the probe: afterwards read the app's own frame and
content (harness `viewport-size.js` + `ax.py tree`) and require the
side-safe Reader/Library/Settings/Player buttons hittable in the new
orientation (P5's reads). Before/after orientation must actually differ; a
landscape set while already landscape is not a rotation.

```sh
bash test/manual-test/kit/run-probe.sh IpadRotationProbe "$UDID_PAD" \
  "$OUT/pad-rot-l" -only-testing:IpadRotationProbe/testRotateToLandscape \
  -collect-test-diagnostics never
bash test/manual-test/kit/run-probe.sh IpadRotationProbe "$UDID_PAD" \
  "$OUT/pad-rot-p" -only-testing:IpadRotationProbe/testRotateToPortrait \
  -collect-test-diagnostics never
```

### P4 — genuine width-changing window resize (one command)

Existing driver: [ipad-resize-case.py](../../place-and-following/ipad-resize-case.py)
inside `ios_guard.py`. It stages the exact CFI by Browsing (handler-assisted
fixture), then changes the window with REAL native AXe handle drags, measures
the SAME character before/narrow/wide, asserts stage width and every displayed
iframe width equal at each width, the same character at the upper visible edge
(two line heights below the 54 pt header — the unobscured boundary, not a raw
scrolledLocation anchor that can sit under the header), paused before/after,
and the saved-positions hash unchanged (Position/Stamp no-write). It never
starts audio.

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 150 \
  --record "$OUT/resize-phase.json" -- \
  python3 test/manual-test/place-and-following/ipad-resize-case.py \
  "$UDID_PAD" "$OUT/resize-case-new" \
  --cfi "$EXACT_CFI" --section "$SPINE_INDEX" --axe "$AXE" \
  --metro http://127.0.0.1:$METRO_PORT \
  --narrow "$X" "$Y" "$TO_X" "$TO_Y" \
  --wide "$SMALL_X" "$SMALL_Y" "$LARGE_X" "$LARGE_Y"
```

Preconditions: Document open in a wide window, Reading paused and settled
(`bash test/manual-test/kit/reading.cjs state` reports `playing:false` before
and after; two identical saved-position snapshots before injecting layout — a
pending prior speech write is not a layout-caused write), handle coordinates
freshly derived from the CURRENT screenshot at the simulator's scale. The
driver internally reuses `resize-anchor.js` (the same-character upper-edge
measure) and `viewport-size.js` (stage and every displayed iframe). Widths:
pass measured
`--wide-width`/`--narrow-width` (the 800/375 defaults are the historical capped
values). A drag that lands at a different native size (measured 718 on the
11-inch iPad) is recalibrated from the ACTUAL window, not diagnosed as an
iframe bug. `PASS:` line + `records.json` + per-step screenshots are the
receipt; an unchanged width fails the driver on purpose.

### P5 — side-safe surfaces at both widths

Ordinary windows keep the existing layout (no side reservation); the repair
contract says ordinary devices are unchanged, so this case asserts reachability
and the unchanged narrow-Player behavior, not new geometry. After P3/P4 at each
orientation/width: `ax.py tree` reads; every checked control (Reader bar
buttons, Library Search + return-to-Reading, Settings cards/fields, Player
Voice/Contents/speed controls) must have an on-screen frame and answer one real
touch on a sampled subset. At large accessibility text sizes, Voice wrapping
and separate Contents/speed rows are intentional — never compare their x gaps
as one row (pitfall). No new command file needed:

```sh
python3 test/manual-test/kit/ax.py "$UDID_PAD" tree > "$OUT/tree-wide.json"
node test/manual-test/kit/hx.cjs "$UDID_PAD" '{}' \
  --code-file test/manual-test/place-and-following/viewport-size.js
```

### P6 — #350 ordinary variant: completed selection preserved and painted across the real window change, no layout-only duplicate

The Duo fold control belongs to tester 1; this ordinary case uses the P4 resize
as the layout change and is labeled a resized-window case, not a fold result.
P6 is a **COMPLETED lookup**: the passthrough request counter
([DuoAcceptanceLookupTraffic.js](DuoAcceptanceLookupTraffic.js) — it never
withholds or replaces a response) is the ONLY observer, and the pending
coordinator is never involved here: its initial-state check refuses an already
armed observer, so stacking them would abort P7 and poison both cases. Order:
verify no leftover observer/selection (cleanup guarantee), arm the counter,
real native long press on `hope` (first occurrence) of the Word Boundaries
fixture above the drawer's opening edge, require the normal request through
the passthrough and the parsed visible result BEFORE the resize, then snapshot:

```sh
node test/manual-test/kit/cdp.cjs --eval \
  test/manual-test/duo-verification/DuoAcceptanceLookupTraffic.js "$METRO"
# real native press (calibrated ordinary input channel; see duo-acceptance
# Phase 1 for the calibration pattern), then require the COMPLETED result:
node test/manual-test/kit/hx.cjs "$UDID" '{}' --code-file \
  test/manual-test/duo-verification/DuoAcceptanceSelection.js > "$OUT/sel-before.json"
node test/manual-test/kit/cdp.cjs --eval \
  test/manual-test/duo-verification/DuoAcceptanceLookupState.js "$METRO" \
  > "$OUT/state-before.json"
# real verified resize → settle ≤8 s → repeat BOTH snapshots + active-display image
```

Required: equal section/exact CFI/direction/text before and after settled
reflow (≤8 s settle window), the traffic count unchanged across the resize (no
layout-only request; exactly one new request only for a deliberate handle
change), the native image showing the painted selection and both exposed
handles, and the pixel oracle `duo-selection-paint.py` run on the fresh
ordinary pair (its BLOCKED thresholds are kept, never relaxed). Fresh
screenshot-scale calibration for crop/scale — the pinned A3 scales are Duo
artifacts, not defaults.

**Finally, restore and ACK the counter BEFORE P7's gate install:** evaluate an
external file containing `globalThis.__duoAcceptanceLookupTraffic?.restore()`
through CDP, require its exact `DuoAcceptance lookup traffic restored` answer,
and require the next `DuoAcceptanceLookupState.js` read to show
`traffic: null` (close the lookup for reset and assert an empty DOM
selection). This ack is P7's admission precondition.

### P7 — #351 ordinary variant: pending-to-visible with an actual native excerpt/image

P7 is the **HELD lookup**: the held gate ALONE, installed by the coordinator
itself — the passthrough counter from P6 is restored and ACKED first
(`traffic: null` read), and must NOT be armed here. The coordinator's own
initial-state check (`Close the old lookup and restore all fetch observers
first` on any present selection, gate or traffic) is the contract guard that
the P6 reset actually happened; do not bypass or pre-install anything.
`verified-resize.sh` = the calibrated AXe resize drag with its system-input
receipt (≤6.5 s); `assert-definition.sh` waits for the press probe's export,
then `duo-visible-definition.sh`:

```sh
node test/manual-test/duo-verification/duo-pending-lookup.cjs "$DEVICE_NAME" \
  "$METRO" "$OUT/verified-resize.sh" "$OUT/assert-definition.sh" "$OUT/pending-01"
```

Same coordinator as the Duo phase with the held real Free Dictionary gate: the
fold/parse must not wait for the export; the native result assertion must.
Success needs the parsed `LookupDrawer.result.text` derived from the actual
response, the query and definition in hittable native Text, AND the
active-display image showing the exact definition excerpt — not
query/Copy/source/spinner alone. `report.json` ends `VISUAL_REVIEW_PENDING` by
design: review the image and accept/reject explicitly. Consent for the
dictionary recipient is answered once after reading the alert, before the
first held run; a held response age ≤2.5 s at layout-change start, release
<12 s, parsed state <15 s.

### P8 — #354 ordinary variant: undimmed Appearance opening + reversible font

Phase-5 recipe at the ordinary pose/window: close all Drawers, dismiss
selection/callouts/banners, capture the before-opening and opened
active-display PNGs with identical checkpoints (same visible-character CFI/rect,
window/header geometry, saved appearance, `appearanceOpen` false→true), then:

```sh
python3 test/manual-test/duo-verification/duo-preview-compare.py \
  "$OUT/before.png" "$OUT/opened.png" "$OUT/pair.json" > "$OUT/pixel-diff.json"
```

Exit 0 = identical registered crop pixels (not full acceptance); exit 1 =
review with signed/absolute deltas (dimming is one possible cause, not the
automatic verdict). Then a real visible Font Size stepper change, capture its
live preview + computed style, restore the EXACT original value, capture again,
and restore Font/Size/Margins/alignment/Theme to the recorded baseline. The
change/restore images are separate controls, not substitutes for the
closed→opened pair.

### P9 — no-write proof, positions and stamps

Covered inside P4 (positions hash) and P6 (traffic count); the standalone
evidence pair for the report:

```sh
python3 - "$CONTAINER" <<'PY'
import hashlib, json, sys
from pathlib import Path
entries = json.loads((Path(sys.argv[1]) / "Documents/library.json").read_text())["entries"]
print(hashlib.sha256(json.dumps({e["id"]: e.get("position") for e in entries}, sort_keys=True).encode()).hexdigest())
PY
```

Snapshot before and after each paused layout change; require equality. Copy
snapshots only to the attempt directory; never commit library contents.

## Candidate role gate — HOST only (no purchase account)

The formal/free denial of purchase capability is host-tested; no unapproved
purchase account, StoreKit session or App Store contact is involved. Re-run at
the final merged SHA (green at this preparation commit, 88bee0c: 20 files /
206 tests for the set below, plus the offline pair separately):

```sh
npx vitest run test/build test/purchase test/app-config.test.ts \
  test/duo-scene-orientation.test.ts \
  test/app/purchase-paths.test.ts test/app/purchase-screen.test.ts \
  test/app/purchase-source.test.ts test/app/purchase-restore.test.ts \
  test/app/purchase-remote-play.test.ts \
  test/offline/runtime-purchase.test.ts test/offline/runtime-purchase-launch.test.ts
```

In the admitted lane this is corroborated natively by `SettingsVersionProbe
--mode debug` (Purchase row present only in formal) and the compiled-artifact
check from [purchase/README.md](../../purchase/README.md) — no `store` harness
command exists in Debug; nothing is bought, restored or account-switched.

## Host preparation already run (this commit, no simulator)

```sh
npx vitest run test/manual-test/duo-verification/duo-acceptance.test.ts \
  test/manual-test/duo-verification/selection-diagnostics.test.ts test/scripts/ios-guards.test.ts
python3 test/manual-test/duo-verification/duo_preview_compare_test.py
python3 test/manual-test/duo-verification/duo_native_definition_adapter_test.py
npm run typecheck
node --check test/manual-test/duo-verification/duo-pending-lookup.cjs
bash -n test/manual-test/duo-verification/duo-visible-definition.sh
swiftc -frontend -parse test/manual-test/place-and-following/IpadRotationProbe.swift
swiftc -frontend -parse test/manual-test/kit/PhonePortraitPolicyProbe.swift
swiftc -frontend -parse test/manual-test/place-and-following/DuoCaretTypeProbe.swift
python3 test/manual-test/duo-verification/ordinary-matrix.test.ts   # via npx vitest
```

Swift parse is not an XCTest typecheck; native build/execution stays gated.

## Evidence rules

Every case reports PASS / FAIL / BLOCKED / UNSUPPORTED with the tested SHA,
exact native input, before/after state, raw logs and images. `test.log` must
show actual action lines matching the CURRENT probe source (a post-edit run can
execute the previous binary — void it); `Executed N tests, with 0 failures`
with N>0; `Executed 0 tests` is a setup failure, never a pass. Keep every
failed attempt's artifacts. A screenshot alone, a DOM-only value or an exit-0
gesture replay is not a pass: assertions are actual property changes plus
pixel/method execution. Cleanup: restore the traffic observer/gates/word
dispatcher, overwrite the harness command with a noop then remove
`harness.json` (monotone seq; replay pitfall), restore settings/baselines,
leave the latest app open and paused with this lane's Metro running, and record
every port/PID/device the lane started.
