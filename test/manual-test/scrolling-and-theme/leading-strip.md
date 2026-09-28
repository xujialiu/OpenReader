# A moved highlight leaves a strip behind (#35, `leading-strip.sh`)

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
