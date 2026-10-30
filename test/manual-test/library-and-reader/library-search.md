# Library Search verification (#332)

Contract: [design 0090](../../../docs/design/0090-library-search-stays-out-of-the-way.md).
Use `LibrarySearchProbe.swift` through the [guarded runner](../kit/ios-verification.md).
These are real UI checks, with no playback or provider requests. Select methods;
do not run the entire class blindly, since some methods stage or delete fixtures.

## Fixture and state prerequisites

- `A Short Test of Reading Aloud` is inside `Search Folder`.
- Generated `Scroll Diag 02 of 12` through `Scroll Diag 12 of 12` are at root.
  The delete case additionally needs `Scroll Diag 01 of 12` restaged each time.
- The namesake case tolerates root fixture 12 already renamed to the short
  fixture's name by an interrupted run. It restores `Scroll Diag 12 of 12`.
  Never match two same-named action buttons without their row/path context.
- The Folder-global/Move case expects fixture 12 at root, moves it into Search
  Folder and back, and leaves navigation at root. Run after namesake cleanup.
- `testStageNestedFolderForHeldBackMenu` creates/reuses Search Outer → Search
  Inner and relaunches inside Inner. It is staging, not back-menu acceptance.
- Keep the normal text category for the cold test's compact-header threshold.
  For a large-text run, save `simctl ui UDID content_size`, set the requested
  category, run menu/clear checks, inspect screenshots and restore the saved
  category in a trap. No other device or host setting changes.

## Targeted invocation

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID
bash test/manual-test/kit/run-probe.sh LibrarySearchProbe SIMULATOR_UDID OUTPUT_DIR \
  -only-testing:LockScreenProbe/LibrarySearchProbe/testCancelRestoresNonzeroBrowse \
  -only-testing:LockScreenProbe/LibrarySearchProbe/testGlobalResultsPathsAndNamesakes
```

Read the raw per-case assertions and execution summary, failed attempts included.
A zero-test run is rejected. A reused output directory is scoped to its original
worktree; force rebuilding only probe products or use a fresh project when the
runner reports stale enumeration. Do not rebuild the application or reboot a
simulator to repair a probe query.

## Measurement rules

- Search input is located by its stable placeholder across UIKit's changing
  TextField/SearchField AX types. A readiness timeout records `XCTFail`; callers
  returning on nil must never silently convert absence into a pass.
- A field disappearing after Close is expected. Never read its frame unless
  `exists` is true. Nonzero cancel captures an actual swipe's settled row
  identity and scalar y-coordinate, then compares the same row after Close.
- A Reader round-trip taps a fully visible result by coordinate while retaining
  one row as its position anchor. `element.tap()` may auto-scroll an obscured
  row first, invalidating a before-tap measurement.
- Renaming a result so it no longer matches must REMOVE it under the unchanged
  query. Change the query to find the new name. Distinct paths are `Library`
  and `Library → Search Folder` in the staged namesake case.
- For #317, use the existing `back-menu-read.sh` recipe to read the menu while
  the finger remains DOWN, releasing away afterwards. A press-and-release can
  select an ancestor before the next assertion and is not a menu snapshot.

## Keyboard and coverage limits

Physical-keyboard Escape was manually verified on beta9. The synthesized
`testHardwareCmdFAndEscape` still fails; preserve it as a test-path discrepancy,
not an established app failure or evidence of a UIKit consumer.
`testTypeKeysInRunningSearch` and `testEscapeOnlyInRunningSearch` do not launch
or terminate the app, so a debugger can stay attached to the same PID. They
are diagnostics, not acceptance. A trace needs an accepted breakpoint, actual
stimulus during the live attachment, a positive control, and explicit detach.

`testPullPreviewThreshold` uses short and full pulls through the same coordinate
input path. Record the slow full pull and inspect intermediate frames for the
blur-to-clear transition; an end-state pass alone cannot prove the animation.
A short release must return to hidden search with no keyboard or Close AND
remain on the original page. A prior beta12 run navigated into the touched
Folder and falsely passed the old hidden-field-only assertion. The page check
is now mandatory. The corrected boundary passes on beta16 together with
ordinary scrolling and full/repeated entry; keep the failed beta12 evidence.

`testPullFocusesAndCloseStaysHidden` covers the revised pull contract: keyboard
and external Close before typing, empty Close, typed Close, repeated pull,
ordinary scrolling without reactivation, and menu reopening. The earlier
reveal-without-keyboard check is superseded, not a regression requirement.

`LibraryTwoFingerProbe.testSearchAndSweepAreMutuallyExclusive` verifies three
selected entries as a positive control, then the same two-pointer path while
searching must leave the query and no selection. `testHeldNestedBackMenu` uses
the existing event-path kit to hold then release away; record it and inspect
the menu while held, not after release. Stage Search Inner with the named
LibrarySearchProbe method first.

`testStageIMEComposition` presses an actual Bopomofo key and requires nonempty
input; handle the native keyboard-onboarding Continue prompt before the key.
A read-only native inspection can then require markedTextRange and absence of
the Library Escape command. `testRestoreKeyboardAfterIME` returns to English
and closes search. This tests the composition gate, not physical Escape
transport while composing.

On iPad and short/empty lists, `testBlankSpacePullAndClose` checks the blank
content area as well as row-origin pulls; input must have an external native
× immediately. Keep the same-page and keyboard checks on both sizes.

The Download Drawer probe correction/re-verification is separately tracked
in [#334](https://github.com/xujialiu/OpenReader/issues/334), not part of Library
Search or evidence for changing its scope. Its old screen-y filter included
clipped rows above the actual list; no app defect was established by those
inputs. A missing Select action, a no-op key or a static screenshot alone is
never proof of the corresponding interaction.
