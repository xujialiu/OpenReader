---
status: accepted
---

# The Highlight Colours are a colour and a whole percent per level, stored as Zotero-TTS stores them, painted in both themes, with the accent taken from the word's

_The product argument is [design 0068](../design/0068-the-highlight-colours-are-the-owners.md).
Issue #118; the plan is the owner's comment there, decided on 2026-10-01 (Q1–Q17,
with Q5 = A, Q6 = B and Q8 = A). **Highlight Colours** is in CONTEXT.md, as
part of **Appearance**. The facts are in `notes/NOTES_2026-10-02.md`, 10:04 to
10:08. It revises the dark theme's two `::highlight()` overrides in
[ADR 0022](0022-the-theme-is-two-stylesheets-and-one-resolved-answer.md) (#69),
and the amber accent (`INK.reading`, `INK.readingWash`, `BORDER.reading`) that
ADR 0022, [ADR 0041](0041-settings-rows-and-the-speed-popover.md)'s rows and
[ADR 0066](0066-every-drawer-rises-to-the-drawer-height.md)'s current row are
drawn in._

**Built in parallel lanes** (the plan's table). The model is `7e303fb`. The
page (`src/renderer/`), the accent (`src/app/controls.tsx`, a new accent module
and its users) and the Appearance section (`src/app/appearance-sheet.tsx` and a
new section file) are being built now. Their commits, names and measurements
are listed under "To be recorded" below and are not written here until they are
merged. The owner has not yet accepted the result on the iPhone.

## What was there

- **The light page** painted the two levels from `DEFAULT_HIGHLIGHT` in
  `src/renderer/highlighter.ts`, baked into the section's stylesheet:
  `::highlight(openreader-utterance) { background-color: rgba(255, 196, 0, 0.22); }`
  and `::highlight(openreader-word) { background-color: rgba(255, 168, 0, 0.62); }`.
- **The dark page** overrode both from `themeCss('dark')`, later in the same
  stylesheet: opaque `DARK_UTTERANCE` `#434665` and `DARK_WORD` `#4456de`, with
  no `color`, so the letters stayed `#e6e6ea` (ADR 0022, #69). `#e6e6ea` on
  `#4456de` is 4.65:1; on `#434665` it is 7.33:1.
- **The accent** was `PALETTE.light.reading` `#b26a00` and
  `PALETTE.dark.reading` `#f0a828`, as `INK.reading` (a `DynamicColorIOS`),
  `BORDER.reading` (a plain string, ADR 0046) and `INK.readingWash`, the
  accent at 24 % behind the player's A (#71, as Zotero-TTS draws its A). At
  `7e303fb`, `INK.reading` drew the download ring (`download-ring.tsx`), the
  checks (`controls.tsx`'s `NavigationRow`, `appearance-sheet.tsx`,
  `download-sheet.tsx`), the current row in Contents, Voice and Download, the
  links in General and Download, the drawer header's capsule action
  (`drawer.tsx`), `ActionRow`, and Lookup's actions and spinners;
  `INK.readingWash` was used once, the player's `markFollowing`. `#b26a00` is
  4.24:1 on white and 3.86:1 on `#f4f4f6`, below 4.5:1 on both (notes 10:06).
- **Appearance** was `{ font, size, margins, textAlignment }`, and its drawer
  offered Font, Font Size, Margins and Alignment.

## The model

`src/renderer/highlight-colours.ts` (`7e303fb`) is the one model, and it imports
nothing, so the page's stylesheet, the accent in `src/app/`, the drawer and the
tests all read it. `test/renderer/highlight-colours.test.ts` covers it.

- **`Appearance.highlight: HighlightColours`**,
  `{ sentence: HighlightColour, word: HighlightColour }`, and a
  `HighlightColour` is `{ color, opacity }`. It is part of `Appearance` in
  `highlighter.ts`, and is the same under either `ReadingScheme`. Like the rest
  of Appearance it is not in `engineIdentity`: it changes no character of what
  is spoken.
- **Stored as the desktop Zotero-TTS plugin stores them.** A colour is `#rrggbb`
  in lower case, and an opacity a whole percent, 0–100. Zotero-TTS
  (`fdd33f7`) keeps `highlight.sentenceColor` / `sentenceAlpha` and
  `wordColor` / `wordAlpha`: the colour from an `<input type="color">`, the
  alpha a number clamped to 0–100 and not rounded (notes 10:08). The shape is
  the same so that the values mean the same on both. Nothing carries them
  between the two today: `settings-storage.ts` is local persistence, "not the
  shared sync format". Zotero-TTS's own defaults (`#ffff00` and `#3478f6`, both
  at 70) are not taken, and its two on/off booleans, `highlight.sentence` and
  `highlight.word`, have no counterpart: a level at opacity 0 is a level
  turned off.
- **Opacity 0 is allowed** (owner's Q11). A word at 0 is a reading marked by the
  sentence alone.
- **Reading back.** `readHighlightColours` takes each level's colour and opacity
  on its own. A colour that is not `#rrggbb` (any case, trimmed) is read as its
  first six digits if it is `#rrggbbaa`, and otherwise falls back to Blue's for
  that level. An opacity that is not a finite number falls back too. A number
  is clamped to 0–100 and rounded. `parseSettings` calls it for
  `appearance.highlight`, so a file written before #118 reads as Blue.
- **The CSS colour.** `rgba(level)` builds `rgba(r, g, b, a)` from the three
  channels as integers and the opacity as a fraction. Only digits, commas,
  points and spaces come from the stored values, so a colour from the owner,
  even one read back malformed from a file, cannot put anything else into the
  stylesheet. This is what ADR 0021 and 0022 need to stay true: nothing may
  declare `user-select`, which silently stops `::highlight()` from painting.

## The presets, and Blue by default

`HIGHLIGHT_PRESETS`, offered in `HIGHLIGHT_PRESET_ORDER` (Amber, then Blue), read
by VoiceOver from `HIGHLIGHT_PRESET_LABELS` (owner's Q2 and Q7):

| preset | sentence | word |
| --- | --- | --- |
| **Amber** | `#ffc400` at 22 % (`rgba(255,196,0,0.22)`, the old light sentence) | `#ffa800` at 62 % (`rgba(255,168,0,0.62)`, the old light word) |
| **Blue** | `#434665` at 22 % (#69's sentence) | `#4456de` at 62 % (#69's word) |

Blue is #69's two colours at amber's opacities, not opaque. Opaque, its sentence
would put a light book's black letters on `#434665` at 2.3:1, and the two themes
now share one mark.

`DEFAULT_HIGHLIGHT_COLOURS` is Blue (owner's Q4), for a new install and for a
file written before #118, because it is the only one of the two whose spoken
word stays readable on both pages.

**Contrast** (notes 10:04). WCAG 2.x contrast; the sentence composited over the
page, the word over that, each rounded to 8 bits as the screen holds it. The
letters are a book's black on the white page, since `themeCss('light')`
repaints nothing, and `#e6e6ea` on `#111114`.

| preset | page | sentence against the page | letters on the word |
| --- | --- | --- | --- |
| Blue | `#ffffff` | **1.45:1** | **6.4:1** (6.36) under black |
| Amber | `#ffffff` | 1.12:1 | 13.3:1 under black |
| Blue | `#111114` | **1.12:1** | **7.2:1** (7.22) under `#e6e6ea` |
| Amber | `#111114` | 1.64:1 | **2.82:1** under `#e6e6ea` |

Blue's word on the dark page is lighter at 62 % than the opaque `#4456de` was,
so its letters rise from 4.65:1 to 7.2:1. Its sentence sinks from 2.07:1 against
the page, opaque, to 1.12:1. Design 0068 counts that as a cost. Amber's
2.82:1 on the dark page is the case design 0022 turned away from, and it is
allowed because the owner chooses the colours. Nothing recolours the word's
letters: the `::highlight()` rules declare `background-color` only.

**`presetOf`** names the preset only when all four values, both colours and both
opacities, are that preset's (owner's Q12). The drawer rings that tile and no
other.

## The picker's `#RRGGBBAA` round trip

The Sentence and Word wells are `@expo/ui`'s SwiftUI `ColorPicker` with
`supportsOpacity`, the phone's own picker, whose opacity slider is the level's
opacity. `ColorPickerProps.selection` is `#RRGGBB` or `#RRGGBBAA`
(`node_modules/@expo/ui/build/swift-ui/ColorPicker/index.d.ts`, 57.0.19).
`ColorPickerView.swift`'s `colorToHex` answers `#%02X%02X%02X%02X`, upper case.
Each channel is clamped to 0–1 before it is scaled, so a Display P3 pick
outside sRGB is clamped. An answer equal to the last one is not sent (notes
10:07, read from the source and not measured).

- **`toPicker(level)`** gives the stored colour and `round(opacity × 2.55)` as
  the alpha byte, as two lower-case hex digits: 22 % is `38`, 62 % is `9e`.
- **`fromPicker(value)`** reads `#RRGGBBAA` as the lower-cased colour and
  `round(byte / 255 × 100)`. A bare `#RRGGBB` is opaque, 100 %. Anything else
  is null.
- **Every whole percent, 0–100, survives** `toPicker` then `fromPicker`. Of the
  256 alpha bytes the picker can answer, 155 are given back one byte off, the
  percent's own byte, and never more than one. After that one step the byte is
  stable. Feeding the picker back its own answer does not echo: a new
  `selection` resets `previousHex` before the `onChange` that compares against
  it.

## To be recorded when the lanes merge

What the other lanes are building now. Each item is a fact this ADR needs, and
none of it is written above until it is merged:

- **The page** (lane R, `src/renderer/`):
  - how the owner's colours reach the two `::highlight()` rules: which part
    of the one stylesheet carries them (`CSS_TEXT`, `THEME` or `APPEARANCE`),
    and so whether ADR 0022's "it declares a font and a size and never a
    colour" still holds;
  - that `DEFAULT_HIGHLIGHT` and `themeCss`'s two overrides
    (`DARK_UTTERANCE`, `DARK_WORD`) are gone, with the commit;
  - which message carries a change to an open Document, and whether it
    restyles without a settle, as the theme does;
  - the tests that pin the emitted rules and the `user-select` guard.
- **The accent** (lane A, `src/app/controls.tsx` and a new module):
  - the derivation's name and its arithmetic: how the hue is kept, how far it
    is darkened in light and lightened in dark, and whether a colour already
    at 4.5:1 is left alone;
  - which surfaces it is measured against. The inputs are in notes 10:06:
    Blue's `#4456de` is 5.78:1 on `#ffffff`, 5.26 on `#f4f4f6`, 3.26 on
    `#111114` and 2.93 on `#1c1c21`. Amber's `#ffa800` is 1.93, 1.76, 9.74 and
    8.77;
  - the hook or context that replaces the module-scope `INK.reading`,
    `INK.readingWash` and `BORDER.reading`, and how a change reaches screens
    that used to repaint with no render;
  - the A (Q5 = A): the word's colour at the word's opacity, in place of
    `readingWash`;
  - the unit tests' extreme colours, and the contrast each reaches;
  - the revised comments in `controls.tsx` (the `PALETTE` and `INK.reading`
    notes that say the accent stayed amber).
- **The Appearance section** (lane U, `appearance-sheet.tsx` and a new file):
  - the components' names;
  - the sample sentence's font and colours, the interface font for Original
    Book Font;
  - the tiles' size and ring, their VoiceOver labels and how they are reached;
  - the `ColorPicker` rows' hosting and size inside the drawer's
    `RNHostView`;
  - what was measured on the simulator.
- **On the simulator, before the owner's acceptance** (the plan's
  verification):
  - both presets in both themes;
  - a custom colour and opacity through the picker, live on the page;
  - opacity 0;
  - the preset ring;
  - the A;
  - the accent in a drawer and in Settings;
  - whether a grey from the picker's grid comes back with the right green.
    `colorToHex` reads `components[1]` as green whenever there is more than
    one component, so a grey-space `CGColor`, which has two (white and alpha),
    would answer its alpha there (notes 10:07).

## Alternatives

- **Separate colours per theme**, `{ light, dark }` per level. Twice the
  settings, and the Theme would still change the mark, which is #118's
  complaint.
- **Recolouring the word's letters below a contrast threshold**, a `color` in
  the word's `::highlight()` rule. That is the first dark rule of ADR 0022
  (`rgba(255,176,0,0.85)` with `#111114` letters), which the owner turned down
  under #69.
- **A fixed palette of swatches.** It cannot reach a colour the desktop plugin
  stores, and the two presets already give the one-tap choices.
- **A separate opacity stepper.** `ColorPicker` with `supportsOpacity` carries
  the opacity in its `#RRGGBBAA`, so a stepper would be a second control for
  the same byte.
- **The accent staying amber** (`INK.reading` as it was). The owner chose
  B in Q6: the accent follows the word.
