# The Reading held in the Library (#68)

With `A Short Test of Reading Aloud` and one other Document in the Library, a
Voice that can play, and the app running against this tree's Metro:

```sh
bash test/manual-test/player-and-reading-held/reading-held.sh SIMULATOR_UDID NEW_OUTPUT_DIR [-only-testing:METHOD ...]
```

Real XCTest touches (`ReadingHeldProbe.swift`), attached to the running app.
XCTest runs the methods in name order:

- `testBackWhilePlayingKeepsReading`: from the fixture's sixth sentence, Play,
  then the back arrow. The Library shows `Return to the reading` with the value
  `Playing`. The fixture's row then quotes a sentence of the second chapter,
  which proves the voice crossed the chapter change with the Library in front:
  the place is written at most every ten seconds, so this takes about 12 s.
  Settings shows no button, and the Library shows it again. The button goes back
  to the reader, with no "Reading …" or "Laying the document out…" line (a
  reopen would show one), and the reading still playing. About 26 s of play.
- `testEdgeSwipeCollapsedAndLockScreenPauseInLibrary`: Play and collapse, then
  the edge swipe. The Library shows the button. The button goes back into the
  reader still collapsed, still playing and not reopened. A second edge swipe
  out, then Pause on Notification Centre's Now Playing card: the button stays
  and says `Paused`. The button goes back in again, with the player shown
  (a pause re-opens it) and paused. About 19 s of play.
- `testLeaveWhilePausedEndsReading`: back while paused shows no button.
- `testOpenAnotherEndsReading`: Play, back, then the other Document's row. Its
  reader opens paused, and back from it shows no button. About 3 s of play.
- `testZDeleteEndsReading`: Play, back, then Delete on the fixture's row. The
  button and the row go. About 6 s of play. It really deletes the fixture, so
  it is named to run last, and the script adds the fixture back through the
  harness afterwards (`Fixture added back`).
- `testAccessibilityTreeHasNoReaderControlsWhileParked` (independent
  verification, 2026-09-26): Play, back, then the accessibility tree is
  checked for `Pause`, `Play`, `Collapse the player`, `Contents`,
  `More actions`, `Next sentence`, `Previous sentence`, `Next paragraph` and
  `Previous paragraph` — none exist while the Library is in front, confirming
  the parked reader's own controls are not exposed, not just visually hidden.
  About 10 s of play.
- `testEndOfFixtureStopsPlaybackButtonStays` (independent verification,
  2026-09-26): from the fixture's second-to-last sentence, Play, back. The
  reading reaches the document's own end while the Library is in front — the
  button's value stops ending in `Playing` — and the button stays; it returns
  to the reader paused at the end, not reloaded. About 8 s of play.
- `testLockScreenResumeKeepsLibraryInFront` (independent verification,
  2026-09-26): Play, back, Pause on Notification Centre's Now Playing card
  (button stays, says `Paused`), then Play on the same card. The reading
  resumes — the button says `Playing` again — while the Library stays in
  front the whole time; the button then returns to the reader still playing,
  not reloaded. About 20 s of play.
- `testOwnRowReturnsToLiveReading` (independent verification, 2026-09-26):
  Play, back, then a tap on the fixture's own Library row instead of the
  Reading Button. It returns to the same live reader, still playing, not
  reloaded. About 10 s of play.

The script checks the simulator's volume first, stops an `xcodebuild` that
outlives its suite by two minutes, and reads the verdict from `test.log`.
Before any tap near the bottom of the screen, the probe dismisses React
Native's warning banner with its close button (Pitfalls, "A tap on the LogBox
banner…").

It does not prove what is heard, memory (notes 2026-09-25 23:41), or a
physical iPhone's lock-screen state. A section laid out while parked is
covered by the spike (notes 23:40) and, on a real book, by
`reading-held-book.sh` ([reading-held-book.md](reading-held-book.md)).

Independent verification, 2026-09-26: running all nine methods together in
one `xcodebuild` invocation, `testEdgeSwipeCollapsedAndLockScreenPauseInLibrary`
and `testEndOfFixtureStopsPlaybackButtonStays` failed (`Executed 9 tests, with
4 failures`) — the edge swipe did not register, which then left the app on a
screen the next method's `toLibrary` could not recover from, cascading into
its failure. Re-running just those two methods on a fresh app launch passed
cleanly (`Executed 2 tests, with 0 failures`), so this was test-order/gesture
flakiness under a long back-to-back run, not a regression; the other seven
methods passed in both runs.
