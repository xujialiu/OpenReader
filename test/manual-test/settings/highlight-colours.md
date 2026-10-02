# The Highlight section of the Appearance drawer (#118)

Under Alignment: a `Highlight` header, a sample of the page with its sentence
and word marked, the Amber and Blue tiles (the one in force ringed, VoiceOver
names only), and the Sentence and Word rows with the phone's own colour well.
This recipe checks the drawer's side. The page's own paint is
`test/renderer/`'s and the reader's, not this one's.

Prerequisites: this tree's Metro and the Debug app launched with
`-RCT_jsLocation localhost:PORT`; a Document open (the harness `add` and `open`,
README's **Real books**); the drawer up through the harness. No playback, so
nothing to silence beyond what `run-probe.sh` checks.

```sh
node test/manual-test/kit/hx.cjs UDID '{"do":"appearsheet","on":true}'
node test/manual-test/kit/hx.cjs UDID '{"do":"settings","patch":{"theme":"dark"}}'   # or "light"
```

## Layout and the presets

At the Drawer Height the wells are below the screen; a tap on `Sheet Grabber`,
or a drag up on the drawer's content, takes it to `large`, where the whole
section shows. Touch a tile with `kit/ax.py UDID touch Amber` (or `Blue`) and
read the four values back with `hx.cjs UDID '{"do":"saysettings"}'` and Metro's
`HX settings` line. The ring's geometry comes from a screenshot read ÷ 3: a
2-pt ring 1.5 pt off a 60 × 30-pt tile on a 402-pt phone.

## The wells, through XCTest

No AXe or mobilebuildmcp tap opens a SwiftUI well (`../pitfalls/mcp.md`), so
the wells are `HighlightWellProbe.swift`'s:

```sh
bash test/manual-test/kit/run-probe.sh HighlightWellProbe UDID /tmp/hl-ui/probe -only-testing:testPresetStates
bash test/manual-test/kit/run-probe.sh HighlightWellProbe UDID /tmp/hl-ui/probe -only-testing:testWordOpacityDrag
bash test/manual-test/kit/run-probe.sh HighlightWellProbe UDID /tmp/hl-ui/probe -only-testing:testSentenceOpacityToZero
```

- `testPresetStates` prints each tile's `isSelected`: AXe lists no traits.
- `testWordOpacityDrag` takes the drawer to `large` if the well is below the
  screen, opens the Word well, drags the opacity slider from its thumb by 0.3
  of its width, closes the picker, and asserts the drawer's title is back where
  it was. Screenshots: `word-picker`, `word-after-drag`, `word-after-close`.
- `testSentenceOpacityToZero` opens the Sentence well and sets its opacity to
  0 % with `adjust(toNormalizedSliderPosition: 0)`.
- `testGreyFromGrid` and `testBlackSwatch` open the Word well, pick the grid's
  mid grey or the black swatch by the picker's position on a 402 × 874 phone
  (at `large`), and move the opacity: whether a grey comes back as a grey
  (notes, 2026-10-02 10:56). Read the strings from a temporary `console.log`.

The `HIGHLIGHTWELL` lines in the run's `test-STAMP.log` carry the wells'
frames and values, the slider's value before and after, and the title's frame
before and after. Read the saved values with `saysettings`.

It cannot prove that the change is live while the slider moves: the picker
covers the sample. A temporary `console.log` in the well's `onSelectionChange`
counts the changes in Metro's log (notes, 2026-10-02 10:38: 66 in 1.93 s).
Relaunch the app after adding or removing it: a Fast Refresh with the drawer up
cuts the well off from the app.
