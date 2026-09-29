# Margins in the Appearance drawer (#84, ADR 0056)

The Margins row sits between Font Size and Alignment, with the same stepper as
Font Size: minus / number / plus, ladder 8–48 in steps of 4, default 16, minus
disabled at 8 and plus at 48, VoiceOver labels `Decrease margins` /
`Increase margins`. The page's body text then sits exactly N points from each
screen edge (402-pt phone: text spans N … 402−N), the value persists in
Documents/settings.json as `appearance.margins`, and a change re-centres the
sentence being read without moving the Reading Position.

Prerequisites: this tree's Metro and the Debug app launched with
`-RCT_jsLocation localhost:8085`; the Scroll Fixture open and paused with a
highlighted sentence mid-page (the harness `{"do":"seek","utterance":N}` sets
one without playback, or open the Document whose position already names one).
No playback, so no silencing.

## Stepping the ladder

Open the sheet by real touches (More actions → Appearance), then tap minus and
plus with the MCP `touch` down/up pair — quick `tap` calls can silently no-op
(pitfalls/mcp.md), and a touch pair reads as a tap to a Pressable. Verify every
step by the number in the fresh snapshot (16 → 20 → …), and the disabled ends
twice over: the dimmed icon in a screenshot, and the button vanishing from the
snapshot's actionable targets. `ReaderTitleProbe.swift` (library-and-reader)
asserts the four labels through XCTest taps; `test/renderer/appearance.test.ts`
covers the ladder in Vitest.

## Measuring the page

```sh
xcrun simctl io SIMULATOR_UDID screenshot /tmp/margins.png
python3 test/manual-test/kit/ink.py /tmp/margins.png 120 690
```

`ink.py` prints the body text's minimum-left / maximum-right ink columns in
points over the row band (default below the 54-pt bar, above the player).
Measured on iPhone 18 Pro (iOS 27.0): margins 8 → 8.0…394.0 (glyph antialiasing
fringe reaches ~1.3 pt outside on a few rows), 16 → 16.0…386.3, 32 → 32.0…370.0,
48 → 48.0…354.0; the same values in the light theme. A settings file with no
`margins` key reads as 16 (a pre-#84 file), and the written value survives a
relaunch — check both the sheet's number and the page's edges after
`simctl terminate` + `launch`.

The re-centre: find the highlighted sentence's band (rows where a solid
highlight-coloured run spans the text area) before and after a margins change.
Both runs measured the band starting at exactly y 418.3 pt at margins 16 and
48, while the text's x-extent tracked the new margins — the sentence stays at
the Line Position, and the Reading Position (the Library entry's anchor) does
not move.

What this cannot prove: `ink.py` measures rendered ink, not the CSS box (a
Document whose own `!important` body margin survives would still show correct
edges only if the owner's padding wins — the Vitest suite covers the rule, a
page with such a margin was not run here); and the touch pairs say nothing
about a physical device's touch latency.
