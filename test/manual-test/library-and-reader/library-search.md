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

`testHardwareCmdFAndEscape` remains the failing keyboard checkpoint. Do not
remove it, waive it, or infer a UIKit consumer from static command lists.
`testTypeKeysInRunningSearch` and `testEscapeOnlyInRunningSearch` do not launch
or terminate the app, so a debugger can stay attached to the same PID. They
are diagnostics, not acceptance. A trace needs an accepted breakpoint, actual
stimulus during the live attachment, a positive control, and explicit detach.

Two-finger search exclusion, real IME behavior, physical-key Escape, a properly
held native back-menu read and iPad coverage remain separate checks. A missing
Select action or a no-op Escape does not prove those interactions. Partial
passing cases never imply the whole feature is accepted.
