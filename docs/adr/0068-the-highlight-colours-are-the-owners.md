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

**Built in parallel lanes** (the plan's table), merged into
`xujialiu/highlight`: the model `7e303fb`, the page `e57ee0c`, the accent
`9da5b84`–`fca3656`, the Appearance section `ef51ce7`–`20eada8`, and the
interim accent removed in `054b298`, and the live repaint fixed in `3e5a949`.
Accepted by the owner on the iPhone on `1.0.0-beta12` (2026-10-02), with the
presets as built.

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

_Original #118 values and measurements below. #122 revises Blue to 60%/50%
and puts it first; the accepted native-palette revision is recorded below._

`HIGHLIGHT_PRESETS`, originally offered in `HIGHLIGHT_PRESET_ORDER` (Amber, then Blue), read
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

## The original picker's `#RRGGBBAA` round trip

_The wells were replaced by inline sliders in #122 (below). These are the
original picker findings; the conversion helpers and their tests remain._

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

## The page

- **One stylesheet, the owner's colours in it.** `highlightCss` builds the two
  `::highlight()` rules from `appearance.highlight` with the model's `rgba()`,
  after `SELECTABLE`, which stays first and unchanged. `themeCss` declares the
  dark page and its text and no highlight rule: `DARK_UTTERANCE`,
  `DARK_WORD`, `DEFAULT_HIGHLIGHT` and `HighlightStyles` are gone, and
  `highlighterSource` takes the Appearance first (`e57ee0c`).
- **A `'highlight'` message.** A change to the colours alone reaches an open
  Document as its own message (`src/renderer/messages.ts`), which swaps the
  stylesheet in every section without moving the page, as the theme does. The
  appearance message would have settled the page back on the spoken line while
  the owner browsed elsewhere. `setAppearance` sends it when only the colours
  changed, and the appearance message as well when anything else did. It is
  sent again when the program installs, if the colours changed since it was
  built. A message without CSS is dropped, so it can never remove
  `SELECTABLE`. The two `Highlight`s are never re-registered, so the word stays
  painted over the sentence.
- **Tests.** `test/renderer/appearance.test.ts` ("Highlight Colours as a
  stylesheet") pins the CSS for Blue and Amber and for opacity 0, and checks
  that a malformed setting yields only `SELECTABLE` and the two
  `background-color` rules. `test/renderer/rules.test.ts` checks that dark
  declares no highlight and no `color`, and runs the page's own `'highlight'`
  handler.

## The accent

_The measured table below records the original #118 presets. #126 changes the
preset inputs, not this accent algorithm; current expectations are pinned in
`test/app/accent.test.ts`._

- **`src/app/accent.ts`, pure.** `readingAccent(highlight, scheme)` keeps the
  word colour's hue and mixes it towards black (light) or white (dark) only as
  far as 4.5:1 needs; a colour already there is left alone. It gives three
  values:
  - `reading`, held to light `#ffffff` / `#f4f4f6` and dark `#111114` /
    `#1c1c21`;
  - `onMark`, a stricter shade of the same hue for text on the drawer's marked
    row and round-button fill (light `#dcdce2` / `#ffffff`, dark `#3e3e47` /
    `#2c2c32`). At `reading` Blue there was 4.23:1 light and 2.83:1 dark;
  - `following`, the word colour at the word's opacity, for the player's A
    (Q5 = A).

| word | theme | `reading` | `onMark` |
| --- | --- | --- | --- |
| Blue | light | `#4456de` (kept), 5.26 | `#4152d5`, 4.53 |
| Blue | dark | `#6c7be5`, 4.53 | `#9ba5ed`, 4.53 |
| Amber | light | `#9a6500`, 4.51 | `#865800`, 4.51 |
| Amber | dark | `#ffa800` (kept), 8.77 | `#ffa800` (kept), 5.47 |

  The lowest ratio across each set of surfaces (notes 10:15). White, black,
  pure yellow and `#0a1a3a` reach at least 4.50 in both themes
  (`test/app/accent.test.ts`, 18 tests).
- **Plumbing.** The shell works the accent out from
  `settings.appearance.highlight` and the theme and passes it in
  `AccentContext`; screens read `useAccent()` in `controls.tsx`, which throws
  outside the shell as `useBorders()` does. The values are plain strings, so a
  border can take them (ADR 0046). `PALETTE.*.reading`, `BORDER.reading`,
  `INK.readingWash`, `wash()` and, after the merge, `INK.reading` are gone.
- **`onMark` is used** for the current row's text in Contents, for the
  whole of Download's current chapter row (text, check, selection circle, ring)
  and for the header capsule's text (Select all). Everything else that was
  amber takes `reading`.

## The original Appearance section

_Replaced by the Highlight page in #122 (below); the original measurements
are retained here._

- **`src/app/highlight-section.tsx`**, under Alignment as rows of the drawer's
  plain list, with its arithmetic in `src/app/highlight-paint.ts`
  (`test/app/highlight-paint.test.ts`):
  - **"Highlight"** in the settings pages' header style.
  - **A sample**: "The rain had stopped by morning. She opened the **window**
    and listened to the birds." It is set on the page's own colours (white
    with black text, or `#111114` with `#e6e6ea`) and in the Appearance font,
    or the interface font for Original Book Font and System. The second
    sentence is marked, and "window" is marked over it.
  - **Tiles** for Amber and Blue, 60 × 30 pt, so five tiles and their gaps
    would fill the row, as in the owner's reference image (62–63 × 30.5 pt
    there). Each shows "Aa" as the word would look on the page. The one in
    force has a 2-pt ring in its word colour, 1.5 pt off the tile. A tap sets
    all four values. VoiceOver reads "Amber" or "Blue" with the selected state.
  - **Sentence and Word** rows, each with the phone's own `ColorPicker`
    (`supportsOpacity`) in a host only as big as its 28-pt well, so the drawer
    stays on screen when the picker opens over it. Each change goes through
    `fromPicker` into `appearance.highlight` and is saved as it happens.
