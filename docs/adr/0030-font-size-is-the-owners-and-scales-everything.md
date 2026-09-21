---
status: accepted
---

# Font Size is the owner's, and one text-size-adjust scales everything a Document set

_The product argument is [design 0030](../design/0030-one-size-for-every-document.md)._
**This revises ADR 0021's size.** A size is no longer a percentage of what the
Document set, and it no longer starts on the Document's own. It is how big the
body text of every Document is shown, in CSS pixels, starting at 16. The font
half of ADR 0021, and ADR 0029's list, are unchanged. So is the architecture:
Appearance is still one stylesheet the page already has, and it still arrives
as finished CSS that `appearanceCss` builds on the React Native side.

## The rule

```css
html, body, body * { -webkit-text-size-adjust: P% !important; }
html, body, body * { text-size-adjust: P% !important; }
```

`P = size / bodyTextSize × 100`. `size` is one of `FONT_SIZES`, and
`bodyTextSize` is the Document's own body text size (below). `P` is rounded to
four decimals and clamped to 25–400%. A `bodyTextSize` that is null or not a
pixel size (`isPixelSize`: positive and finite) is read as
`PLAIN_BODY_TEXT_SIZE` (16), and so is a `size` that is not one. The font rule
is unchanged: `html, body, body * { font-family: … }` from `READING_FONTS`, or
nothing.

**Why text-size-adjust and not `font-size`.** It multiplies every size the
Document set: em, rem, px and keyword sizes alike. Measured in the reader's own
epub.js section frame, on the iPhone 16 simulator (iOS 27.0), with a plain
paragraph, a `12px` paragraph and an `x-small` span
(`notes/NOTES_2026-09-21.md`, 11:34):

| rule | paragraph | 12px | x-small |
| --- | --- | --- | --- |
| none | 16px | 12px | 10px |
| 150% | 24px | 18px | 15px |
| 75% | 12px | 9px | 7.5px |
| 106.25% | 17px | 12.75px | 10.625px |
| 200% | 32px | 24px | 20px |

A root `font-size`, which is what ADR 0021 shipped, reaches only what is sized
relative to the root. It never reached a keyword size: 仙逆's chapter-number
badge (`span.num`, `x-small`) was 10px at every setting. It also overshot on a
Document that shrinks its root and puts its paragraphs back in rem. With
`html { font-size: 62.5% }` and `p { font-size: 1.6rem }`, the body text is
16px, and ADR 0021's `html { font-size: 110% }` made it 1.6 × 17.6 = 28.16px on
the first tap.

**Why on every element.** Given the Document's own
`body { -webkit-text-size-adjust: 100% }`, a rule on `html` alone at 150% left
the text at 16/12/10. The same value declared on `html, body, body *` gave
24/18/15. A span nested as `0.5em` inside `2em` came out at 24px, so a value
declared on every element is applied once and does not compound through
nesting. Both spellings, because that is the pair that was measured.

**The one property that matters is still guarded.** Nothing here can declare
`user-select`, which silently stops `::highlight()` from painting (ADR 0011).
`test/renderer/appearance.test.ts` builds the CSS for every font × every size ×
body text sizes from 4 to 100 and NaN, and asserts that each line is one of the
three declarations above and nothing else.

## The WebView asks for its mobile content mode, which an iPad needs

On the iPad Air 13-inch (M4) simulator the rule computes and nothing moves
(notes, 11:53). The root reported 133.333298% and then 200%, and the
body text of `Sized Fixture Small` stayed 12px, with every other size its own.
An iPad-sized WKWebView defaults to the desktop content mode. With
`contentMode: "mobile"` on the `WebView`, the same rule at Font Size 24 gave
24px body text, a 48px h1, a 20px badge and a 24px note, which are the iPhone's
numbers (notes, 12:02).

`@epubjs-react-native/core`'s `View.js` gives its `WebView` a fixed list of
props, with no `contentMode` and no spread. So the prop is added by
`patches/@epubjs-react-native+core+1.4.8.patch`, one line in each of
`lib/commonjs/View.js` and `lib/module/View.js`, applied by `patch-package` from
`postinstall`. A clean `npm ci` applies it. `test/renderer/rules.test.ts` reads
the installed `View.js` and fails without it, and patch-package fails the
install when a new version of the library no longer takes the patch.

