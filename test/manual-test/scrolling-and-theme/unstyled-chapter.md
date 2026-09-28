# A chapter left unstyled by a fast fling (#34)

`scroll-fixture.ts` writes `Scroll Fixture.epub`, shaped like a serialised web
novel: a title page, a contents page that is one long list of chapter links,
then 60 chapters of 24 paragraphs, several screens each. The text comes from a
fixed seed, so every run writes the same bytes and the Document Id is always
`sha256:9acbcbe4480c15ba1319ecf56bad78e13a478470d2107f89791ba0f5b74f1606`.

```sh
npx tsx test/manual-test/fixtures/scroll-fixture.ts /tmp/openreader-scroll-fixture
```

Put it in `Documents/Inbox/` and send the harness's `add`, as for the sized
fixtures ([font-size.md](../settings/font-size.md)); set the theme with `{"do":"settings","patch":{"theme":"dark"}}`
and open it with `open`. Then, with this worktree's Metro writing to METRO_LOG:

```sh
START=30 SHOTS_DIR=/tmp/openreader-scroll-01 \
  node test/manual-test/scrolling-and-theme/scroll-theme.cjs SIMULATOR_UDID METRO_LOG 15 up 300 150
```

Each run waits for epub.js's queue to empty, displays section START, flings
the page 150 frames of 300 px towards the start of the book by setting the
container's `scrollTop` from inside the WebView, waits for the queue again, and
reads every view twice, two seconds apart: `INDEX:D` for a section holding the
program's dark stylesheet, `INDEX:L[sameN epN]` for a displayed one holding none
(the defect), `x` for a destroyed view, `*` for one on screen. The script's own
header has the rest, including the exit codes; `down` flings towards the end.

Measured 2026-09-22 on a dedicated iPhone 17 simulator (iOS 27.0): red on 6 of
15 and, with the final script, 3 of 15 runs before #34's change; 0 of 15, twice,
after it, and 0 of 6 `down` and 0 of 6 at 150 px. The rate varies from run to
run, so fifteen runs is the least that says anything; a red run's screenshot is
one chapter white on the dark page.

What it cannot show: a finger's momentum scroll (it is `scrollTop` from
JavaScript, which reaches epub.js's `scroll` listener the same way but is not a
touch), the owner's own books, or anything while reading aloud. It never plays.

## Real touches against the fixture (`ScrollThemeReaderProbe.swift`)

Independent #34 verification, 2026-09-22, against a dedicated simulator kept on
a non-default Metro port (see [pitfalls/metro.md](../pitfalls/metro.md)): real XCTest
touches `scroll-theme.cjs` cannot give — a finger's fling, a tap on a word
reached only by one, Theme/Appearance applied live to the page, the
content-hook change's re-centre risk, and a chapter boundary crossed during
real Fish playback, through `kit/run-probe.sh`, which checks the simulator's
own volume before anything runs; two methods press Play:

```sh
bash test/manual-test/kit/run-probe.sh ScrollThemeReaderProbe SIMULATOR_UDID /tmp/openreader-scroll-reader-01 \
  -only-testing:testFastFlingBothDirections
```

Run the methods one at a time, in this order — several depend on where the
previous one left the reading, and none of them `.terminate()`s or
`.launch()`es the app (see the Metro Pitfall this section starts from):

- `testVersionAndThemeLiveOnPage` — real touches: Settings shows `Version
  <APP_VERSION>`; General → Theme → Light, back into the reader (screenshot);
  Theme → Dark, restored (screenshot). Confirms the page itself, not only the
  Settings row, repaints live.
- `testFastFlingBothDirections` — five `app.swipeUp(velocity: .fast)` (later
  chapters), twice, then the same with `swipeDown` (earlier chapters), each
  batch settling 1.5 s before a screenshot. All four came back fully dark,
  Font Size 20, no white chapter, 2026-09-22.
- `testTapWordAfterFling` — ten fast swipes, then a real tap on a word.
  Decisive because `status.section`/`status.utterance` (`use-reading.ts`'s
  `seekTo`) only change on a tap or Play, never on a scroll: the Metro log's
  last `HX` lines before and after the tap read `utterance=null section=27`
  → `utterance=219 section=14`, matching the chapter the tap landed in, and
  the screenshot shows that sentence highlighted.
- `testConfigureFishProviderNoRelaunch` — the same real touches as
  `OfflineFixProbe.testConfigureFishProvider` (masked key from
  `/tmp/openreader-fish-key.txt`, Enable, wait for "Enabled"), without its
  `app.terminate(); app.launch()`.
- `testFontSizeLiveOnPage` — the stepper 20 → 16 → 20 from the reader's own
  Appearance drawer, screenshotting the page (not just the sheet) at each
  size.
- `testHighlightRecenterRisk` — selects a sentence by tapping while paused,
  flings twenty sections away, then back in four batches, screenshotting
  throughout. `attach()`/`centreOnce()` in `highlighter.ts` do fire from a
  destroyed-and-rebuilt section that covers the current `state`, exactly as
  the code comment there says ("the manager destroyed this section's view
  and rebuilt it … both want centring now") — `show()` (a tap) sets
  `state.follow` true by default (`reader-bridge.ts`), so this path is not
  playback-only. In the measured run the app's own out-of-order-render safety
  net (the "Utterances were renumbered" note, already in `use-reading.ts`
  before #34) cleared the stale reading position first, so no disruptive jump
  was seen; a smaller round trip that rebuilds the section without also
  triggering that renumbering was not tried. Never presses Play.
- `testShortPlaybackCrossesChapterBoundary` /
  `testRetryPlaybackAfterNetworkFailure` — a real Play/Pause at a chapter's
  last sentence (reached with `{"do":"section","section":N}` and a small real
  swipe back — see the harness Pitfall above for why Contents cannot do this
  on this fixture), asserting the transition to `Pause` as proof playback
  actually started (see the XCTest Pitfall on a tap landing on the debug
  banner). Both measured attempts, 2026-09-22, hit the already-documented
  first-Fish-request network failure below before crossing into the next
  chapter; `playing=true` was confirmed in the Metro log both times, so the
  content-hook sweep and highlight painting are exercised, but the chapter
  crossing itself was not established. A third attempt was not made: MEMORY/device-testing.md
  derives playback duration from what is being measured, and a network retry
  loop is not that.
- `testDownloadDrawerListsChapters` — opens Download with a real touch and
  requires the `* chapters downloaded` count line; never selects or
  downloads.
