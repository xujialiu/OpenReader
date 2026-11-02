# Library Search verification (#332, #339, #341)

Contract: [design 0090](../../../docs/design/0090-library-search-stays-out-of-the-way.md).
Use `LibrarySearchProbe.swift` through the [guarded runner](../kit/ios-verification.md).
These are real UI checks, with no playback or provider requests. Select methods;
do not run the entire class blindly, since some methods stage or delete fixtures.

Since #339 there is no field until Search is chosen from `…` or with
Command-F: the app draws it under the title, with the keyboard, and the close
control beside it takes it away. A pull or a flick at the top of the list has
nothing to show, so #338's flick tooling (`LibraryFlickProbe`, `flick-to-top.sh`,
`field-visible.py`, `bounce.py`, `frame-track.py`) went with the pull; its
results are in [notes 2026-11-01](../../../notes/NOTES_2026-11-01.md).

## Fixture and state prerequisites

- `A Short Test of Reading Aloud` is inside `Search Folder`.
- Generated `Scroll Diag 02 of 12` through `Scroll Diag 12 of 12` are at root
  (`make-list-books.py`). The delete cases additionally need `Scroll Diag 01 of 12`
  restaged each time: `testDeleteFromResultsUpdatesMembership` and
  `testDeleteSelectedResult` each delete it.
- The namesake case tolerates root fixture 12 already renamed to the short
  fixture's name by an interrupted run. It restores `Scroll Diag 12 of 12`.
  Never match two same-named action buttons without their row/path context.
- The Folder-global/Move case and `testSelectResultsAcrossFoldersAndMove` expect
  fixtures 10 to 12 at root, move them through Search Folder and back, and leave
  them at root. `testSameNameRefusesWholeMove` renames fixture 11 to the short
  fixture's name and back. Run them after namesake cleanup.
- `testStageNestedFolderForHeldBackMenu` creates/reuses Search Outer → Search
  Inner and relaunches inside Inner. It is staging, not back-menu acceptance.
- Keep the normal text category for the cold test's header threshold and the
  field's frames. For a large-text run, save `simctl ui UDID content_size`, set
  the requested category, run the menu/clear checks, inspect screenshots and
  restore the saved category in a trap. No other device or host setting changes.

## Targeted invocation

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID
bash test/manual-test/kit/run-probe.sh LibrarySearchProbe SIMULATOR_UDID OUTPUT_DIR \
  -only-testing:LockScreenProbe/LibrarySearchProbe/testColdLibraryShowsNoSearchField \
  -only-testing:LockScreenProbe/LibrarySearchProbe/testPullAndFlickToTopShowNoField \
  -only-testing:LockScreenProbe/LibrarySearchProbe/testSearchShowsFieldWithKeyboardWhereThePhoneDrewIt
