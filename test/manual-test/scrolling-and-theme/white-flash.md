# A white page behind the dark reader: on opening, and in a long fling (#27)

`white-flash.sh` records the screen through one trigger and `white-flash.py`
reads every frame of the recording: a frame is white when more than 30 % of the
page area (from under the navigation bar to above the player) has luminance
above 200. A dark page of text reads 4–6 %, a white one 91–98 %. Set the theme
to dark first (`{"do":"settings","patch":{"theme":"dark"}}`), add a real book
(**Real books** in [../README.md](../README.md)), then:

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

## A real finger tap on the Library row (independent #27 verification)

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
