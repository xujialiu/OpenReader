---
status: accepted
---

# Text Alignment is one rule that passes over what the Document placed itself

_The product argument — what the owner sees and what it costs — is
[design 0034](../design/0034-lines-that-meet-both-margins.md). Issue #32._

This adds a third part to the stylesheet ADR 0021 installs. The message, the one
`<style>` element and the re-centre stand; ADR 0030's size rule and ADR 0029's
font list are unchanged. **It revises one sentence of ADR 0021 and of
`highlighter.ts`'s header: the program no longer makes one DOM mutation but two
kinds of mutation** — the `<style>` element, and one attribute on each element a
Document itself centres or sets to the right.

## The setting

`Appearance.textAlignment` is `'left' | 'justify'` (`TEXT_ALIGNMENTS`, in the
menu's order), and `DEFAULT_APPEARANCE` has `'justify'`. It is per app, like the
rest of Appearance (ADR 0021), stored in `settings.json`, and not synced.
`settings-storage.ts` reads a missing or unknown value as `'justify'`; a file
written before this change has no field and reads the way a new install starts.
Nothing is migrated, because the app has not been released.

## The rule

`appearanceCss` appends one line after the size and the font:

```css
body *:not(h1, h2, h3, h4, h5, h6, h1 *, h2 *, h3 *, h4 *, h5 *, h6 *, [data-openreader-own-alignment]) { text-align: justify !important; }
```

or `start` for Left. The value is one of two words written in `highlighter.ts`;
anything that is not `'left'` produces `justify`, so nothing from a settings file
is ever interpolated. `test/renderer/appearance.test.ts` runs every combination
the Appearance sheet can produce and asserts that each line is a size, a font or
exactly one of these two rules, and that none declares `user-select`.

`start` rather than `left`: the same side in every Document this app has read,
and in a right-to-left Document it is still the side a line begins on, so the
ragged edge stays where the lines end. No right-to-left Document was measured.

`!important` for ADR 0021's reason: the Document's own stylesheet is loaded into
the same document and is as entitled to `text-align`. Measured below, a
paragraph the Document declared `text-align: left` is justified, and one it
declared `justify` is set to `start`.

### Why not every element

A justified block's last line is set to the start, and a one-line block is all
last line. So `text-align: justify` on a centred one-line title does not leave
it centred and does not stretch it: it moves it to the left margin. Excluding
headings alone is not enough either. Documents centre ordinary paragraphs, such
as the `* * *` between two scenes, a verse or an epigraph, and the
paragraphs-and-list-items convention would move each of those to the margin.
What the owner chose, in the terms of design 0034, is that body text follows
the setting and whatever the Document placed itself does not.

### Why not the two roots

Unlike ADR 0021's font rule, this one is not on `html` and `body`. `text-align`
inherits, and the first version, which also covered `html:not([…])` and
`body:not([…])`, made an `h1` that declares nothing compute `justify`. The
heading was excluded from the rule, but it inherited the owner's value from
`body` (notes, 12:45). With the roots left alone, what inherits from them gets
the Document's own answer, and every element that holds body text is reached
directly anyway. The price: text that sits straight in `body`, outside any
element, keeps the Document's alignment. No Document measured has any.

## The mark

What the Document placed itself cannot be told apart in CSS: a selector cannot
match on another rule's computed value. So the page program looks before the
owner's rule exists. `markOwnAlignment(doc)` reads `getComputedStyle(element).textAlign`
for every element in `body`, and puts `data-openreader-own-alignment` on each one
that computes `center`, `right`, `end`, `-webkit-center` or `-webkit-right`
(`OWN_ALIGNMENTS`). WebKit computes the last two for the legacy `<center>` element
and `align` attribute.

**Read before the owner's rule is in the document, and only then.** Afterwards a
computed value is the owner's answer. `ensureStyle` calls it on the one branch
that creates the stylesheet, so it runs once per document, whichever of
`adopt`, `restyle` and `registryFor` reaches the document first.
`rules.test.ts` pins that order.

**All reads, then all writes.** An attribute is a change the style engine has to
answer before the next computed value, so interleaving the two would restyle the
section once per element marked. `rules.test.ts` pins that too.

**Every element, not only Blocks.** Inheritance carries a centred line down: in
the fixture, the two `<p>` inside a centred `<div>` declare nothing, compute
`center`, and are marked. Unmarked, the owner's rule would reach them directly
and leave their `<div>`'s alignment behind.

An attribute moves no text node, offset, Block or CFI. epub.js asserts an
element's `id` in a CFI, never a `data-` attribute, and the walk reads only
`display` and text. `rules.test.ts` allows exactly one `setAttribute(` in the
program, with this name, and no `removeAttribute`, `classList`, `dataset` or
inline `style`.

## Measured

iPhone 17 simulator, iOS 27.0, Debug build on this tree, 2026-09-22.

**`Alignment Fixture`** (`test/manual-test/alignment-fixture.ts`), each element's
computed `text-align`, `*` where marked (notes, 12:46):

| element | the Document set | Justify | Left |
| --- | --- | --- | --- |
| `h1` | nothing | `start` | `start` |
| `h2.centred` | `center` | `center*` | `center*` |
| block `span` in a centred `h3` | inherits `center` | `center*` | `center*` |
| `h4.left`, two lines | `left` | `left` | `left` |
| `p` | nothing | `justify` | `start` |
| `p.left` | `left` | `justify` | `start` |
| `p.justified` | `justify` | `justify` | `start` |
| `p.break`, `* * *` | `center` | `center*` | `center*` |
| `div.verse` and its two `p` | `center`, inherited | `center*` ×3 | `center*` ×3 |
| `p.signature` | `right` | `right*` | `right*` |
| `p.end` | `end` | `end*` | `end*` |
| `p style="text-align: center"` | `center` | `center*` | `center*` |
| `<center>` | legacy | `-webkit-center*` | `-webkit-center*` |
| `li` | nothing | `justify` | `start` |
| `td` of words, `td.num` | nothing, `right` | `justify`, `right*` | `start`, `right*` |

**Switching moves no line.** The fixture's section was 1,223 px tall under both
choices, and 仙逆's first chapter 8,610 px. Justification spreads a line's space
and does not change where it breaks, so the `appearance` message's re-centre
(ADR 0021) finds nothing to move and leaves after its three still frames. The
utterance highlight set by a tap stayed on the same words, at the same height,
across Justify → Left → Justify (screenshots, notes 12:52).

**仙逆** (notes, 12:48): marked on the title page are `h2.booktitle`,
`p.bookauthor`, a `span`, `div.chubanshe`, an `a` and `img.chubanshe`. In the
first chapter, section 4 of 2,077, 106 elements, the marked ones are `div.logo`,
`img.logo`, `h2.head`, `span.num` and a `br`: the chapter heading and its badge,
none of the body text. `body > p` computes `justify` or `start` as chosen.

**Cost.** Reading `textAlign` for all 106 elements of that chapter took
0.05 ms a pass, as the mean of 20 passes over styles already resolved.
`performance.now()` is coarsened to 1 ms, hence the repetition. The first read
of a section also resolves its styles, which the section's first layout does
anyway.

## What it cannot do

- A Document that centres all of its text looks the same under both choices.
- A heading the Document set to the left, or left undeclared, keeps that. A
  heading of several lines is not justified under Justify.
- `text-align-last` and `hyphens` are not touched. Automatic hyphenation under
  Justify was declined (design 0034).
- In a right-to-left Document `right` is the start side, so a paragraph that
  declares `right` would be marked as placed. Not measured; there is no
  right-to-left Document here.