**CSS `zoom` was tried instead and fails on both devices** (notes, 12:02):

- **iPad.** `zoom` does not enlarge the text at all. The computed size became
  12 ÷ zoom and the line drawn stayed 14px; only epub.js's side padding grew.
- **iPhone.** epub.js gives each section's `body` an inline
  `width: 393px; padding: 0px 32.75px`, so `zoom` scaled the page wider than
  the frame (`scrollWidth` 491 in 393). With `width: auto` it does reflow, but:
  - epub.js's padding grows with it, 65.5px a side at 2×;
  - images would grow too;
  - `getComputedStyle().fontSize` stops reporting the drawn size.

## The body text size

The body text size is **the size most of the Document's characters are set in,
decided once per Document, from the first pages with enough text, and kept**
(design 0030).

- **The program counts, only while it has to.** `highlighterSource` takes
  `bodyTextSize: number | null`, and bakes `MEASURE = (bodyTextSize === null)`
  and `APPEARANCE` built against it. While `MEASURE` is set, `adopt` runs
  `sizesOf` over the Blocks it has just walked. `sizesOf` groups non-space
  characters by the computed font size of each text node's element, divided by
  the text-size-adjust percentage in effect (`getComputedStyle` reports the
  adjusted size: 24px at 150% for a 16px paragraph), with a per-element cache.
  It sends the counts as `sizes` on the Blocks message. Both of its loops stop
  at the text node that reaches `COUNT_LIMIT`, 5,000 characters, so a section
  is counted to at most one node past it. The message `measured` sets
  `MEASURE = false`. The download indexer's program is built with the default
  `bodyTextSize` of 16 and never counts.
- **The bridge decides once, with `body-text.ts`.** `countPage` keeps one count
  per section. A section epub.js renders again after a resize, or on the way
  back to it, replaces its own count rather than adding to it. The decision is
  made once `CHARACTERS_TO_DECIDE` (2,000) characters have been counted across
  those pages. `decideBodyTextSize` picks the size with the most characters,
  rounding to a hundredth of a pixel, because the division above is exact only
  up to floating point (15.999996px at 133.333298% is 12.0000003px), and
  ignoring entries that are not a size or not text. The bridge then:
  - sends `measured`;
  - re-sends the appearance CSS only if the result is not 16;
  - after that section's Blocks have been handled, calls `onBodyTextSize`.

  The document message's re-send compares the body text size as well as the
  Appearance with what was baked in.
- **Why 2,000 characters.** It is more than a title page or a page of small
  print in front of the first chapter holds, and less than one chapter of
  prose. At 500, a copyright page set in 12px would have decided a whole
  Document from its small print, for good. At 2,000 it is counted and then
  outvoted by the chapter after it. The short fixture, at 883 characters in
  all, is never decided. It is shown against 16, which is its size, and counted
  again on each open.
- **The app keeps it.** `src/app/body-text-sizes.ts` keeps
  `Documents/body-text-sizes.json`, which is `{ version: 1, sizes: { <Document
  Id>: px } }`, and writes it the way `display-names.ts` writes its file.
  `use-reading.ts` reads it once, at mount, because the bridge bakes it into the
  program, and writes it from `onBodyTextSize`. It is a file of its own and not
  a Library field: `library.json` is the file ADR 0003 may sync and grows only
  by sibling files, and this is a cache of something the Document's bytes
  decide. Being a cache is also its failure policy. A damaged file, a file of
  another version or a failed write costs one count on the next open, and none
  of them throws into the reading.

**Why 16 is the assumption.** It is `PLAIN_BODY_TEXT_SIZE`, the WebView's
initial `medium`, and every Document on both simulators measured at exactly
that: the short fixture, 仙逆 and `Sized Fixture Rem`. None of them reflows when
the decision lands. `Sized Fixture Small` (`body { font-size: 12px }`) is shown
at 12px until its first chapter is counted, then at 16px. Reopened, it is 16px
on its first paint, from the stored 12.