- **Measured on the simulator** (notes 10:38). The tiles' colours match the
  arithmetic within a level: Amber on the dark page (165,111,8) against
  (164.6,111.1,9.1). The picker opened over the drawer, which stayed at its
  height. A Word opacity drag gave 66 changes in 1.93 s. A Sentence at 0 %
  saved `{"color":"#ffc400","opacity":0}`.
- **At the Drawer Height of 50 %**, the header and sample show, and the tiles
  and wells are below the screen; a swipe up takes the drawer to `large`,
  where the whole section fits.
- **Greys.** `colorToHex` in `@expo/ui`'s `ColorPickerView.swift` reads
  `components[1]` as green whenever there is more than one component, so a
  grey-space `CGColor` (white, alpha) would answer its alpha there (notes
  10:07). Tried three ways on the simulator, it never did: the grid's
  mid-grey cell at 62 % answered `#9999999E`, a stored `#808080` with its
  slider dragged to 0 answered `#808080` throughout, and the black swatch
  answered black (notes 10:56). The path is real but was not reached.
- **The wells take an XCTest tap, not AXe** (`HighlightWellProbe`,
  `test/manual-test/settings/highlight-colours.md`).

## Highlight as its own page (#122, 2026-10-02)

The owner replaced the section with one disclosure row below Alignment.
`reader-actions.tsx` maps `highlight` back to `appearance`, just as `fonts`
does. The standalone `AppearanceSheet` used by the walkthrough has the same
navigation. Dismissing and reopening starts outside the editor, as before.

The first implementation (`4e6a7b1`, beta17) used inline RGB/opacity sliders.
The owner rejected it: RGB was too abstract and the presets were hidden below
it. That editor and its helper were removed, not retained as another mode.

### Accepted native-palette prototype

Primary source: `xujialiu/highlight-2--palette-prototype`, `dd3ed65` then
`332179a`, with its recipe and Swift source under `test/manual-test/settings/`.
A separate UIKit app established public child-controller containment of
`UIColorPickerViewController` on iOS 27.0, plus real Grid, Spectrum and opacity
touches while a fixed sample remained visible. The owner accepted the layout,
then explicitly removed the proposed upper-right eyedropper rather than ship
its nonworking prototype button.

