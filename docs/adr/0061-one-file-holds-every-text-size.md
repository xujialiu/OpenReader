---
status: accepted
---

# One file holds every text size: the phone's styles, without their leading

_The product argument is [design 0061](../design/0061-the-apps-words-are-set-in-the-phones-text-styles.md).
Issue #99. The lookup drawer's selected text and result are to follow
Appearance instead (#98)._

## What was done

- `src/app/text-styles.ts` exports `TEXT` and `TEXT_EMPHASIZED`: for each of
  `title2`, `title3`, `headline`, `body`, `callout`, `subhead`, `footnote` and
  `caption1`, an object with `fontSize` and `fontWeight` and nothing else.
  Styles spread one and add colour and layout:
  `{ ...TEXT.body, color: INK.text }`. Text that changes weight and nothing
  else when it is chosen takes the weight alone,
  `fontWeight: TEXT_EMPHASIZED.body.fontWeight`.
- Every file in `src/app` refers to it. `SETTINGS.fontSize` (17) in
  `controls.tsx` and `TITLE_SIZE` (17) in `reader-title.tsx` are gone. The
  native-stack bars get `headerTitleStyle: { ...TEXT.headline, color }` in
  `shell.tsx`: the phone still draws the title, and is handed the size and
  weight it already used.
- `test/app/text-styles.test.ts` reads every `.ts`/`.tsx` in `src/app` except
  `text-styles.ts` and fails on `fontSize:` or `lineHeight:` anywhere, and on
  `fontWeight:` not followed by `TEXT.` or `TEXT_EMPHASIZED.`
  (`/\b(fontSize|lineHeight)\s*:|\bfontWeight\s*:(?!\s*TEXT(_EMPHASIZED)?\.)/g`).
  The negative lookahead has to follow the colon directly: written after
  `:\s*`, the `\s*` backtracks to zero and the lookahead sees the space. It pins
  the values of `headline`, `body`, `subhead`, `footnote`, `caption1` and
  `title2` emphasized, that no style carries `lineHeight`, and the bars'
  `headerTitleStyle`.
- The renderer's page CSS is not covered: its sizes are Appearance's.

## The numbers, and where they come from

Apple's Human Interface Guidelines, Typography, table "iOS, iPadOS Dynamic Type
sizes", tab "Large (default)", read on 2026-09-30 from
`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json`
(the HTML page is rendered by JavaScript; the JSON behind it has the tables):

| Style | Weight | Size | Leading | Emphasized |
| --- | --- | --- | --- | --- |
| Large Title | Regular | 34 | 41 | Bold |
| Title 1 | Regular | 28 | 34 | Bold |
| Title 2 | Regular | 22 | 28 | Bold |
| Title 3 | Regular | 20 | 25 | Semibold |
| Headline | Semibold | 17 | 22 | Semibold |
| Body | Regular | 17 | 22 | Semibold |
| Callout | Regular | 16 | 21 | Semibold |
| Subhead | Regular | 15 | 20 | Semibold |
| Footnote | Regular | 13 | 18 | Semibold |
| Caption 1 | Regular | 12 | 16 | Semibold |
| Caption 2 | Regular | 11 | 13 | Semibold |

`text-styles.ts` keeps the eight the app uses, as React Native weights (Regular
`'400'`, Semibold `'600'`, Bold `'700'`).

## Why no leading

The trial (`0.0.2-beta65`) set each style's `lineHeight` to the table's leading.
The phone does not draw its own text on it. The pixel measurement of iOS 27.0's
own Settings (notes, 2026-09-23 17:18) found "a footer is 13 pt on a 16 pt line
(lines 48 px apart)", where the table says Footnote 18. SF Pro's own line
height at 13 pt is about 15.5 (ascender 0.952 plus descender 0.241 of the size).
A `Text` with no `lineHeight` gets the font's own through TextKit, as a
`UILabel` does, so `text-styles.ts` sets none (`0.0.2-beta66`). Whether the
phone rounds 15.5 up to 16 for a `UILabel`, and what its multi-line Body lists
measure, has not been measured.

The settings group title had `lineHeight: 22` with `marginBottom: 6`, fitted to
the phone's "7 pt above its card, ink to card". With the font's own line height
(about 20.3 at 17 pt) the title's box is about 1.7 pt shorter; the distance to
the card was not measured again.

## The mapping

| Text | Before | Style |
| --- | --- | --- |
| Drawer titles (`sheet.tsx`), bar titles, the reader's title | 18/700; the phone's; 17/600 | `headline` |
| Library row name (`DocumentRow`) | 17/500/23 | `headline` |
| Settings group title | 17/600/22 | `headline` |
| Speed in the bubble (`player.tsx` `rate`) | 17/600 | `headline` |
| Download's main button | 16/600 | `headline` |
| Contents headings | 16/700 | `headline` |
| Settings rows, values, fields, text rows, actions | 17 | `body` |
| Drawer rows: actions, Appearance, Fonts, Download chapters, Contents, Voice names; Rename's field | 15–17 | `body` (chosen/current/parents: emphasized weight) |
| Lookup: definition (until #98), Play, Retry, Copy | 17/25; 16 | `body` |
| Header text button (`HeaderButton` without an icon; no caller uses it) | 16/600 | `body` |
| Settings row note, waiting text, lookup errors and phonetic, Download's voice line and links, Voice chips | 14–15 | `subhead` (chosen chip: emphasized) |
| Player: speed on its button; voice name | 15/600; 14/500 | `subhead` emphasized; `subhead` |
| Lookup: Dictionary/Translation | 14/600 | `subhead` emphasized |
| `Note`, Library progress, settings footers, General's link, Download's secondary lines and errors, lookup source | 13 (lines 16–19) | `footnote` |
| Player: A/M letter | 13/500 | `footnote` emphasized |
| Player notes | 12/17 | `caption1` |
| Library empty title / sentence | 20/700; 15/22 | `title3` emphasized; `subhead` |
| Lookup: the selected text (until #98) | 22/600 | `title2` emphasized |

## Not measured

- React Native scales every `fontSize` by one multiplier for the phone's text
  size (`allowFontScaling`), where iOS scales each text style by its own amount.
  At the default size the two agree; above it they do not, by amounts not
  measured here.
- The reader's title keeps `allowFontScaling={false}` (ADR 0057).
