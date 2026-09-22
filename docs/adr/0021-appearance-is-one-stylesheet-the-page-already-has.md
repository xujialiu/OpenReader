---
status: proposed
---

# Appearance is one stylesheet the page already has, and a message that replaces it

_The product argument — what the owner sees and what it costs — is
`docs/design/0021-changing-how-the-page-looks.md`._

**ADR 0029 revises the font list below.** It is six named faces now rather than
three kinds, and `serif` and `sans` are retired ids that `settings-storage.ts`
migrates. The prohibition on naming a CJK face is lifted, though no entry uses
that yet. Everything else here stands.

**ADR 0030 revises the size.** It is no longer a percentage of what the
Document set and no longer starts on the Document's own: it is how big every
Document's body text is shown, from 16px, applied as one `text-size-adjust` on
every element against each Document's measured body text size. The two size
rules below are what this ADR shipped; the message, the one `<style>` element,
the re-centre and the font rule all stand.

**ADR 0034 adds a third row, the Text Alignment**, as a third part of the same
stylesheet. Its rule is `text-align` and not `font-size` or `font-family`, and to
leave what a Document centred where it was, the program also puts one attribute
on each such element before the stylesheet is created. So "exactly one"
DOM mutation below is now two kinds: the `<style>` element, still created
once, and that attribute.

ADR 0019 decided that Appearance is a **sheet over the reader** and not a route,
and left what it holds to this one. It holds two rows, a font and a size, and
both default to **follow the document** — `Appearance` in `src/renderer/highlighter.ts`,
which is where the type lives because it is the renderer that paints it.

## It is a message, not a rebuilt program

`injectedJavascript` is evaluated by `react-native-webview` **at page load**, and
the highlighter's first line is `if (window.__openReaderHighlighter) return true;`
— so rebuilding the source string for a new font changes the string and not the
program. That is measured (`notes/NOTES_2026-09-20.md`, 01:01) and it cost a wrong
conclusion once already.

So the bridge sends `{ kind: 'appearance', css }` through the same one funnel
every other message goes through, and the program puts the string in a `<style>`
element. A remount would be the other way to do it and is the wrong way twice
over: it would reparse the EPUB and lose the highlight to change a font size, and
the sheet exists precisely so that the text stays visible while the change is
judged.

`highlighterSource` takes the current Appearance as well, so a book **opened**
with an override already chosen is laid out that way on its first paint rather
than reflowing when the first message lands. The bridge keeps both — what was
baked in and what has been chosen since — and re-sends on the document message
only when they differ, which is the same trap the inset already had
(a message sent before the program exists is a no-op that nothing reports) without
the cost of an injection and a reflow per document for nothing.

## The message carries finished CSS, not a font and a size

`appearanceCss` builds it on the React Native side, and the WebView half never
reads it. That is what makes the one dangerous property checkable: **nothing an
owner can choose can become a declaration of its own.** The font is looked up in
a fixed list of stacks and never interpolated; the size is a number clamped to
50–400%. `test/renderer/appearance.test.ts` runs every combination the sheet can
produce and asserts that each line matches `font-size` or `font-family` and
nothing else.

The property that has to hold is **`user-select: none` silently stops
`::highlight()` from painting** (ADR 0011, and the 2026-09-19 bisection). A
stylesheet built out of the owner's choices is a new way to reintroduce it, in a
part of the app whose failure mode is a page that looks perfectly healthy and
paints no highlight. Re-proved on the device rather than argued: with
`appearanceCss` mutated to emit `user-select: none`, the size changed, the
registry still held one `Range`, and nothing was drawn; with the mutation removed
and nothing else changed, the same page painted (notes, 03:20 and 03:21).

## One `<style>` element, not two

`ensureStyle` already installed the `::highlight()` rules once per document,
because a custom-highlight rule has to live in the document it styles. Appearance
goes into that same element: its text is now `CSS_TEXT + APPEARANCE` and the
function both creates and updates, so the program still makes exactly **one**
`createElement` and one `appendChild`. `rules.test.ts` asserts the count, which is
what stopped this becoming two elements out of tidiness.

A section that renders after a change picks the current text up from `adopt` like
any other; a change while sections are on the page walks the live ones. Neither
touches a text node, so no Block's text, no offset, no span and no CFI moves — an
Appearance change renumbers nothing, which is why it needs none of the machinery
`samePrefix` exists for.

