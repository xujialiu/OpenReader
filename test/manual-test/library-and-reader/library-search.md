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