Setting `title = ""` removes Colors. On iOS 27, additionally setting
`supportsEyedropper = false` removes the entire system header, without private
subview manipulation or clipping offsets. That property is public from iOS 26;
on older supported systems UIKit does not expose hiding its eyedropper. The
availability guard preserves compatibility; the headerless layout is verified
on iOS 27, not a promise about older OS versions.

### Production boundary

`HighlightPage` owns a one-line preview, the Blue/Amber Aa tiles immediately
below it, then the native Sentence / Word segmented control. These sit outside
`DrawerScroll`. The sample uses the existing `sentencePaint` / `wordPaint`
arithmetic, chosen font at Body size, and `numberOfLines={1}`. It reads
"Rain fell. Birds **sang**.", with the first sentence unmarked; at larger font
scales or narrower widths the words shorten to "Go. We **run**." The font is
never shrunk. Both marks stay visible regardless of the editing target.

`modules/open-reader-palette/` is a local Expo view, containing only UIKit's
palette. Its view attaches the picker to the nearest responder-chain view
controller with `addChild` / `didMove`, and detaches it and its delegate when
removed from the window. It sets the native view's frame to its bounds. The
palette gets enough height for its grid, opacity and saved swatches; only that
area scrolls when the drawer is shorter. No second modal or private API is used.

Each native event includes an incrementing count and `#rrggbbaa`. JavaScript
acknowledges the count together with the controlled value; native selection
props older than the last event are ignored so a delayed React render cannot
rewind a drag. A target switch remounts the native picker and acknowledgement
state together. `UIColor.getRed` handles greys without treating white/alpha
components as RGB. The existing `fromPicker` / `toPicker` conversions keep
whole-percent storage and both 0 and 100. A change takes the existing Appearance
callback immediately; persistence, live renderer repaint and accent derivation
are not replaced.

### Revised Blue preset (#122; superseded by #126 below)

Blue became first, `#434665` at 60% for Sentence and `#4456de` at 50% for Word.
Amber is unchanged. Defaults for absent settings follow Blue, but saved 22%/62%
Blue remains exactly that choice and matches neither current preset. There is
no migration that silently changes saved colours. Tests pin both the new
preset and preservation of the old values.

Sources: [Expo native view tutorial](https://docs.expo.dev/modules/native-view-tutorial/),
[SDK 57 Picker](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/picker/),
[UIColorPickerViewController](https://developer.apple.com/documentation/uikit/uicolorpickerviewcontroller),
and the installed iOS 27 public `UIColorPickerViewController.h`.

## Balanced shared presets (#126, 2026-10-03)

The owner requested gentler Blue and Amber variants and four light/dark screenshots.
Only the preset constants change; IDs, order, palette, theme-independent storage,
background-only CSS and accent derivation stay the same. Saved original Blue,
#122 Blue and original Amber are regression-tested as unchanged, not migrated.
Selecting a preset explicitly applies the revised values.

| preset | sentence | word |
| --- | --- | --- |
| Blue | `#5965a8` at 22% | `#5c73e6` at 44% |
| Amber | `#e4ad38` at 18% | `#d99324` at 38% |

Calculated with `sentencePaint`, then `wordPaint` (word over sentence over page,
rounded at each step), and `contrast` from the accent module:

| preset | theme | sentence composite | word composite | text/sentence | text/word |
| --- | --- | --- | --- | --- | --- |
| Blue | light | `#daddec` | `#a3aee9` | 15.53:1 | 9.79:1 |
| Blue | dark | `#212335` | `#3b4683` | 12.44:1 | 7.06:1 |
| Amber | light | `#faf0db` | `#edcd95` | 18.55:1 | 13.77:1 |
| Amber | dark | `#372d1a` | `#75541e` | 10.87:1 | 5.54:1 |

These are calculations for the app's reference page/text colours, not a claim
about every publisher stylesheet or visual acceptance. Tests pin the composites
and require at least 4.5:1 for text on both levels in both themes. Native screenshots
and owner acceptance remain separate from arithmetic. The implementation is
1.0.1-beta1 and does not replace the submitted 1.0.0(3).

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
