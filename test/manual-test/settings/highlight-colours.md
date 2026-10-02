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

## The page's composites, the accent, and #118's strip (`comp.py`, `sample.py`, `strip118.py`, `accent.js`, `AccentLookupProbe.swift`)

The 2026-10-02 verification of the merged #118 added four tools beside the probe:

- `comp.py SHOT PAGE SENTENCE WORD [x0 y0 x1 y1]` classifies a screenshot's
  pixels (points) into page / sentence-composite / word-composite and prints
  each class's share and mean colour, the bands' extents, and whether the word
  band sits inside the sentence band. It measured all four preset composites
  exact against the model's arithmetic (Blue `#d6d6dd`/`#7b87de` on white,
  `#1c1d26`/`#354098` on `#111114`; Amber `#fff2c7`/`#ffc44c`,
  `#453810`/`#b87d06`). It cannot prove where a colour came from — only that
  the screen holds it.
- `sample.py SHOT X0 Y0 X1 Y1 [EXPECT TOL]` prints a small rect's most common
  colours and, with an expectation, the share within tolerance and the closest
  pixel. This is how every accent spot was read (checks, links, rows,
  capsules, circles, the Lookup drawer's actions). Glyph antialiasing means
  only the purest pixels match exactly; judge by the closest colour and its
  share, not by coverage alone.
- `strip118.py SHOT WORD_RGB LINE_PX [TOL]` is `scrolling-and-theme/`'s
  leading-strip detector re-coloured for #118 (the old one is hardcoded to the
  dark page's retired `rgba(255,176,0,0.85)`). **It counts the player's A as a
  match** — the A is deliberately the word mark's composite now (Q5 = A) — so
  bound it to the text area above the player (crop, or read only y < ~700 pt
  on a 402 × 874 phone) before calling a RED.
- `accent.js WORD SCHEME` ports `src/app/accent.ts`'s pure arithmetic and
  prints the expected `reading`/`onMark` for any word colour — the ADR's table
  for the presets, and the expectation for a custom pick.
- `AccentLookupProbe.swift` runs through `run-probe.sh` like any probe:
  `testGeneralLinkBracket` turns General's interlock switch over an invalid
  `bracketPairs` (patch `{"bracketPairs":"((("}` first — the link only exists
  while the check refuses) and photographs the reset link; `testLookupAccents`
  long-presses the page open and photographs the Lookup drawer (it asserts
  `Choose a Voice` first: an `xcodebuild` run can relaunch the app —
  `../pitfalls/mcp.md`); `testPickCustomWord` opens the Word well and taps the
  grid's saturated row (read the saved hex back with `saysettings`, then
  `accent.js` for the expectation).

What these cannot prove: `comp.py`/`sample.py` read still screenshots — a
colour that arrives late (the stale-paint finding below) looks correct once
anything else has repainted the page, so every live-repaint claim needs the
screenshot taken before any other interaction. And the Lookup drawer's spinner
was only caught under a consent alert's scrim, which darkens it; its exact
accent was not measured unscreened.
