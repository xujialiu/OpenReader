# Library two-finger range selection (#128, beta4)

`LibraryTwoFingerProbe.swift` drives the Library's two-finger range selection
through the same private XCUIAutomation synthesis as
[`../downloads/TwoFingerProbe.swift`](../downloads/TwoFingerProbe.swift)
(ADR 0045): one `XCPointerEventPath` per finger in an
`XCSynthesizedEventRecord`. The `Fingers` enum is copied into the file because
`run-probe.sh` compiles one self-contained Swift file per probe.

```sh
bash test/manual-test/kit/run-probe.sh LibraryTwoFingerProbe SIMULATOR_UDID NEW_OUTPUT_DIR \
  [-only-testing:LibraryTwoFingerProbe/testName ...]
```

Prerequisites, all verified by the probe itself: the Debug app is installed;
the Library root holds at least 8 rows at the default text size (rows are
84 pt tall from y=128 on the 440x956 screen; the probe's fixed coordinates
assume exactly that layout); the simulator's own volume is 0 (the runner
checks); the app is not already in selection mode (a relaunch clears it).

Methods, each reading state off the accessibility tree (header `N selected`,
row `value: checkbox, checked`):

- `testSweepAddsThenReverseRetracts` — from normal mode, two fingers down over
  rows 1-6 enter selection and add the range (6); the reverse sweep over those
  checked rows removes back to the sweep-start snapshot (0); a further sweep
  accumulates again; Cancel restores the normal Library.
- `testOneFingerScrollDoesNotSelect` — the same track with one finger scrolls
  and never enters selection.
- `testEdgeHoldAutoScrollsRange` — two fingers held against the list's bottom
  edge should auto-scroll the range beyond the screen.
- `testCancelAfterSweepRestoresNormal` — Cancel after a sweep is an ordinary
  exit with rows back to buttons.

What it cannot prove: the exact auto-scroll band/speed (the edge-hold method
needs the hold point inside the band above the floating actions); Retract
end-state adjudication — measured twice with different gesture timings: the
mode stayed at `0 selected` once and exited selection at zero once; which of
the two matches Files is the owner's call, not this probe's. Any change to row
height, the header, or the list insets shifts every hard-coded y and the
row-bound counts (y=590 is mid-row-6 → 6 selected, not 5).

## Pitfalls measured here (2026-10-04, beta4)

- **A probe launch without `-RCT_jsLocation` silently tests the wrong tree.**
  With `RCTMetroPort` empty in the app's Info.plist, `XCUIApplication.launch()`
  fell back to port 8081 and ran another checkout's older bundle: the sweep
  "failed" against code with no selection at all. Set
  `app.launchArguments = ["-RCT_jsLocation", "localhost:8082"]` (the probe
  does) and confirm the Debug Log's `[launch]` line names the intended beta.
- **Count the row bounds before asserting a sweep's total.** The first
  expected `5 selected` was an off-by-one: y=590 lands mid-row-6, and the
  app's own tree (`value: checkbox, checked` on rows 1-6, header `6 selected`)
  proved the sweep correct. Read the post-gesture tree from the xcresult
  attachments (`xcrun xcresulttool export attachments`) before calling a sweep
  failed — `XCTAssertTrue` records the failure and the method still runs, so
  the capture after a failed assert holds the real state.
- **Gesture timing moves the retract end-state.** Drag window 0.2-1.4 s ended
  retracted at `0 selected` (mode still active); window 0-1.2 s with a 0.2 s
  pause before lift ended with selection mode exited at zero. Same rows, same
  direction. Adjudicate against Files before fixing either side.
