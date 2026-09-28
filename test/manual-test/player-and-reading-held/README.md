# The collapsed player and the held Reading

## The collapsed player, the navigation bar and the Reading Button (#67)

With `A Short Test of Reading Aloud` in the Library, a Voice that can play, and
the app running against this tree's Metro:

```sh
bash test/manual-test/player-and-reading-held/reading-button.sh SIMULATOR_UDID NEW_OUTPUT_DIR [-only-testing:METHOD ...]
```

Real XCTest touches (`ReadingButtonProbe.swift`), attached to the running
app, never relaunched. Each method starts from the reader, paused, with the
player and the bar shown, and leaves it that way:

- `testCollapseWhilePausedAndRestore`: collapse, then the Reading Button. The
  bar and the player go and come back, the button's value says `Paused`, Play
  is still offered 1.5 s after the press, and the text does not move either way.
- `testCollapseWhilePlayingAndRestore`: skips back to the first sentence,
  Play, collapse, the Reading Button, Pause. The button says `Playing`, the
  reading is still playing after each press, and the text does not move. It
  plays about four seconds, all of it spent on the presses. The slow reads (the
  screen's ink, the element tree) happen before Play and after Pause.
- `testLockScreenPauseWhileCollapsed`: Play, collapse, then Pause on
  Notification Centre's Now Playing card. Back in the app, the bar and the
  player are shown and Play is offered. About eight seconds of play, most of
  it Notification Centre opening.
- `testEdgeSwipeWhileCollapsed`: collapse, then a swipe from the left edge. The
  reader goes and the Library is shown. Then it reopens the book.

"The text does not move" is read off screenshots, because the book's text is
not in the accessibility tree (Pitfalls, "Screenshots of the reading page"):
ink per point row from 120 to 700, with the first row of text and the whole
band compared (`LINE` lines in the output). It is measured at the top of the
fixture, where Play's centring scrolls nothing, so a difference is the bar's
and not the voice's. The script checks the simulator's volume first, and stops
an `xcodebuild` that outlives its suite by two minutes. The verdict is then
read from `test.log`'s suite line.

It does not prove the lock screen's own icon, the bar's animation (a recording
does, notes 2026-09-25 22:35), or anything about the dark theme beyond reading
ink against the page's own colour.

### Independent verification: the edge swipe's reliability, buffering, an Utterance change, and Contents (#67)

Four more `ReadingButtonProbe` methods, added verifying #67 beyond the
implementer's own run above, run the same way
(`bash test/manual-test/player-and-reading-held/reading-button.sh SIMULATOR_UDID DIR -only-testing:METHOD`,
one or more):

- `testEdgeSwipeReliabilityMeasurement`: not a pass/fail assertion but a
  measurement — 10 left-edge swipes collapsed-paused, 10 collapsed-playing (at
  delays of 0.1 to 3.0 s after Play, spread across roughly one Utterance's own
  length), and the same 10+10 with the bar shown instead of collapsed, as the
  pre-#67 control. Prints one `LINE swipe cond=… trial=… result=hit|miss` per
  trial and a `LINE swipe-summary` per condition. Measured 2026-09-26: 40 of
  40 hit, in every condition, after fixing a stale-element tap that had cut
  the first attempt short (Pitfalls, "A long, tight loop of taps…"). Separately,
  in the same session, the *existing* `testEdgeSwipeWhileCollapsed` missed once
  (paused, no auto-scroll possible) inside a six-method combined run — consistent
  with the already-recorded "test-order/gesture flakiness under a long
  back-to-back run" (#68 Pitfalls) and "An edge swipe started while the bar is
  still sliding away can miss" (Pitfalls, "The shell"), not with this
  measurement's own zero-miss, isolated-run result. Together: no evidence the
  swipe's reliability is specific to #67's collapsed/floating bar, or to the
  voice's own auto-centring; the known failure modes predate #67 and reproduce
  with the bar shown too. About 28 s of play across the 20 playing trials
  (`sum` of the ten delays, twice), derived from needing to spread across an
  Utterance's own length, not a round number.
- `testReadingButtonDuringBufferingAndWaveform`: collapses paused (two
  screenshots half a second apart, and the button's own cropped pixels
  compared byte-for-byte — identical), then Play immediately followed by
  Collapse and a press on the Reading Button, to catch it mid-buffering and
  confirm the press does not start or stop the reading either way, then the
  same paused-vs-playing pixel comparison while playing (not identical: the
  `variableColor` effect is moving). Also prints the button's own
  accessibility label and value at each state — what VoiceOver would announce.
  Measured 2026-09-26: `paused frames-identical=true`,
  `playing frames-identical=false`, label always `"Show the player"`, value
  `"Paused"` or `"Playing"` and never anything else. About 3-4 s of play.
- `testCollapseRestoreAcrossUtteranceChange`: unlike
  `testCollapseWhilePlayingAndRestore`, does not reset to the first sentence,
  so Play's own centring has something to scroll, and stays collapsed for 5 s
  — long enough at this fixture's pace to cross an Utterance while hidden.
  Compares each transition's own instant, not the interval in between (Pitfalls,
  "Comparing ink against a baseline taken before the page has settled…", which
  this test's own first version ran into). Measured 2026-09-26, corrected:
  `rows-differing=0 of 580` both at the instant of collapsing and the instant
  of restoring, after Utterances had crossed while hidden. About 5.6 s of play.
- `testContentsRowLandsBelowBar`: not on the fixture (Pitfalls, "The fixture's
  own Contents rows are all `unreachable`") — opens Shadow Slave — Chapters
  1–250, taps its own currently-read Contents row (the "already on the page"
  `offset()` case ADR 0048 calls out), and reads the first visible ink. Also
  one shot of the fixture's own top (Utterance 0) below the bar, a second,
  independent look at the case ADR 0048's own recording already measured to
  the pixel. Measured 2026-09-26: `first-ink=204` (Shadow Slave's own chapter
  heading, screenshot confirms it fully clear of the bar) and `first-ink=146`
  (the fixture's own top). No playback (paused throughout).

Two more checks used the harness rather than a real touch — collapsing and
disabling a Provider are both handler actions here, not touches; say so if
citing them:

- **A failure note while collapsed.** Play, harness `collapse:true`, then
  disable the only enabled Provider (`"do":"settings","patch":
  {"enabledProviders":[]}`, the same technique as "Disabling the active
  Provider while a Reading is held" below, here against an actively-playing
  reading instead of one parked in the Library). Measured 2026-09-26: `HX
  note attention=true "Fish Audio is disabled. Choose an enabled provider."`
  within about 2 s, and the bar and the full player were back on screen with
  it (screenshot) — `collapsed` was never explicitly set back to `false`; the
  screen's own `chrome = !(collapsed && notes.length === 0)` did it, exactly
  as ADR 0048 describes. Restoring `enabledProviders` afterwards left a stale
  note on screen until the next Play, which is expected (`status.note` clears
  on the next `play()`, not on a settings change) rather than a bug. A
  duplicate-note rendering issue found this way is in Pitfalls above, reported
  separately.
- **Dark theme.** Harness `"do":"settings","patch":{"theme":"dark"}`. The
  floating bar, the page under it, and the collapsed Reading Button (a white
  circle with a black waveform glyph, the inverse of light mode's dark circle
  and white glyph — `reading-button.tsx`'s own `PALETTE[scheme].page` colour
  on an `INK.text` circle, exactly swapping with the theme) all matched the
  phone's own dark mode. Restored to the original `theme` (confirmed by
  `saysettings` matching the session's starting settings exactly) afterwards.

## The Reading held in the Library (#68)

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
`reading-held-book.sh` below.

Independent verification, 2026-09-26: running all nine methods together in
one `xcodebuild` invocation, `testEdgeSwipeCollapsedAndLockScreenPauseInLibrary`
and `testEndOfFixtureStopsPlaybackButtonStays` failed (`Executed 9 tests, with
4 failures`) — the edge swipe did not register, which then left the app on a
screen the next method's `toLibrary` could not recover from, cascading into
its failure. Re-running just those two methods on a fresh app launch passed
cleanly (`Executed 2 tests, with 0 failures`), so this was test-order/gesture
flakiness under a long back-to-back run, not a regression; the other seven
methods passed in both runs.

## The Reading held on a real, long book (#68)

With "Shadow Slave — Chapters 1–250" (or another part from
`~/Works/epub_books`, README "Real books") already in the Library:

```sh
bash test/manual-test/player-and-reading-held/reading-held-book.sh SIMULATOR_UDID NEW_OUTPUT_DIR METRO_LOG [MARGIN]
```

The small fixture proves the mechanism; this proves it on "hundreds of spine
items, chapters several screens tall and a real navigation document" — what a
section boundary actually meets in the owner's own reading. A fresh mount's
Utterance count (`known`, from the harness `say`) is **session-relative**: the
same absolute number means a different place after a different resume anchor
(Pitfalls below), so the number of chapters this run crosses is whatever the
book's own resume anchor happens to leave MARGIN Utterances short of — not a
fixed chapter. Measured 2026-09-26: one run crossed from "Chapter 25" to
"Chapter 30" in about 6 Utterances of play; a session-relative index does not
mean chapters are evenly sized.

Before the real-touch suite runs (`ReadingHeldBookProbe.swift`, one
method, `testRealBookCrossesUnrenderedSectionWhileParked`), the script itself
opens the book and re-derives the seek target from THIS session's own
`known`, by the harness's `open`/`say`/`seek` commands (a handler action, not
a touch — reaching a chosen sentence in a 250-chapter book by real taps alone
is impractical), confirming the seek did not itself trigger the next
section's render before retrying with a larger margin. It leaves the app
sitting in that live, paused reader rather than persisting the place and
reopening it (Pitfalls below), so the probe's own first touch is Play, not a
tap to reopen. Every touch the probe itself performs — Play, the back arrow,
the Reading Button, Pause — is real, and it never assumes which chapter the
edge falls in: it only checks that the Library row's own quote of the
reading's place changes at all, which at that edge is only possible by
rendering fresh content. Measured 2026-09-26: `Executed 1 test, with 0
failures`, about 23 s of play (`Seeded … margin 6` to crossing to Pause).

It does not prove what specific chapter a fresh install would land on (that
depends entirely on the book's own saved place), or hold-time memory on a
real book (the spike in notes 2026-09-25 23:40 used one).

## Disabling the active Provider while a Reading is held (#68, handler probe)

Not a real-touch script — a harness sequence run once, 2026-09-26, to answer
whether something in Settings that stops an in-progress Reading leaves the
Library's button in place. With the fixture playing and left while playing
(`{"do":"play"}` then `{"do":"shut"}`, both handler actions — the same
`goBack` the back arrow itself calls), patching `enabledProviders` to remove
the Voice's own provider (`{"do":"settings","patch":{"enabledProviders":[]}}`,
never the Keychain — no credential was read, written or displayed) stopped the
reading within one tick: `HX status playing=false …` followed by
`HX note attention=true "Fish Audio is disabled. Choose an enabled
provider."`. The button stayed (screenshot, partly covered by the LogBox
banner). Restoring `enabledProviders` to the original list (confirmed by
`{"do":"saysettings"}` matching the session's starting settings exactly) and
leaving the reader while the reading was already stopped left a clean Library
with no button. This is a handler-action result, not a real Settings-UI
toggle of Fish's own "Use this provider" switch, which the freeze-while-on
rule (#48, design 0041) may gate differently.

## A real collapse and reopen during live playback (#71, `player-touch.sh`)

```sh
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG arm
bash test/manual-test/player-and-reading-held/player-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR \
  -only-testing:testCollapseAndReopenDuringPlaybackRealTouch
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG analyse
```

Neither `line-follow.cjs`'s own single-process run nor `glide-touch.cjs` touches
the player's own controls (only the WebView), so a real collapse and a real
reopen needed a third pair in the same `arm`/`analyse` shape.
`PlayerTouchProbe.testCollapseAndReopenDuringPlaybackRealTouch` (`.activate()`
only, the same convention as `testHeadRowTouches`: needs a Document already
open, paused, on a sentence with Word Timings, the player expanded) taps Play,
waits 1.5 s into the reading, taps "Collapse the player", waits 7 s collapsed
(2-3 s per line, this book, so comfortably more than the two line changes
wanted), then taps the collapsed pill's own button. There is no separate expand
gesture while playing: the collapsed state offers only the one Play/Pause
button, and a real Pause is what reopens the player
(`reading-view.tsx`'s `setCollapsed(false)`) — so reopening here also pauses,
the current behaviour and not a limitation of the probe. `Executed 1 test, with
0 failures (0 unexpected) in 21.002 (21.014) seconds` (2026-09-26).

`analyse` read back four line changes, all resting 0.4 px from the 60 %
target (374 px): one just after the real Play (69604 ms into the still-running
recording), two more while collapsed (72654, 75513: `msg … inset bottom 52
open 134.667` at 69843 sits inside the first episode's own window, well before
either), a fourth still collapsed (78054), then the reopen tap
(`msg 78680 inset bottom 134.667 open 134.667`, `open` unchanged throughout,
exactly ADR 0050's point) with the reading already paused (`msg 78440 hold`)
and nothing further moving. The run's `other` array was empty: no unmatched
scroll at the collapse message, the reopen message, or in between.
