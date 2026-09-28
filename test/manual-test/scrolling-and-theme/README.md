# Scrolling, flings and theme colours

## A moved highlight leaves a strip behind (#35, `leading-strip.sh`)

Whether a highlight that has moved on left a strip of its colour along the top
of the words it left. Only a screenshot can say: the registry holds the right
Range the whole time, so nothing in the DOM is wrong.

```sh
npx tsx test/manual-test/fixtures/leading-strip-fixture.ts /tmp/openreader-leading-strip
bash test/manual-test/scrolling-and-theme/leading-strip.sh SIMULATOR_UDID /tmp/openreader-leading-strip-01 app METRO_LOG DOCUMENT_ID [LINE_HEIGHT]
bash test/manual-test/scrolling-and-theme/leading-strip.sh SIMULATOR_UDID /tmp/openreader-leading-strip-02 page [fix=1|lh=1.6|delay=600]
```

- `app` drives the reader's own highlighter from inside its WebView
  (`leading-strip-probe.js`, through the harness's `js`): a fresh display of the
  fixture's chapter, one `speak` with `reveal` so that the centring scrolls as it
  does when a Clip starts, a word every 250 ms, and a `hold` on the first word of
  the sentence's second line. First put `Leading Strip Fixture.epub` in
  `Documents/Inbox/` and send the harness's `add`; its answer carries the
  Document Id. It needs this worktree's Metro writing to METRO_LOG. It sets the
  dark theme and Font Size 28 for the run and restores both afterwards. It never
  plays, so nothing is synthesized, nothing is heard and no reading position is
  written: it is safe on a simulator whose sync points at the owner's real folder.
  LINE_HEIGHT (for example `1.6`) is set on the chapter's `<p>` for the run.
- `page` opens `leading-strip.html` in Safari, from a server the script starts.
  That is WebKit alone: one `<p>` whose lines are set apart by `<br />`, one word
  highlight, and a scroll right before the first word. `fix=1` repaints the
  word's Block the way the reader does, `lh=1.6` makes the line box taller, and
  `delay=600` lets the scroll paint before the first word.

The fixture is laid out the way the owner's web-novel books are: a heading and
one `<p>` whose sentences are set apart by `<br /><br />`. The strip only
appears on a line that starts a text node but not its paragraph.

`leading-strip.py SCREENSHOT [LINE_PX]` is the detector for both modes. It finds
every region of the dark theme's word colour: a region nearly a line box tall is
a word, and a shorter one outside every word is a stale strip. Exit 1 is RED, 0
GREEN, and 2 INVALID, meaning there was no word on the screen or no answer from
the reader, so nothing was measured.

Measured 2026-09-22 on the iPhone 16, iOS 27.0. Before the fix, `app` was RED
with a 6 px strip above "She" (y 930..935); after it, GREEN, also at
line-height 1.6. `page` is RED with a 6 px strip (37 px at `lh=1.6`) and GREEN
with `fix=1` or `delay=600`, which says that runtime's WebKit still has the bug.
`page` with no query going GREEN on a later runtime would mean WebKit's own fix
(319154@main) has shipped there.

What it cannot show: a real voice, since the words move on a synthetic clock;
whether a finger scroll or a resize leaves a strip, since only the centring
scroll is driven; and a physical device's tiling, which may paint the
scrolled-in tiles a frame later. The owner's phone left its strip above the
Utterance's second word, where the simulator leaves it above the first.

## A chapter left unstyled by a fast fling (#34)

`scroll-fixture.ts` writes `Scroll Fixture.epub`, shaped like a serialised web
novel: a title page, a contents page that is one long list of chapter links,
then 60 chapters of 24 paragraphs, several screens each. The text comes from a
fixed seed, so every run writes the same bytes and the Document Id is always
`sha256:9acbcbe4480c15ba1319ecf56bad78e13a478470d2107f89791ba0f5b74f1606`.

```sh
npx tsx test/manual-test/fixtures/scroll-fixture.ts /tmp/openreader-scroll-fixture
```

Put it in `Documents/Inbox/` and send the harness's `add`, as for the sized
fixtures above; set the theme with `{"do":"settings","patch":{"theme":"dark"}}`
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

### Real touches against the fixture (`ScrollThemeReaderProbe.swift`)

Independent #34 verification, 2026-09-22, against a dedicated simulator kept on
a non-default Metro port (see **Metro and the bundle** above): real XCTest
touches `scroll-theme.cjs` cannot give — a finger's fling, a tap on a word
reached only by one, Theme/Appearance applied live to the page, the
content-hook change's re-centre risk, and a chapter boundary crossed during
real Fish playback. `scroll-theme-reader.sh` has the same shape as
`alignment.sh` — a new output directory generates the project, an existing one
reuses it, and `-only-testing:` takes the bare method name — and it checks the
simulator's own volume before anything runs, because two methods press Play:

```sh
bash test/manual-test/scrolling-and-theme/scroll-theme-reader.sh SIMULATOR_UDID /tmp/openreader-scroll-reader-01 \
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

`ScrollThemeReaderProbe.swift` is in `test/manual-test/kit/project.rb`'s
allow-list.

## A white page behind the dark reader: on opening, and in a long fling (#27)

`white-flash.sh` records the screen through one trigger and `white-flash.py`
reads every frame of the recording: a frame is white when more than 30 % of the
page area (from under the navigation bar to above the player) has luminance
above 200. A dark page of text reads 4–6 %, a white one 91–98 %. Set the theme
to dark first (`{"do":"settings","patch":{"theme":"dark"}}`), add a real book
(**Real books** above), then:

```sh
bash test/manual-test/scrolling-and-theme/white-flash.sh open     SIMULATOR_UDID DOC_ID /tmp/openreader-white 5
bash test/manual-test/scrolling-and-theme/white-flash.sh relaunch SIMULATOR_UDID DOC_ID /tmp/openreader-white METRO_LOG PORT 6
bash test/manual-test/scrolling-and-theme/white-flash.sh fling    SIMULATOR_UDID DOC_ID /tmp/openreader-white 3
```

- `open` opens the Document from the Library once per run.
- `relaunch` restarts the app first and opens as soon as its JavaScript answers
  the harness. Keep it: the first open after a launch fails differently from
  every later one (Pitfalls, **Screenshots of the reading page**).
- `fling` makes 15 real fast swipes each way (`FLINGS` changes it) through
  `ScrollThemeReaderProbe.testLongFlingForRecording`, about a minute a run.
  With `PAINT=1` it paints the WebView's page magenta and epub.js's scroll
  container green before the flings, and the reader counts those colours too:
  that is how the flash was found to be the scroll container.

Each run prints `RED`/`GREEN`; `VERBOSE=1` lists every frame. Measured
2026-09-23/24 on a dedicated iPhone 17 simulator (iOS 27.0), with "My Vampire
System 1-250": before #27's change, `open` was red 5 of 5 (white for 1.6–3.4 s),
`relaunch` 6 of 6 and `fling` 3 of 3 (49 and 71 white frames); after it, 0 of 5,
0 of 6 and 0 of 3. A fixed run still had 13–55 frames in which the page was
empty and dark. That was not epub.js outrunning itself, as this said: it was
#58, a fling landing past the laid-out text when iOS dropped epub.js's scroll
adjustment (ADR 0045). With #58's change, `fling` had 0 empty frames in 3,854
(2026-09-24 05:48).

What it cannot show: the physical iPhone, which is where the owner saw it (see
**Physical iPhone screen** in Pitfalls), or the light theme, in which every
frame of a page reads white by this measure — check the light theme with a
screenshot instead. It never plays.

### A real finger tap on the Library row (independent #27 verification)

`open` and `relaunch` above open through the harness (`do:"open"`); the owner's
own trigger was a tap on a book in the Library. `TAP=1` makes the same two
modes tap the row instead, through
`ScrollThemeReaderProbe.testRealTapOpenForRecording` (`BOOK_TITLE` names the
row, default `My Vampire System`; `DOC_ID` is then unused):

```sh
TAP=1 bash test/manual-test/scrolling-and-theme/white-flash.sh open     SIMULATOR_UDID - OUT_DIR 3
TAP=1 bash test/manual-test/scrolling-and-theme/white-flash.sh relaunch SIMULATOR_UDID - OUT_DIR METRO_LOG PORT 3
```

Measured 2026-09-24 by ios-tester on the dedicated iPhone 17 simulator, the
real book, through the script it first wrote for this (since folded in here):
3 plain taps and 3 as the first open after a relaunch, all GREEN (52–81 frames
a run, 36–46 empty and dark). Frames read individually, not only the automated
verdict, confirm it: the slide from the Library, "Laying the document out…"
and the first section's text are on the dark page throughout, including the
first open after a relaunch.

`ScrollThemeReaderProbe.testVersionAndLightThemeOnRealDocuments` covers the
version line and the light theme against a Library that holds the owner's
book and `Stat Line Fixture` rather than `Scroll Fixture` (Pitfalls, XCTest):
Settings' version line; General → Theme → Light; the real book (white page,
black text) and the fixture (white below its six lines); Dark restored with a
reopen, no relaunch needed, going dark without one. Four screenshots, one per
step. Measured 2026-09-24, all as expected; the same run also confirmed
`Version 0.0.2-beta14`.

## A fast scroll that jumps by whole chapters and shows an empty page (#58)

`fling-jump.cjs` flings the open reader with real flicks and reads, on every
animation frame, which section and which offset within it is at the top of the
viewport and how much of the viewport displayed sections cover. It also logs
every call epub.js makes that changes what lies above the viewport, and the
scroll it adjusts with: `trim`, `erase`, `prepend`, `counter`, `scrollTo`,
`scrollBy`. Add a real book (**Real books** above) and open it, with this
worktree's Metro writing to METRO_LOG, then:

```sh
node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG down 3
node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG up 3
FLINGS=1 FROM_END=1200 node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG down 3
node test/manual-test/scrolling-and-theme/fling-jump.cjs --read OUT_DIR/run-….json
```

- The single flick is the smallest red case, and is `INCONCLUSIVE` whenever
  only one section lay above the one it left: epub.js keeps the section just
  above the first it displays, so nothing is erased (2026-09-24 05:54).
- Each run resets the page to a fixed section (`START`, 20 going `down` and 60
  going `up`), waits for epub.js's queue to empty, and flicks through
  `fling-jump.sh`, which builds `FlingProbe.swift` once into `OUT_DIR` and
  runs `FlingProbe.testFlicks` without rebuilding. `FLINGS` (10), `VELOCITY`
  (4000 pt/s), `GAP` (0.1 s) and `NOWAIT` pass through; the flicks do not wait
  for the app to go idle between them (Pitfalls, XCTest).
- It stops the probe only when the page has rested for a second and the queue
  is idle, and reads the log the WebView posts to a server the script runs on
  127.0.0.1 (Pitfalls, **Measuring inside the reader's WebView**).
- A run is `RED` on any blank frame (sections covering under half the viewport)
  or jump (the text at the top moving half a viewport further than the page's
  own recent speed could carry it, just after an epub.js scroll or unlike the
  scroll position's own step; or landing in no section either frame held);
  `GREEN` only when the top crossed a section boundary and epub.js changed
  something above the viewport; `INCONCLUSIVE` otherwise. Each red episode is printed with the call it followed. `VIDEO=1`
  records each run for `white-flash.py`, whose empty-dark count is the same
  blank seen on the screen.

Measured 2026-09-24 on a dedicated iPhone 17 simulator (iOS 27.0) with "My
Vampire System 1-250": before #58's change, `down` red 4 of 4 (7–21 blank
frames), `up` red 4 of 4 (182–248, reaching 12 to 28 sections back), a single
flick from 1,200 px before a section's end red 3 of 3; every episode followed an
`erase` of a section above, or a `counter` for sections prepended in a bounce.
After it: every run that reached rest green, with the erases above all made at
rest, and red again in both directions with the program's install line
`holdStill(rendition.manager);` commented out. Ten flicks back without a pause
stop at section 59, the top of the laid-out text, by design (design 0045);
`GAP=0.8` reaches 56. About 30 s a run.

What it cannot show: the physical iPhone, a finger that stops the page and
holds still (XCTest's press here lasts 0.01 s), or what happens during
playback, which it never starts.

## A drawer's lines in the other theme's colour (#29, `line-colour.sh`)

With the current Debug app connected to this tree's Metro, `A Short Test of
Reading Aloud` in the Library and no LogBox banner on the screen:

```sh
bash test/manual-test/scrolling-and-theme/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR dark light    # the app dark on a light phone
bash test/manual-test/scrolling-and-theme/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR light dark    # the reverse
bash test/manual-test/scrolling-and-theme/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR system dark   # following the phone
```

It sets the theme through the walkthrough harness, goes back to the Library,
and `LineColourProbe.swift` opens with real taps: the Library's drawer by a
long press and then by its `...`, the reader (the player), Contents, the voice
drawer (waiting for any "Asking … for its Voices…" note to clear first), the
reader's actions drawer, its Download page — tapping "The First Chapter"
there afterward if it exists and is not already downloaded, never starting a
download, and photographing the picked state as `reader-download-selected` —
and its Appearance page. `line-colour.py` then lists, for each screenshot,
every pixel row at least half the screen wide in `#dcdce2` or `#33333c`, and
any run of 24 pixels or more in the other theme's one. Plays nothing; puts
back the theme and the simulator's appearance it found. About 75 s once the
runner is built.

Exit 1 = RED, some line is in the other theme's colour; 0 = GREEN; 3 = the
probe failed, so the screenshots are not the drawers. A GREEN also lists the
rows it found in the right colour: compare them with a RED run's, because a
line that has gone altogether is GREEN too.

**What this does not score**: the voice chips' borders and the download
checkbox ring take `borders.text`, `borders.reading` or `borders.quiet`, none
of which is one of the two hairline greys `line-colour.py` looks for, so a
chosen chip (border = fill, deliberately no visible seam) or a checked/
unchecked ring never turns a run RED or GREEN by itself — read those
screenshots by eye, or sample the exact pixels (below). The voice drawer only
has rows and chips to look at once a Provider is enabled on the device under
test (`OfflineFixProbe.testConfigureFishProvider`, with a key dropped once at
`/tmp/openreader-fish-key.txt`); with none enabled the sheet shows only its
"Enable a provider in Settings" note, GREEN and empty.

Measured 2026-09-24 (notes, 13:34–13:37 and 13:55–14:00): on the tree before
#29's fix, dark on light was RED in six of eight screenshots and light on dark
in six, following the phone GREEN; after it, all four pairings GREEN with the
same rows present. It cannot see a line in any other colour, a border shorter
than 24 px, or the voice drawer's rows and chips when no Provider is enabled.

Independently re-verified 2026-09-24 (ios-tester, `0.0.2-beta22`, "iPhone 17
issue_29"), with Fish Audio enabled so the voice drawer has real rows and
chips: dark on light and light on dark both GREEN across all nine
screenshots (the original eight plus `reader-download-selected`), the same
rows as the notes above. Sampling exact pixels for what `line-colour.py`
cannot score: in the voice drawer, an unchosen locale chip's 1 px top and
bottom border read `#33333c` dark / `#dcdce2` light exactly (`BORDER.*.line`),
with no seam at the chosen Fish Audio/`af` chips, whose border and fill are
the same `#e6e6ea` dark / `#16161a` light (`BORDER.*.text`) all the way
across — found by scanning a column through each chip rather than a full row,
since a rounded chip's flat hairline is only a few pixels wide in any single
row. In the Download page, tapping "The First Chapter" turned its ring from
an outline of exactly `#9d9daa` dark / `#5d5d68` light (`BORDER.*.quiet`,
776–828 exact-match pixels around the ring in each theme) to a filled circle
of exactly `#f0a828` dark / `#b26a00` light (`BORDER.*.reading`), zero pixels
of the other theme's version of either colour at the same tolerance. A loose
tolerance (6 levels per channel) does turn up a handful of pixels that read as
the wrong theme's grey at the ring's own antialiased edge (24 of them, light
on dark); tightening to 3 levels or exact finds none, so that is antialiasing
against the tolerance, not a stray colour — worth re-checking at a tighter
tolerance before reporting a chip or ring border as wrong from a loose scan.
`live-theme-drawer.sh` (below) covers the one path this script cannot: a
theme changed while a drawer is already open.

## A live theme change with a drawer already open (#29, `live-theme-drawer.sh`)

`line-colour.sh` always opens a drawer after the theme is already set, so it
cannot show whether an *open* drawer's lines follow a theme changed while the
drawer stays on screen — the one path ADR 0046 made depend on a React
re-render, where every other colour in `INK` needed none.

```sh
bash test/manual-test/scrolling-and-theme/live-theme-drawer.sh SIMULATOR_UDID NEW_OUTPUT_DIR dark light
```

Needs `A Short Test of Reading Aloud` in the Library and this tree's Metro.
`LineColourProbe.testOpenContentsAndLeaveIt` opens Contents by real taps and
leaves it open; the script then photographs it, pushes a theme patch through
the harness without touching the simulator's own appearance, photographs the
same drawer again with no reopen in between, and scores each photograph with
`line-colour.py` against the theme that should be in force at that point. It
restores the starting theme and closes the drawer (`{"do":"shut"}`) before
exiting. Plays nothing. Exit 1 = RED (the drawer did not read as the theme in
force at that point), 0 = GREEN, 3 = the probe itself failed, so the
screenshots may not show the drawer.

Measured 2026-09-24 (ios-tester, `0.0.2-beta22`): dark → light with the
simulator's own appearance kept light throughout — Contents' top edge and
both separators (y=866/1421/1559) read `#33333c` before the patch and
`#dcdce2` after it, at the same rows, with no reopen between the two
screenshots. GREEN.
