---
status: accepted
---

# A moved highlight repaints its Block

Purely technical: there is no `docs/design/0038`. What the owner sees is the
highlight they already had, without a strip of it left behind. Nothing about how
it looks or behaves is traded for that. The number is 0038 because 0034 to 0037
were taken by work in progress alongside this: the alignment (#32, #33) and two
other worktrees.

## What WebKit does

Measured for #35 on the iPhone 16 simulator, iOS 27.0; the runs are in
`notes/NOTES_2026-09-22.md` from 12:20.

**A `::highlight()` background on a line with another line above it in the same
block is painted from the bottom of the upper line's text**, not from the top of
its own. For WebKit's serif at 28px with a normal line height, "He" has the text
box 361–393 CSS px and the line above ends at 359, and the word colour covers
359–393: 2 px above the text, 6 device pixels. At `line-height: 1.6` the gap is
12.79 px. It is the leading between the two lines' text.

**When a Highlight's ranges change, this WebKit repaints the renderer of each
node a Range covers and nothing else.** `Highlight::repaintRange` calls
`renderer()->repaint()` for every intersecting node, and `add`, `delete` and
`clear` each call it, whether or not the Highlight is registered. That was so
from at least 2023 (4ed2d20fb3) until 3de673d8e1, 319154@main, 2026-08-13
(bugs.webkit.org 321567), which also repaints each renderer's containing block
because "Highlight decorations can paint outside a renderer's ink overflow".
The iOS 27.0 simulator runtime reproduces the strip, so its WebKit does not
have that commit.

A text node's repaint rectangle is its own box, the bounding box of all its
lines. From its second line on, the gap above a line lies inside it. Above its
**first** line it does not, when that line is not the first of its block:
text after a `<br />`, or after an inline element. So on such a line:

- a newly highlighted word is repainted from its text's own top, and is drawn
  that much short of its line (measured: 96 rows tall where the line is 102);
- the gap is painted only by a repaint of the whole area while the word is
  highlighted, and the tiles the centring scroll brings on screen are painted in
  the frame where the new Utterance's first word is;
- once painted, it is never erased by the word moving on, and stays until
  something repaints that area for another reason.

That is the owner's report: an amber strip, as wide as the word, above
"completed" on the first line after a `<br /><br />`, while the voice was on the
next line. The simulator leaves it above the first word; the owner's phone left
it above the second, and why is not established. Nothing in the DOM shows any of
it: the registry holds the right Range the whole time.

## Decision

**The highlighter repaints the whole Block of every Range it takes out of a
highlight or puts into one**, which is what 319154@main does inside WebKit, done
from the page.

- `put()`, the only function that changes a highlight, reads the Block element
  of every Range the highlight holds before it clears it and of every Range it
  adds, then calls `repaintBlocks()`.
- `repaintBlocks()` makes, for each distinct element whose document is alive, a
  Range with `selectNode(element)`, adds it to a third Highlight and deletes it
  again. The add and the delete are what make WebKit repaint every node the Range
  covers. `selectNode`, not `selectNodeContents`: only a Range that covers the
  element itself reaches the element's renderer, whose repaint rectangle is the
  whole block. One over its contents repaints its text nodes, which is the bug.
- The third Highlight is made in `registryFor()` and **never registered**, so no
  rule can paint it. A registered one holding a whole Block, even for a moment,
  would be a Block painted by whatever rule named it.
- `domRange()` records the element of the Block each Range was built from in a
  `WeakMap` keyed by the Range, so it lives as long as the Range does.
  `repaintBlocks()` asks that element's document for its `defaultView` before
  touching it; a replaced document paints nothing and needs no repaint.

Nothing in the DOM and no style changes, so ADR 0005's rule that the highlighter
mutates nothing but its own stylesheet stands, and nothing new crosses the bridge.
`test/renderer/rules.test.ts` pins each of these lines, and that `put()` is the
only place a highlight changes, so that no later change can skip the repaint.

## Consequences

- A Block is repainted each time the word moves: 3 to 5 times a second while
  reading, over the part of the Block WebKit keeps painted, about a screen. The
  cost is not measured; a simulator's figure would be the Mac's.
- On a WebKit that has 319154@main, WebKit repaints the containing block as
  well. The workaround stays, because the app supports iOS 17.2 onwards.
- The Utterance highlight goes through the same `put()` and gets the same
  repaint when the reading moves from one sentence to the next.
- `test/manual-test/scrolling-and-theme/leading-strip.sh` is the regression check, at the only seam
  that sees painting: a screenshot. Its `app` mode drives this highlighter; its
  `page` mode is WebKit alone and says when a runtime has WebKit's own fix
  (no strip without `fix=1`).

## Alternatives turned down

- **Toggle an imperceptible style on the Block** to make WebKit repaint it. That
  is a style change per word, which ADR 0005 rules out, and it restyles the Block.
- **A transparent `text-shadow` tall enough to put the gap inside every text
  box's overflow.** It depends on WebKit counting a transparent shadow, overrides
  a book's own shadows and adds a shadow pass to every glyph.
- **Clear the word before the centring scroll and hold the first word back until
  the new tiles have painted.** That narrows the window, but any other whole
  repaint (a finger scroll, a resize, a section arriving) leaves the same strip.
- **Draw the word as an underline or a text colour instead of a background.**
  No strip, but not the look the owner chose.
- **Wait for WebKit.** The fix is not in iOS 27.0, and the app supports 17.2.