```

Read the raw per-case assertions and execution summary, failed attempts included.
A zero-test run is rejected. A reused output directory is scoped to its original
worktree; force rebuilding only probe products or use a fresh project when the
runner reports stale enumeration. Do not rebuild the application or reboot a
simulator to repair a probe query.

## Measurement rules

- Search input is located by its placeholder, `Search Library`. A readiness
  timeout records `XCTFail`; callers returning on nil must never silently convert
  absence into a pass.
- The close control is the page's `Close` button, beside the field; the field's
  own clear button inside it is `Clear text`. Neither is in the title bar.
- After Close, Escape, Settings or a relaunch the field must not exist at all; a
  field that exists but is clipped is a failure now, not hidden search. Never read
  its frame unless `exists` is true.
- The phone's own stacked field, measured on iPhone 17 (notes 2026-11-01): the
  capsule at `{{16, 117}, {315, 44}}`, Close at `{{342, 117}, {44, 44}}`, the words
  from x 58. `testSearchShowsFieldWithKeyboardWhereThePhoneDrewIt` compares the
  app's field with those frames within 3 points and keeps a screenshot: compare
  it, light and dark, with the phone's field in the notes' screenshots.
- Nonzero Close restoration captures an actual swipe's settled row identity and
  scalar y-coordinate, then compares the same row after Close.
- A Reader round-trip taps a fully visible result by coordinate while retaining
  one row as its position anchor. `element.tap()` may auto-scroll an obscured
  row first, invalidating a before-tap measurement.
- Renaming a result so it no longer matches must REMOVE it under the unchanged
  query. Change the query to find the new name. Distinct paths are `Library`
  and `Library → Search Folder` in the staged namesake case.
- Selection is read from the title bar's `N selected`; a locked field reads
  `isEnabled == false` with its query still as its value.
- `testPullAndFlickToTopShowNoField` samples the field and Close every 50 ms
  while the list moves. It cannot see a single frame; a video of the run is the
  check for anything shorter than its sampling.
- For #317, use the existing `back-menu-read.sh` recipe to read the menu while
  the finger remains DOWN, releasing away afterwards. A press-and-release can
  select an ancestor before the next assertion and is not a menu snapshot.

## Staging, restoring by touch and scanning a recording (#339 verification, 2026-11-01)

`1.0.4 (27)-beta3-debug`, iPhone 17 (iOS 27.0), the first native build of the app's own field and the
`open-reader-library-keys` module (prebuild 2 s, `pod install` 18 s, clean `xcodebuild` 171 s with
`-jobs 6`, guarded: 191 s). The device still held #338's Library (16 Flick Folders, `Scroll Diag … of
14`), whose names the probes do not match: `Scroll Diag 1` finds eight documents there (five of 14 and three of 12), not three.

- `stage-search-fixtures.sh SIMULATOR_UDID OUTPUT_DIR` generates the 12 `Scroll Diag … of 12` books and the
  short test, and adds them through the harness (13 entries; it never deletes). Empty a Library left by
  another run first, through the app: `…` > Select > Select all > Delete selected > Delete (the alert reads
  "This will delete 15 documents and 16 folders…"). Then make `Search Folder` with
  `testStageFolderAndMoveFixture`. Back `Documents` up with `cp -Rp` once staged: the delete cases consume
  `Scroll Diag 01 of 12`.
- `restore-trial.sh SIMULATOR_UDID LABEL SWIPES [TYPED]` is the real-touch form of
  `testCancelRestoresNonzeroBrowse`, with the position made after `…` is pressed (its header says why).
- `field-scan.py VIDEO TEMPLATE_PNG` looks for the field in every frame of a `simctl io recordVideo`
  recording, after cutting the magnifier and the xmark out of the `search-field-open-empty` screenshot.
  Use it, with `record-probe.sh`, for any claim that something does not appear: `testPullAndFlickToTopShowNoField`
  samples every 50 ms and cannot see a frame. The first run scanned 861 frames of the pull and flick tests
  (highest glyph scores 0.26 and 0.30 against 0.8 or more in the three runs that open search on purpose),
  and 497 frames of AXe pulls and drags (0.26, 0.24).
- The app's field as drawn on this device, from the open-empty screenshot (3x): capsule x 15.7 to 329.7, y
  118 to 162 (the phone's: 16 to 331, 117 to 161); magnifier from x 29; placeholder from x 58; Close circle
  x 338.7 to 386, y 116.7 to 163.3, so 46.5 across against the phone's 44, with its right edge on the margin
  (the phone's Close starts at 342). The accessibility frames say the same: input `{{58, 118}, {264.7,
  44}}`, Close `{{339.3, 117}, {46, 46}}`. Inside the probe's 3 pt, but not the phone's numbers.
- Pressing `…` or Settings (React Native views in the title bar) sends the list to its top, as a touch on
  the bar's empty area does (270, 84 and 201, 84 on the 402 pt screen), which is how iOS's tap-the-bar-to-
  scroll-to-top behaves: inferred from that match, the call itself was not caught (conditional breakpoints
  on `-[UIScrollView setContentOffset:]` and `…animated:` never fired). A bar item UIKit draws itself
  (Select all, Cancel while selecting), a row's actions and the Move drawer do not. So `…` > Search loses a
  scrolled position before Search starts, and `testCancelRestoresNonzeroBrowse` fails (464 against 72,
  twice). Bar touches made by tooling scroll the list too: do not touch the bar to "wake" a screen
  mid-measurement.
- From `1.0.4 (25)-beta4` `…` and Settings are native bar items (ADR 0090). Before that build, on the same
  device with real AXe touch pairs from a middle position: the React Native `…` moved the list to its top
  1 of 1 (and 6 of 6 above); with the list's `scrollsToTop` off, 3 of 3 presses left it and Close returned
  exactly (58 to 58, -12 to -12); with `…` as a native item, 3 of 3 left it and Close returned exactly (58,
  -12, -82). A 0.2 s touch on the status bar never reached the app through AXe, so the status-bar tap to the
  top is unmeasured. `testCancelRestoresNonzeroBrowse` now also fails at the press if `…` moves the list;
  `testSettingsRoundTripKeepsTheListWhereItWas` covers Settings and
  `testCancelRestoresTheBottomOfTheList` the 34 pt shortfall at the very bottom (-264 came back as -230).

## Round 2 on `1.0.4 (25)-beta4` (2026-11-01): what the probes need, and what reaches the app

`1.0.4 (27)-beta4-debug`, the e318a75 native build kept (JS only: Metro served the new bundle, Settings read the new line).

- **(Fixed in `1.0.4 (25)-beta5`: the page blurs the field when any drawer opens, and the red test below passes.) A search field that
  has the cursor put every drawer under the keyboard.** The Library actions drawer and a result's actions
  drawer opened as half sheets whose rows from y 560 down were covered by the keyboard (top y 590): Select, Move to…, Download and
  Delete cannot be pressed, and React Native's `keyboardShouldPersistTaps: "never"` makes the first press on a row (Rename, which
  shows) only put the keyboard away. `testActionsDrawersAreReachableWithTheKeyboardUp` is red for it (frames in the failure text).
  On a build without the fix every probe about what a drawer's rows DO needs `putKeyboardAway` (the keyboard's own Search key)
  first: it is opt-in now (`TEST_RUNNER_OPENREADER_PUT_KEYBOARD_AWAY=1`), so the flows go straight from the focused field. The clear
  button exists only while the field is being edited (`field.tap()` again after a drawer).
- **Typing and pressing in the probes.** `typeChecked` (every query typed into the field goes through it) reads the field back and
  types again once (`typeText("A Short")` left "AShort" twice, `typeText("Scroll Diag")` left "SDiag", `typeText("Scroll Diag 1")` left
  "Sl Dia", `typeText("Diag 12")` left "D2": five in about 55 first typings, none in 30 queries typed into an open field,
  `testTypingSpeedDropRate`); a results swipe starts above the keyboard (XCTest's `swipeUp` starts at 80 %
  of the list's height, under it); Rename's Save is pressed three seconds after typing, when the alert has stopped sliding up (the
  frame XCTest reads lags it: Save at y 482, then y 335); `testStageRenameAlertTypedAndWait` is the staging that showed it, with
  another tool pressing Save. In a selection the rows are checkboxes: look for them by label among all elements, not among buttons.
  A rename is stored in `Documents/display-names.json`, which a copy of `library.json` does not bring back.
- **Keys.** XCTest's `typeKey` (Command-F, Escape) reaches nothing: `testHardwareCmdFAndEscape`, `testEscapeEndsSelectionThenSearch` and
  `testSelectionBlocksCmdF` fail, and `testModalBlocksCmdF` passes without having tested anything. AXe's keyboard stopped
  delivering during the run (typed text and `key` lost, touches fine). `orca computer hotkey|press-key` into the Device Hub window
  that shows the simulator did reach it: `keys-trial.sh SIMULATOR_UDID DEVICE_HUB_PID WINDOW_ID` prints the page after each key
  (open, refocus, Escape's order, Command-F while selecting, a drawer, an alert, Settings, the Reader, a Folder page), and
  `testStageSelectedResultsAndWait` holds three selected results for it (the hybrid pattern: XCTest stages and waits for the
  search to be closed from outside). These are synthetic macOS key events, not a physical keyboard. `orca computer type-text`
  garbled its text ("Diag 1" became "a"), so type with XCTest.
- **More probes:** `testMatchingRules` (case, fragment, order, Folder names, path line, order of results), `testLockedFieldAndCloseDoNothing`
  (touches on the greyed field and Close), `LibraryTwoFingerProbe.testSweepFromBlankSpaceBelowShortList`.
- `restore-trial.sh` with `SCROLL_FIRST=1` (and `DRAG_DY=200` for a mid position) is the owner's order, scroll then `…`.

Round 3 on `1.0.4 (25)-beta5`: `drawers-over-focused-search.sh SIMULATOR_UDID OUTPUT_DIR` stages a focused search with
`testStageFocusedSearchAndWait` and drives the drawers with AXe touch pairs (a result's `…` then one touch on `Move to…`, `Select`
and `Delete`, the bar's `…` then `Create folder` and `Select`, a drawer closed without choosing, `…` > Search on an open search), a
screenshot per step. `testDrawerBlursTheFieldAndSearchKeepsItsQuery` is the XCTest form, with the long presses and a Folder's actions.

## Keyboard and coverage limits

Command-F and Escape now reach the page through the navigation controller and the
app's key target (ADR 0090), with the app's own text field in the page's
responder chain. Before #339 a synthesized Escape never closed the title bar's
search field although a physical one did; whether `XCUIApplication.typeKey`
reaches the new path is for `testHardwareCmdFAndEscape`,
`testEscapeEndsSelectionThenSearch` and `testSelectionBlocksCmdF` to show. A
failure there is a test-path question until a physical keyboard is tried.

`testStageIMEComposition` presses an actual Bopomofo key and requires nonempty
input; handle the native keyboard-onboarding Continue prompt before the key.
A read-only native inspection can then require `markedTextRange` on the field
and the absence of both Library commands. `testRestoreKeyboardAfterIME` returns
to English and closes search. This tests the composition gate, not physical
Escape transport while composing.

`LibraryTwoFingerProbe.testSweepSelectsSearchResults` verifies three selected
entries as a positive control, then the same two-pointer path over results must
select exactly three results, keep the query and lock the field.
`testHeldNestedBackMenu` uses the existing event-path kit to hold then release
away; record it and inspect the menu while held, not after release. Stage
Search Inner with the named LibrarySearchProbe method first.

A missing Select action, a no-op key or a static screenshot alone is never proof
of the corresponding interaction.

## The field's motion (#341)

The field grows in on `…` > Search and fades out on Close (ADR 0090, "Motion"), on a spring of mass 1, stiffness 350,
damping 30, starting when the field reports its focus or blur. To check it:

- **The curve**: record a cycle from the top of the list (`simctl io recordVideo --codec=h264`, `…` at 364, 84, Search
  at 201, 635 once the Library actions have risen, Close at 362, 139) and run `search-motion.py VIDEO --band 200 420`.
  Expect the open and the close to fit a natural frequency of about 18.7 rad/s and a damping ratio of about 0.80
  (measured 18.97 / 0.808 and 18.55 / 0.802 on `iPhone 17 animation`), a peak of 61 points, and no step larger than the
  spring's own between two frames except on the first open after a launch (below).
- **Mid-list**: the rows move down 60 points and back. Read two rows' frames from `ax.py UDID tree` before, during and
  after (measured 157 → 217 → 157); the script's band cannot tell an 84-point row from a 60-point shift there.
- **Frames as the UI thread drew them**: a temporary `useFrameCallback` in `library-search-field.tsx` logging
  `frame.timestamp`, `timeSincePreviousFrame` and the four values to Metro shows every frame of a motion. Remove it
  before committing. With the springs started on the field's mount instead of its focus, the frames after the open came
  247 and 300 ms apart while the keyboard was taken, and the list jumped to 0.78 of its way.
- **The first open after a launch** still loses about 50 ms at its start (16 points in the first moving frame, against
  2.7 on later opens): the keyboard's first appearance in the process keeps the UI thread past the field's focus event.
- **Escape and Command-F could not be sent** on 2026-11-02: `axe key 41` and `axe key-combo --modifiers 227 --key 9`
  reached nothing, and `orca computer` keys to the Device Hub window reported success without reaching the app (and
  refused with `--restore-window`). The close during the opening and the opening during the fade were driven by
  temporary timers in the code instead (`onClose` 150 ms after the opening began; `search.start` 150 ms after Close),
  which take the same path as the keys: the opening held at 0.55 through the keyboard's return, then sprang back to 1;
  the close (on a build that let the opening run on until the blur) turned at 0.61 and faded from there with Close never shown.
- **`testSweepSelectsSearchResults` fails whenever XCTest's `typeText` mistypes the query** (`S Diag`, `Sl Diag`,
  `Sll Diag`; 4 of 6 runs, all four failures, neither pass): the mistyped query has no results, the empty state's
  layout reaches the sweep as the list's height (VirtualizedList passes `ListEmptyComponent`'s `onLayout` to the list's
  own, `_onLayoutEmpty`), the sweep reads a 72-point list and scrolls by itself, and the results sweep selects 9. An app
  defect from #339's code, not the motion's; the two runs without the mistyping passed. Fixed under #342: the sweep keeps
  only layouts whose `currentTarget` is the list's native scroll view, and the probe now types `zqxj` first on purpose.
- **The probe shows #342 only once the field has settled.** Typed while the opening's last layouts were still arriving
  (697.7 and 698 after the empty line's 72), the no-results query passed twice with the fix taken out: a layout of the
  list's own after the empty line's put the height back. The probe waits 1.5 s after the field appears; with that wait
  it failed 2 of 2 with the fix out and passed 4 of 4 with it in (2026-11-02, `iPhone 17 animation`).
