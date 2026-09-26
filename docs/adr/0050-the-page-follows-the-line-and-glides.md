---
status: accepted
---

# The page follows the line being spoken, and glides to it

_The product argument is [design 0050](../design/0050-the-page-follows-the-line-being-spoken.md).
Issue #71. It replaces ADR 0011's "centred on the Utterance being spoken"; the
rest of ADR 0011 stands._

## What was done (batch 1: by line, at the middle)

All of it is in the WebView program, `src/renderer/highlighter.ts`, and
`src/renderer/glide.ts`. Nothing new crosses the bridge.

- **The unit is the line the spoken word begins on.** `lineOf(built)` returns the
  first client rect of a built Range list that has both a height and a width, as
  `{ doc, frame, range, top, height }`. `top` is in the section document's own
  coordinates, which scrolling does not change. `sameLine(a, b)` is the same
  document and tops closer than half the smaller height. Width is required
  because WebKit can give a Range that starts where a line wraps a zero-width
  rect at the end of the line before. Without the check, 3 of 37 sentences
  skipped to while paused came to rest with their middle 9, 29 and 45 px *above*
  the target, which a sentence held by its first line cannot do. With it, none
  of 35 did, though those were different sentences (01:37 and 01:42).
- **A word moves the page only when it changes line.** `showWord(ranges, quiet)`
  calls `followWord(built)` after painting, and `followWord` returns unless
  `!sameLine(followed, line)`. `followed` is the line last brought to the line
  position. The loop in `tick` still never scrolls itself, so a scroll happens at
  most once a line.
- **What is aimed at, `aim()`.** With Word Timings, the line of the word being
  spoken (`spokenRanges()`, walking back over empty ranges as `showAt` does).
  Before the Clip's first word, the Utterance's first line. So a sentence that
  begins on the line being read moves nothing, and one that begins a paragraph
  starts moving at its Clip cue, 84–118 ms before its first word is drawn. A Clip
  without Word Timings (`words: null`, `durationMs > 0`) is aimed at whole: the
  middle of `boxOf(built)`, with ADR 0011's tall-Utterance rule. A sentence the
  bridge shows with no Clip (`words: null`, `durationMs: 0`, a tap or skip while
  paused) is aimed at its first line, where Play's first word will be.
- **Where it is held, `moveFor(aimed)`.** `bounds.top + visibleOf(view) *
  LINE_POSITION`, where `visibleOf` is `clientHeight - covered` (ADR 0020's
  inset), clamped at 0, and `LINE_POSITION` is `0.5`. The inset message still moves
  nothing. The measurement is repeated whenever it is needed and never
  remembered.
- **How it moves, `bring(aimed, instant)`.** Under 1 px, nothing. At once
  (`nudge(move)`) when `instant`, or when `!glides(move, visible)`, which means
  `|move| > visible`. Otherwise a glide: `{ aimed, from: move, elapsed: 0, last:
  null }` and a `requestAnimationFrame` loop, `glideStep`. A glide already heading
  for the same line is left alone. Any other is replaced from where the page is.
  `nudge` is the only call to `rendition.manager.scrollBy(0, by, false)`, with the
  `ignore` flag off as before, so the continuous manager still appends ahead.
- **The curve, `glideLeft(from, elapsed)`.** `from * (1 - t)²`, `t = elapsed /
  GLIDE_MS`, with `GLIDE_MS = 250`. That is 12.9 % of the move in the first 60 Hz
  frame, 25 % in two, 75 % at half time, and the last frame of a 55 px move under
  a pixel. Speechify, measured (notes/NOTES_2026-09-25.md, 23:00), took 220–290 ms
  whatever the distance, with about three quarters by half time. Its first
  captured frames were 18–35 % in. The capture's variable frame rate can hide the
  frame before, so the quadratic was preferred to a steeper curve.
- **Each frame re-measures.** `glideStep` calls `moveFor(glide.aimed)` and moves
  by `move - glideLeft(from, elapsed)`, skipping steps under 0.5 px, so a
  section trimmed or prepended above mid-glide costs nothing. It stops, where the
  page is, when `!state.follow || browsing`, when the line's document is gone, and
  when `halt()` is called.
