# A Contents row while paused only moves the page (#52)

`browse-probe.cjs` makes the call a Contents row makes,
`{"do":"section","section":N}`. It checks that the page went there and that the
reading did not follow:

```sh
node test/manual-test/place-and-following/browse-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [WAIT_MS]
```

Prerequisites:

- A reader open and paused, with the reading on a sentence that is its Reading
  Position. A book reopened on its stored place will do, as will a
  `{"do":"seek",...}` (a tap), a skip, or a Play and pause.
- METRO_LOG, the file this tree's Metro writes to.

It plays nothing, so it needs no Provider and no silence. It reads the status
line, the Library's place for the book (`shelf`), the views, the section at the
top of the page and every painted highlight Range, sends the row, waits
(default 2,500 ms), reads again and takes a screenshot beside METRO_LOG.

GREEN (exit 0) means all of these:

- the section at the top of the page is SECTION;
- the status line's Utterance and section are unchanged;
- the stored place is unchanged;
- no Utterance Range is painted that was not painted before;
- no word is lit.

RED (exit 1) names each failure. Before the fix, on 2026-09-23 at 23:19, the
run read "the reading moved: utterance 176 -> 423; the stored place changed;
the highlight moved to "Chapter 2012: Grand Sword Crater"". Exit 2 is a
precondition or a harness that did not answer.

Choose SECTION two after the reading's. Its display re-renders the reading's
own section as a neighbour, which is how the WebView used to take the page
back: 23:30 in `notes/NOTES_2026-09-23.md`, and ADR 0044. A far section tests the
React Native half alone. With a Provider:

- Run it after a Play and a pause, so that an engine is paused. With
  `{"do":"watchfetch","host":"api.fish.audio"}` on first, the log shows that a
  browse sends no synthesis request.
- The speed (`{"do":"rate",...}`), a Voice (`{"do":"voice",...}`) and the
  Appearance (`{"do":"settings","patch":{"appearance":...}}`) changed while
  browsing must leave the section at the top of the page.
- Play must bring the page back to the paused sentence at its first cue.

What it cannot prove: a real touch on a Contents row, or a finger dragging the
page, which the WebView also counts as browsing. Both need XCTest.

## Real touches on a Contents row, a sentence and a drag (`BrowseTouchProbe.swift`, #52)

Independent #52 verification, 2026-09-24, of what `browse-probe.cjs` cannot
touch: a real tap on the Contents button and a real chapter row, a real tap on
a sentence, and a real finger drag, through `kit/run-probe.sh`, which checks
the simulator's own volume before anything runs; three methods press Play:

```sh
bash test/manual-test/kit/run-probe.sh BrowseTouchProbe SIMULATOR_UDID /tmp/openreader-browse-touch-01 \
  -only-testing:testOpenBookThenBrowseTwoChaptersAhead
```

A companion host script reads the same facts `browse-probe.cjs` does —
without sending the `section` command itself — so a real touch's effect can
be diffed the same way, run from the shell right before and right after each
method:

```sh
node test/manual-test/place-and-following/browse-touch-state.cjs SIMULATOR_UDID METRO_LOG LABEL
```

Run the methods in this order — each depends on where the previous one left
the reading or the page, and none of them relaunches the app except the
first (see Pitfalls, the debug banner):

- `testOpenBookThenBrowseTwoChaptersAhead` — opens `Cultivation Online` (real
  tap, resuming its stored place), confirms paused, then a real tap on
  Contents and on the chapter row two ahead of the one marked current. The
  state script confirmed the page alone moved (section 20 → 22), the status
  line, the stored place and the painted highlight all unchanged. Never
  presses Play.
- `testPlayAfterBrowseReturnsAtFirstCue` — a real Play tap; stops the instant
  the Pause button's own `busy` accessibility state clears (the first Clip's
  cue), 10.6 s in the recorded run — Fish Audio's real first-clip latency, the
  shortest this fact can be observed in. The state script read the reading
  back at the paused Utterance, its highlight centred at 283..341 of the
  container.
- `testTapSentenceInBrowsedChapterThenPlays` — browses again, then a real tap
  on a sentence well below the heading (`bodyPoint`, 0.55 down the page, clear
  of a freshly browsed chapter's own title). The tap moved the Utterance,
  its highlight and the stored place to the tapped sentence; a brief real Play
  (3.1 s to the first cue) then read from it.
- `testDragAwayFromReading` / `testFontSizeWhileBrowsing` /
  `testDragBackToReadingSection` — four `swipeUp(velocity: .fast)`, a real
  Font Size increase and decrease from Appearance, then `swipeUp`/`swipeDown`
  back. Never presses Play. The state script, taken after the away-drag, after
  the font change and twice more (immediately and 2.5 s later) once the drag
  back had crossed into the reading's own section, showed the same top
  section and — once back — the identical painted highlight Range across the
  2.5 s gap: no snap-centring, immediate or delayed, and the highlight was
  still there, off the visible page until a further nudge brought it on.
- `testContentsRowWhilePlayingJumpsAndKeepsPlaying` — a real Play tap, then a
  real Contents row two chapters ahead while it plays. The reading jumped to
  the target's heading and kept playing (Pause still showing 1.5 s later);
  7.9 s Play-to-Pause in the recorded run.
- `testOpenUnreadBook` / `testUnreadBookContentsRowHighlightsHeading` /
  `testLeaveUnreadBookWithoutPlaying` — opens `Cultivation Online — Chapters
  1751–2000` (never played) for the first time, a real Contents tap on its
  third chapter row, then a real tap on Back. The heading highlighted and the
  reading moved for this session, but the Library's place for this book id
  read `null` both right after the choice and after leaving —
  `Documents/library.json` read directly, not only the harness echo — and the
  Library row still read "Not started." afterwards. Never presses Play.
- `testSettingsShowsVersion`-equivalent coverage is
  `SettingsVersionProbe`, reused rather than duplicated: it reads
  `APP_VERSION` from the working tree at run time, so it needed no change for
  beta14.

What it does not establish: whether the debug-banner precaution
(`app.terminate(); app.launch()` at the sequence's start) is still needed once
nothing else in a run logs a warning; a shorter method sequence was not tried.
