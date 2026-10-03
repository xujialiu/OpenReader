# Library two-finger range selection (#128)

`LibraryTwoFingerProbe.swift` uses the two-pointer XCUIAutomation synthesis from `../downloads/TwoFingerProbe.swift` (ADR 0045). It sends real touches and reads the resulting selection from the accessibility tree. The helper is copied because the kit compiles one self-contained probe file.

```sh
TEST_RUNNER_OPENREADER_METRO_PORT=8082 \
  bash test/manual-test/kit/run-probe.sh LibraryTwoFingerProbe SIMULATOR_UDID OUTPUT_DIR \
  -collect-test-diagnostics never -test-timeouts-enabled YES \
  -maximum-test-execution-time-allowance 60
```

The Debug app must be installed, its Metro running, and the simulator volume zero. Seed the Library root with ten rows, first a Folder named Scratch. These probes currently use default text size on the iPhone 17 Pro Max's 440×956-point display: 84-point rows beginning at y=128. They do not import or delete content. Adapt coordinates for other devices rather than assuming the same geometry. Each method relaunches, pinning the app to `OPENREADER_METRO_PORT` from the test runner (default 8082), and requires the normal Library and its first row to be hittable.

## Checks

- `testSweepAddsThenReverseRetracts`: normal mode → rows 1–6 selected; a separate sweep starting on those checked rows removes them, leaving selection mode active at zero; another sweep adds them again. Cancel restores normal mode.
- `testSingleSweepReversalRestoresRows`: one uninterrupted contact goes from row 1 to 6 and back to 3. Only rows 1–3 remain selected.
- `testOneFingerScrollDoesNotSelect`: one finger changes the first row's vertical position without entering selection. Checking only that selection stayed off would not prove scrolling worked.
- `testEdgeHoldAutoScrollsRange`: a short horizontal sweep enters selection; Select all measures the total, Deselect all clears it. A new sweep begins at row 1 and holds four points above the native Move button for 1.5 seconds. It must select all ten rows, including the initially offscreen rows. The measured button frame, not a guessed y-coordinate, locates the edge band.
- `testCancelAfterSweepRestoresNormal`: Cancel after direct two-finger entry restores ordinary rows.

The tests cannot establish storage-failure behavior, VoiceOver operation, paid Download cancellation, or every device/text-size combination. Floating-action colour, reduced transparency and XXXL layout are separately checked with device screenshots.

## Diagnosis and failed runs, 2026-10-04

All failed artifacts were retained outside the repository under `/tmp/openreader-sel128-tf/` and `/tmp/openreader-sel128-parent/`.

1. The original probe omitted `-RCT_jsLocation` and loaded another checkout on 8081. The intended simulator appeared in that Metro's `/json/list`. Pin every XCTest launch, not only shell launches; verify the app's Debug Log version.
2. y=590 lands in row 6, not row 5. Read captured row frames before asserting totals. A first assertion failure does not stop XCTest, so later captures can be misleading if their prerequisites failed.
3. The original edge probe started at row 7 in a ten-row list but expected eight selected, and held at y=780 outside the edge band. Neither could establish edge scrolling. The corrected probe starts at row 1 and measures the action frame.
4. The alleged zero-selection automatic exit was not established: the preceding sweep in that raw run already failed to enter selection. Zero stays in selection mode, as approved; it is not a new owner decision.
5. Even with corrected geometry, the parent reproduced a real recognizer race twice: horizontal entry worked, but a vertical two-finger sweep produced native scroll offsets down to approximately -261 and no selection-pan start. Wrapping the Library ScrollView in `Gesture.Native().requireExternalGestureToFail(selectionPan)` fixed it. The corrected four-method suite passed with zero failures before the single-contact reversal check was added. The chapter drawer retains its existing gesture attachment.
6. Manual pan activation was rejected: gesture-handler's state manager warned that synchronous activation requires Reanimated, which is not installed. No dependency was added, and that experiment was removed.
7. Xcode's automatic post-failure `simctl diagnose --timeout=600` repeatedly hung after test summaries had already been written. `-collect-test-diagnostics never` preserves the ordinary log and xcresult while avoiding that unrelated wait. One parent attempt instead stalled while setting up the launch automation session before any gesture; the bounded call was terminated, and an explicit launch to the correct Metro restored the next test. No app-data erase was used.
8. Metro's LogBox banner ("Open debugger to view warnings.") sits at the bottom of the Library and its frame covers both floating selection buttons, so pixel colour checks of the Move/Delete capsules sample the banner instead (beta5 final check, 2026-10-04). Dismiss the banner by tapping its close `✕` (about x=408, y=894 pt on the 440×956 display) before screenshot colour checks; the tap consumed by the banner's close leaves the selection state unchanged.