- **Timed in drawn frames, not by the clock.** `elapsed` grows by one frame
  (`FRAME_MS = 1000 / 60`) on the first frame, and after that by
  `min(now - last, 2 * FRAME_MS)`. Timed from the request, a glide asked for at
  Play drew its first frame 435 ms later and jumped in two frames. One asked for
  at a tap while paused drew its first frame about 800 ms late and moved 39 px and
  then 213 px. Timed from its own first frame only, a glide that lost ~200 ms to
  dropped frames mid-way went `[4,25,3,3,1]`. In drawn frames, a 143 ms stall gave
  `[-2,-2,-2,-1,-1,-1,-1]` over 319 ms, and the 189 ms frame in which epub.js
  appended a section gave `[5,11,3,8,5,6,3,1,2,1]` over 462 ms.
- **A finger stops a glide on its first `touchmove`.** `dragged` calls `halt()`
  before it looks at the distance, and browsing still begins past `DRAG_PX`
  (10 px). There is no `touchstart` listener. The structural test in
  `rules.test.ts` ("listens for a click and for nothing that would take the
  platform's long press") forbids one, under ADR 0020's rule, which ADR 0044
  applied to browsing. A passive `touchstart` could not have taken the long press,
  but it would have been the first exception to that rule. It would have bought
  only the case of a finger held perfectly still over the ≤ 250 ms remainder of
  one glide.
- **At once where a glide would chase moving text.** `attach()` paints a section
  that has arrived with `showAt(state.next - 1, true)`, so the word does not start
  a glide of its own inside epub.js's display (#50). It then places the page at
  once: `placeOnce` (formerly `centreOnce`, the `centred` WeakSet kept), or
  `settle(SETTLE_FRAMES, 0)` a frame later for a section `follow()` displayed.
  `settle` places at once every frame until three frames need no move (it used to
  compare `box.top` between frames). The Appearance reflow still settles at once.
- **`clear` and `browse` call `halt()`,** and `clear` forgets `followed`.

## Measured (notes/NOTES_2026-09-26.md)

iPhone 17 simulator, iOS 27.0, `Cultivation Online 2001-2044.epub`, Fish Audio at
1.00×, Font Size 16, a line 20 px and a paragraph break 36 px:

- Within a paragraph the page begins one frame (17 ms) after the word reaches its
  new line. A line took 233–241 ms and a paragraph break 246–252 ms. Every rest
  was 0.1 px from the target, in 7 of 7 moves (01:33) and 8 of 8 across a section
  boundary (01:35, the heading's lines 30–46 px, rests 0.1–0.5 px).
- `scrollTop` moves in whole CSS pixels, so a 20 px line goes in 1–3 px steps.
- A trim during reading: 324 ms after a glide's last frame, epub.js erased a
  3,782 px section above and scrolled back by it in one frame. The text did not
  move: the shown sentence was 10.8 px below the target before and after (01:42).
  The glides' scroll events keep `holdStill`'s `moving()` true for 200 ms after
  each frame, and the rests between lines (≥ 1 s) are where parked trims run.
- A tap while paused, 188 px away: 316 ms (01:32). A Clip without Word Timings,
  replayed on a three-line sentence: 20 px in 199 ms, its middle 0.8 px from the
  target (01:44).

`test/manual-test/line-follow.cjs` is the probe. The rules it pins are in
`test/renderer/rules.test.ts` ("the page follows the line being spoken"), and the
curve is in `test/renderer/glide.test.ts`, which evaluates `GLIDE_SOURCE`, the
text the program runs.

## Decided, not yet built

- **Line Position** (CONTEXT.md) becomes a setting, 20–80 % in steps of 10,
  default 50 %, measured against the visible page with the player **expanded**, so
  `LINE_POSITION` is replaced by the owner's value and the collapsed player's inset
  no longer moves the target (batch 2).
- **A/M** in the player's empty 44 pt slot, automatic recovery when a sentence
  begins while playing with its line still on the screen, **M** returning the page
  without playing (#53), and no dragging while the player is collapsed and the
  reading plays (batch 3).
- **Continuous**: the target advanced by the spoken word's horizontal position in
  its line times the line's height, smoothed, and stopped while nothing is spoken.
  Every frame would then scroll, so `holdStill`'s `moving()` would never see
  200 ms of rest while reading, and trims would wait for a pause. It has to tell the
  program's own scroll from a finger's fling before that mode ships. The
  measurement on 2026-09-24 (a `scrollTop +=` on 40 successive frames with an erase
  above, the text did not move) says a program scroll can let a trim through (batch 4).
