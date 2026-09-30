# The collapsed player, the navigation bar and the Reading Button (#67)

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

## Independent verification: the edge swipe's reliability, buffering, an Utterance change, and Contents (#67)

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
  {"enabledProviders":[]}`, the same technique as
  [provider-disabled-while-held.md](provider-disabled-while-held.md), here against an actively-playing
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
  Since #103 an empty `enabledProviders` gives `No provider is enabled.
  Enable one in Settings to listen.`, shown once (#72).
- **Dark theme.** Harness `"do":"settings","patch":{"theme":"dark"}`. The
  floating bar, the page under it, and the collapsed Reading Button (a white
  circle with a black waveform glyph, the inverse of light mode's dark circle
  and white glyph — `reading-button.tsx`'s own `PALETTE[scheme].page` colour
  on an `INK.text` circle, exactly swapping with the theme) all matched the
  phone's own dark mode. Restored to the original `theme` (confirmed by
  `saysettings` matching the session's starting settings exactly) afterwards.
