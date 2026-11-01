# Library Search verification (#332, #339)

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