**What it costs.** The same count, replicated in a probe, averaged **0.100 ms**
with its bound and 0.085 ms over the whole chapter across 200 runs. That was
on 仙逆's longest chapter (`Text/chapter94.xhtml`: 509 text nodes, 256
elements, 13,658 non-space characters). Single runs read 0 or 1 ms, because
`performance.now()` is coarsened to 1 ms in that WebView (notes, 11:27). The
walk it follows already asks for the computed style of every element.

## The setting and the sheet

`Appearance` is `{ font: ReadingFont | null; size: FontSize }`, and
`DEFAULT_APPEARANCE` is `{ font: null, size: 16 }`. `FONT_SIZES` runs from 12
to 24 by 1 and from 26 to 32 by 2. `stepFontSize` returns null at either end,
which the sheet shows as a disabled button. The sheet shows the size between −
and +, and the "Use document appearance" line is gone.
`test/manual-test/ios/OfflineProbe.swift` now steps back instead of tapping it.

`settings-storage.ts` accepts `appearance.size` only when it is on the ladder.
The build before this stored `appearance.scale`, a percentage or null, and that
field is simply no longer read. There is no migration, because the app has not
been released, and every install starts at 16.

## Measured end to end

On the iPhone 16. The walkthrough harness's `settings` command is the same
`setSettings` the sheet calls (notes, 11:31):

| Document | 16 | 20 |
| --- | --- | --- |
| short fixture (no stylesheet) | body 16, h1 32 | body 20, h1 40 |
| 仙逆, spine 96 | body 16, head 16, badge 10 | body 20, head 20, badge 12.5 (32 → 32/32/20) |
| Rem (`62.5%` + `1.6rem`, own `body` text-size-adjust) | body 16, h1 24, badge 10, 12px note 12 | 20, 30, 12.5, 15 |
| Small (`body` 12px) | 133.333298%: body 15.999996, h1 31.999992, badge 13.33333 | 166.666702%: body 20.000004, h1 40.000008 |

WebKit hands the percentage back as a single-precision float, which is where
15.999996 comes from. On the iPad, with the content mode patched in, Small at 24
gave the iPhone's 24/48/20/24.

## Alternatives rejected

- **Keep the root `font-size` and rewrite the Document's px and keyword
  declarations.** That means walking every stylesheet's rules and every inline
  style, and a keyword resolves against `medium`, not against the root. It was
  rejected once one property was measured to reach all of them.
- **CSS `zoom`, or the WebView's page zoom.** See the content mode section
  above.
- **text-size-adjust on the root only.** A Document's own declaration on `body`
  defeated it (measured above).
- **Deciding per section, or scanning the whole Document when it opens.** See
  design 0030. The first misjudges title pages and appendices. The second costs
  work proportional to the book (2,077 spine items for 仙逆) at the moment the
  owner is waiting for the page.

## Limits

- **Measured only in iOS WebKit.** Nothing here has been run on Android.
- **Too little text.** A Document with fewer than 2,000 characters in all is
  never decided: it is shown against 16 and counted again on each open.
- **The body text size can be misjudged:**
  - A Document whose most-used size is not its body text would be scaled from
    the wrong size, for example one that is mostly notes set small.
  - So would one whose first 2,000 counted characters come from pages set
    differently from the rest.
  - A decision is kept. The only way to have it counted again is to delete that
    Document's entry from `body-text-sizes.json`.
- **A Document can still beat the rule.** One that declares
  `-webkit-text-size-adjust … !important` with a more specific selector than
  `body *` beats this rule for what it selects.
- **The patch has to be carried.** The content mode lives in `patches/`
  until the library takes a prop for it.
- **Corrections to earlier docs.**
  - The 2026-09-20 03:16 note said 仙逆 sets no `font-size`. It sets one on six
    selectors, none of them the running text.
  - ADR 0021 said its text is in `div`s and that it sets a `font-family` on
    `p`. Its text is in bare `body > p`, and its faces are on `body` and `div`
    (notes, 11:35).