## The rules, and what they cannot reach

```css
html { font-size: N% !important; }
body { font-size: 100% !important; }
html, body, body * { font-family: <stack> !important; }
```

Three decisions in three lines:

- **The root carries the size and the body is pinned to it.** A percentage
  `font-size` resolves against the **parent's** computed size, so declaring the
  same percentage on both would multiply it — 150% and 150% is 225%. The body rule
  is there to overrule a book that sets a size on `body`, not to scale again.
- **The font is set on the descendants too.** `font-family` inherits, so a rule on
  the two roots alone is beaten by any book with `p { font-family: … }` in its own
  stylesheet — and the owner's novel names a face on `body` and on `div`. (Its
  text is in bare `body > p` and inherits `body`'s face; the `div`s hold only a
  logo image — notes 2026-09-21, 11:35.)
- **`!important` on all three**, because an EPUB's own stylesheet is loaded into
  the same document and is as entitled to these properties as we are. The owner's
  override is the later word and has to win.

**What it cannot do, and this is the honest limit:** a book that sets an absolute
size on its paragraphs rather than on its body keeps that size, because an
inherited root size is not what those paragraphs are reading. Neither book this
was measured against does — the fixture ships no stylesheet at all, and 仙逆's sets
`font-family` on `body` and `div`, and a `font-size` on six selectors none of which
is its running text, so both scale (notes, 03:16; corrected 2026-09-21, 11:35). One
of those six is the chapter-number badge, `span.num { font-size: x-small }`: a
keyword size ignores the root, so it never scaled — which ADR 0030 fixes.

No CJK face is named in any stack, deliberately. WebKit falls through a font stack
per script, so a Chinese book under "Serif" is laid out in the system's own serif
CJK face rather than in Georgia, which has no glyphs for it. Measured: 仙逆 under
"Serif" reports `Georgia, Times New Roman, serif` as its computed family and is
legible Chinese on the screen.

## A change that reflows the text moves the reading, so the page is brought back

ADR 0011 centres the Utterance being spoken, once per Utterance, on the Clip cue.
A font change does not produce a Clip cue and moves every line in the book, so
without something the sentence being read simply leaves the screen.

**The counterfactual, measured on 仙逆** (notes, 03:18): with the re-centre removed
and nothing else changed, going to 175% left the sentence being read **1,815.9 px**
below the middle of the visible text — two and a half screens. With it, 0.896 px.

The opposite of what the `inset` message does, and the difference is the whole of
it: the player collapsing moves not one character (the 01:11 measurement), and a
font change moves every one of them.

**Waiting for the reflow is the hard half, and the first attempt was wrong.**
epub.js resizes each section's iframe from the section's own `ResizeObserver`,
whose callback is `requestAnimationFrame(this.resizeCheck.bind(this))` — read out
of the bundled library — and the continuous manager re-lays the views out after
that. So the geometry a re-centre needs is a frame or more away.

The first version waited for two frames with the same geometry and then centred
once. It held the sentence to 0.758 px when the text **grew** and left it
**4,285 px** out when the text **shrank**, because a page can look settled for a
frame while the library is still relaying its views. What ships centres on **every
frame** of a bounded window and leaves early once nothing has moved for three
frames: `centre` scrolls only when the move is at least a pixel, so a settled page
costs one measurement a frame and no scroll at all. The cap is a cap and not a
duration — it is what a document whose layout never settles costs, not what an
ordinary one does.

## Per app, not per document, and not stored

`AppSettings.appearance`, beside the rate. A Voice belongs to a Document
(ADR 0010) because it is a property of that book being read; how big the text is
is a property of the owner's eyes. It is **not** in `engineIdentity`, and that is
a stronger absence than the rate's: the rate at least reaches the audio graph,
while Appearance changes no character of what is spoken, so an engine rebuilt for
it would re-spend the quota to change a font.

It is stored on the device, in `Documents/settings.json` through
`settings-storage.ts`, and not synced: its eventual home is ADR 0003's Sync Folder,
which is not written. (This paragraph said nothing was stored, which stopped being
true when `settings-storage.ts` arrived; the heading keeps its original wording.)
