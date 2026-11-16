# Duo #350: assert preserved paint, not just retained DOM selection

**HOST-qualified oracle, not a completed native feedback loop.** No native input,
app operation or app repair is part of this tool. Use the [acceptance recipe](duo-acceptance.md#phase-1--visible-selection-and-native-handles-350)
and [kit](../kit/README.md) in the single admitted app-tester lane later.

## HOST command and evidence contract

Requires Python with Pillow (no project dependency change). All paths in the pair
are relative to that external pair file, or absolute. Keep images, raw receipts,
source hashes/size/mtime and full calibration/provenance outside Git.

```sh
python3 test/manual-test/duo-verification/duo-selection-paint.py "$PAIR" --expect painted
python3 test/manual-test/duo-verification/duo-selection-paint-test.py -v
# Optional actual archive control: a host-replay pair prepared from A3 originals.
DUO_PAINT_ARCHIVE_PAIR="$ARCHIVE_PAIR" \
  python3 test/manual-test/duo-verification/duo-selection-paint-test.py -v
```

The pair has `kind` (`host-replay`, `host-synthetic`, or `native`), `reference`
(`image`, `cropPixels`) and `before`/`after` checkpoints. Each checkpoint requires:

- `image`, `selection`, `lookup`: active-display image, single fresh
  `DuoAcceptanceSelection.js` JSON (optional `PROBE ` prefix), and raw
  `DuoAcceptanceLookupState.js` CDP JSON. Require the same first `hope`, exact CFI,
  offsets33–37, direction, task, parsed result and one successful non-aborted request.
- `nativeWindow`: actual `[width,height]` in native points, **not DOM viewport or
  stale portrait `app.frame`**; `windowEvidence`: raw receipt reference/explanation.
- `imagePixels`: actual oriented `[width,height]`; explicit measured `scale`,
  `orientation` (`portrait`/`landscape`), raw `exifOrientation` (1 if absent),
  `activeDisplay` and `captureDisplay` (D1 or D3, must agree). EXIF is applied.
- `domOrigin: "reader-viewport"`, explicit `webViewOffset: [x,y]` in native points,
  and `mappingEvidence`: independently qualified native/visual mapping receipt.
  The selection probe already adds iframe offsets; do not add those twice,
  assume DOM DPR, or turn the right-side rail into a guessed left inset.
- `cropPixels: [x,y,width,height]`: exposed word band in oriented image pixels,
  agreeing with the mapped DOM rect within one pixel; `blankPixels`: at least100
  adjacent white Document pixels, to its right at the same band top (not a Drawer).

The actual A3 positive is pinned by SHA256 in the tool, with crop
`[84,775,144,84]`: first `hope`, not the Drawer's query. The archive before is
1398×2034 /466×678; folded D3 is2853×2007 /951×669. Their separately measured
scale is3, **not a default for new captures**. These Light/font/raster controls are
fixture-specific. Native/replay reference substitution is BLOCKED; synthetic
references are allowed only with the explicit HOST-synthetic label.

Black glyph-mask IoU must be≥0.94 against that positive, allowing translation of
at most one oriented pixel, never resize/warp/OCR. On the positive's calibrated
blue pixels (204,221,237 ±12/channel), painted coverage must be≥99.5%; plain white
requires≥99.5% white with≤0.5% blue. Intermediate wash, wrong word, empty ROI,
occlusion, missing controls, invalid mode/NaN/bounds/scale or unchanged native
window are **BLOCKED (exit2)**. Preserved paint is exit0; actual missing after
paint is **exit1**, including HOST replay. Only `--expect painted` is accepted.
Metadata is a tester assertion requiring independent raw-receipt review; this
pixel tool cannot certify its capture provenance. Handles are **NOT SCORED**:
painted glyphs/wash are not native handle presence, usability or a gesture proof.

## Later native handoff — not runnable until the calibration gate is supplied

The archive has no fresh native WebView frame (`app.webViews` was absent).
A native driver is therefore **not supplied or claimed ready**. The admitted
app-tester must supply one small external `a3-paint-capture.sh` adapter, using
`phase-a3.sh` as read-only recipe, not execute that original (it overwrites A3).
Its arguments are explicit owned UDID, Metro deviceName, Metro URL, actual fold
script and new OUT. Required setup/adapter contract:

1. Reverify the owned Duo, current source/Beta, paused fixture, permitted normal
   dictionary request/visible definition, empty selection and no other fetch wrapper.
   Use the existing normal Close Lookup/nativeClose handler for **RESET only**;
   assert empty DOM selection afterwards. No `Selection.addRange` or CSS paint.
2. Freshly qualify native window, active-display capture and viewport→native offset
   at BOTH poses. Preserve raw evidence. The historical zero offset is a replay
   calibration, not fresh native-frame proof. Keep source PNGs/hashes untouched.
3. Copy/recalibrate the already-working external `verified-fold.sh`; retarget its
   receipts to OUT and verify the owned Hub window/points. Never reuse old PID or
   hardware selectors blindly. Export `OPENREADER_DEVICE`/`OPENREADER_METRO` from
   the explicit arguments. Use fresh atomic, monotone harness sends and marked
   answers; do not copy A3's unqualified `grep ... | tail -1` freshness check.
4. Reuse `lookup-word-frame.js`, the owned `/tmp/openreader-lookup-UDID.point` and
   `LookupFoldPressProbe/testLongPressHope` through `kit/run-probe.sh` (one method,
   `-collect-test-diagnostics never`, silence gate). This is a **real native press**.
   Arm `DuoAcceptanceLookupTraffic.js` alone; retain a painted baseline/range/result/
   count1/active D1 image. Write pair.json with reference/before, then run
   `python3 test/manual-test/duo-verification/duo-selection-paint.py "$OUT/pair.json" --expect painted --baseline-only`.
   Abort unless it exits0 `NATIVE_PAINTED_BASELINE_ONLY` (explicitly NOT acceptance).
5. Deliver exactly `bash "$ACTUAL_FOLD_SCRIPT" open`, settle actual native dimensions
   within8s, then capture fresh range/state, actual D3 image/geometry and pair.json
   (`kind: native`). No retap, reselection or app relaunch between checkpoints.
   Restore the traffic observer in `finally`, including on exit1; failed restoration
   overrides the result as BLOCKED. Always retain failed artifacts.

**One proposed native wrapper command**, only after that adapter/calibration exists
and Terra has released the lane (UDID/deviceName/Metro8437/fold script are explicitly
owned setup variables, OUT is new). This is not a command run during preparation:

```sh
export SETUP UDID DEVICE_NAME METRO ACTUAL_FOLD_SCRIPT OUT
python3 test/manual-test/kit/ios_guard.py run --wait 0 --timeout 180 \
  --record "$SETUP/assert-paint-phase.json" -- bash -c '
  set -euo pipefail
  bash "$SETUP/a3-paint-capture.sh" "$UDID" "$DEVICE_NAME" "$METRO" "$ACTUAL_FOLD_SCRIPT" "$OUT"
  python3 test/manual-test/duo-verification/duo-selection-paint.py "$OUT/pair.json" --expect painted
'
```

Expected current-app native result: exit1 `NATIVE_PAINT_LOST`; after a real repair,
exit0 `NATIVE_PAINT_PRESERVED`. Run that actual asserting loop RED before any app
hypothesis. HOST replay is not native bug-red or Phase1 completion. Afterwards,
reset via normal Close Lookup, assert empty selection, restore counter/calibration
files and leave paused; reset is not acceptance. A return-to-original-size image
alone cannot satisfy this pair's real-window-change gate or prove handle adjustment.
