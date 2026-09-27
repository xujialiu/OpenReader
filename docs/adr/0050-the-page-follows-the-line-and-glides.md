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
  (Batch 4 changed this: the program's own scroll no longer closes the gate.
  See below.)
- A tap while paused, 188 px away: 316 ms (01:32). A Clip without Word Timings,
  replayed on a three-line sentence: 20 px in 199 ms, its middle 0.8 px from the
  target (01:44).

`test/manual-test/line-follow.cjs` is the probe. The rules it pins are in
`test/renderer/rules.test.ts` ("the page follows the line being spoken"), and the
curve is in `test/renderer/glide.test.ts`, which evaluates `GLIDE_SOURCE`, the
text the program runs.

## What was done (batch 2: the Line Position)

- **The setting.** `AppSettings.following.linePosition`, in percent, one of
  `LINE_POSITIONS` (20, 30 … 80), default 50. `settings-storage.ts` reads anything
  else, including a share such as `0.3`, as 50: the app is unreleased, so nothing
  is migrated. General shows it as `Line position` with the system menu, in a card
  of its own directly under the two pauses and inside "Reading aloud".
- **How it reaches the page.** `bridge.setLinePosition(percent)` sends a
  `FollowingMessage`, `{ kind: 'following', linePosition: share }`. It is a
  message of its own, not a field of `InsetMessage`: that one is the player's
  geometry, sent as the player lays out, while this is a setting, sent when the
  owner changes it. The program is built with `BAKED_LINE_POSITION` (0.5,
  `glide.ts`), and the document message re-sends the owner's value only when it
  differs. A page following the reading when the message arrives is brought to
  the new position through `bring(aim(), false)`: a glide within the visible page,
  a jump beyond it. A browsed page stays put. General is reached only from the
  Library, and since #68 (ADR 0049) a Reading that is playing is held there,
  mounted, behind the navigator. `ReadingHost` reads the settings from the shell,
  so `use-reading.ts`'s effects send the new value to the held page at once, and
  the Reader shows it on return. A Reading that ended when the owner left while
  paused takes it at the next open.
- **The reference height** is the batch's real change. `lineAt(view, bounds)`
  aims at `bounds.top + (clientHeight − openPlayer) × LINE_POSITION`, and falls
  back to `covered` until `openPlayer` is known. `openPlayer` is the new
  `InsetMessage.openPx`: the open player's height **without notes**. `player.tsx`
  wraps the head and transport rows in one `View` (it carries the rows' `gap: 6`,
  so the layout is unchanged), and reports that box's height plus the player's
  padding (4 + 28) and its two hairline borders through `onOpenHeight`. The box
  holds no note, so a note coming or going sends nothing, and while the player is
  collapsed the box is not drawn, so the last height stands. `visibleOf()` and
  `covered` are unchanged: they still decide what counts as within the visible
  page for a glide, and the tall-Utterance rule still uses the container's top.
  - A note on the player moved the target in batch 1. While paused, the probe's
    own note made `covered` 174.7, and the page was placed against it. When the
    note went away at Play, the line sat 87 px above the new middle.
  - Collapsing now moves nothing, and the line then sits where it sat. That is
    the owner's choice: the height is reckoned as it was before collapsing.
- **With #67's floating bar** (ADR 0048, `BarMessage`: `coveredPx`, what the bar
  covers now, 0 while hidden; `reservedPx`, its height whether shown or not), the
  rule carries over to the top. Done at the merge of main into this branch:
  - `lineAt` measures from the room kept for the bar, not from what it covers now:
    `over = barReserved > 0 ? barReserved : barCovered`, and
    `lineAt = bounds.top + over + (clientHeight − over − under) × LINE_POSITION`,
    where `under` is `openPlayer` (or `covered` until it is measured). Collapsing
    hides the bar and the player together (#67), and neither moves the target.
  - What can be seen now starts below the bar as it is: `visibleOf()` is
    `clientHeight − covered − barCovered` (the within-a-page glide check),
    `onVisiblePage()` (the recovery rule) counts from `top + barCovered`, and the
    tall-Utterance rule puts its start at `box.top − bounds.top − barCovered`.
  - The collapsed drag lock keys off #67's `chrome`: `reading-view.tsx` sends
    `setFollowOnly(!chrome)`, which is true exactly while the Reading Button is
    shown. The Reading Button's press only opens the player, which sends
    `followOnly: false` and gives the finger back the page.
- **The one limit.** At 70 or 80 %, several notes stacked on the player can cover
  the line being spoken, because the target no longer rises with them. Nothing
  clamps it. A note is transient, and the two positions that can meet it are the
  owner's to choose.

### Measured (notes/NOTES_2026-09-26.md, 11:03–11:12)

Same simulator and book, section 8. The container was 758 px, and the open player
measured 134.666… px, the same as `covered` with no note (134.667), so the chrome
arithmetic matches the player's own layout.

- **At 50, 30 and 70 %** the targets were 311.7, 187 and 436.3 px, which is
  `(758 − 134.67) × share`. At 30 %, 5 line changes each began one frame after the
  word, took 216–217 ms, and rested 0.4 px from the target. At 70 %, 5 changes
  took 234–244 ms and rested 0.1 px.
- **A note while paused.** `covered` was 174.67 against an open player of 134.67.
  Three skips each put the sentence's first line 0.8 px from 311.67. Measured
  against `covered`, they would have aimed at 291.67.
- **A note while playing.** `covered` went from 134.67 to 157.67 at 6,020 ms, and
  the three line changes after it rested 0.8 px from the unchanged target.
- **Collapse while playing.** `covered` fell to 52 at 7,595 ms and returned to
  134.67 at 11,197 ms, with no scroll at either moment. The line change made while
  collapsed, and the two after expanding, rested 0.8 px from the same target.
  - One glide in that run, crossing into section 9 while epub.js appended a view,
    drew a 275 ms frame and took 665 ms. That is the frame-timed curve pausing,
    as in batch 1.
- **A live change from 50 to 30 % while paused.** The message arrived at 1,406 ms.
  One frame later the page glided 125 px, the expected 0.2 × 623.3, in 232 ms and
  rested 0.4 px from 187.
- **General.** `LinePositionProbe` (real touches, 0 failures, 29.2 s) found the row
  below the pauses and above the brackets' card, and the menu listed 20%–80% in
  order with the current value checked. Choosing 30% showed `Line position, 30%`,
  and choosing back restored the row.

## What was done (batch 3: A/M, the way back, and the collapsed lock)

**The fact that forced the change.** Before this batch every Clip cue while
playing went to the renderer revealed: `use-reading.ts`'s clock passed
`{ reveal: playIntent.current }`, and the `'speak'` branch cleared `browsing` on
any revealed message. So a drag while the reading played lasted until the next
sentence's cue, and then `follow()` took the page back from wherever it was — a
glide within the visible page, otherwise a jump or a `display()` of the reading's
section. The owner's rule is Zotero-TTS's instead (its `manual-follow.ts`, #100
there, `keepFollowingWhileVisible` defaulting to true): M stays M across
sentences and comes back by itself only at a sentence that can be seen.

**Three kinds of cue, where there were two.**
- `use-reading.ts` keeps `revealCue`, set with `playIntent` by `play()` and
  cleared by `pause()`. The first cue after Play is sent `{ reveal: true }`: the
  owner asking for the reading, which ends Browsing as before. Every later cue
  while playing — the next Clip, a rate change's re-cue (`engine.setRate` cues
  `last.clip` again), a Voice switch's — is `{ reveal: false, recover: true }`.
  A cue while paused stays `{ reveal: false }`. `engine.play()` cues the queue's
  front synchronously (`engine.ts`), so the flag set before it is consumed by
  that cue; with nothing queued, by the first Clip to arrive.
- `SpeakMessage.recover` (optional, absent means false) carries it. In the
  `'speak'` branch the Utterance is painted first, then
  `if (!message.reveal && message.recover && browsing && onVisiblePage(shown)) setBrowsing(false);`,
  then `follow(shown)` only for `reveal || (recover && !browsing)` — so a
  recovering cue to a section that is not on the page displays nothing while the
  owner browses. `following` is `reveal || recover || state.follow`; `browsing`
  gates everything that moves the page, as before.
- `onVisiblePage(built)` measures the Utterance's first line (`lineOf`, the
  first rect with a width and a height) and asks whether its middle lies between
  the container's top and `top + visibleOf(view)`: what can be seen **now**, with
  the current `covered`, not `lineAt()`'s open-player reference, because it is
  about what the owner sees. It answers false while `moving()` — a fling still
  coasting after the finger lifts, which a glide would fight; the next sentence
  asks again.

**A or M reaches the player once per change.** A new WebView→RN message,
`FOLLOWING_STATE_MESSAGE` (`'openreader:following'`, `{ following }`), posted by
`setBrowsing()`, the only writer of `browsing`, and only when the value it
announces differs from `announced`. The bridge calls `onFollowing(true)` when the
program installs (the document message), which is where a new program starts;
`use-reading.ts` keeps it as `ReadingStatus.following`. Nothing on the frame or
word path posts (`tick`, `showWord`, `followWord`, `glideStep`; a structural rule).

**M: `ReturnMessage` (`{ kind: 'return' }`).** `bridge.returnToReading(atRef)`
sends it when `cued.current` is already that Utterance, and otherwise a revealed
`show(utterance)`. The renderer halts any glide, clears Browsing, sets
`state.follow` and calls `follow(build(state.utteranceRanges))`: `bring(aim())` —
the spoken word's line while playing, the first line while paused — or a
`display()` of the Block's CFI when the section is not on the page. It never
replaces `state`, so a playing Clip keeps its Word Timings, and nothing on the RN
side touches the engine. `show()` is the fallback and not the rule because it
sends `words: null`: while playing it would drop the word highlight for the rest
of the sentence.

**The collapsed player: `FollowOnlyMessage` (`{ kind: 'followOnly', on }`).**
Since the merge with #67, `reading-view.tsx` sends `!chrome`, true exactly while
the Reading Button stands in for the player (below), and the bridge re-sends `on`
when the program installs. It does not look at whether the reading is playing:
the owner confirmed on 2026-09-26 that a player put away while paused also brings
a browsing page back and locks it, one rule for the put-away player. On:
- `dragged()` returns before anything else, so a finger neither halts a glide nor
  starts Browsing.
- A page that was browsing is sent back first (`dispatch({ kind: 'return' })`):
  the one-button player shows no M.
- `lockPage(true)` calls epub.js's own `rendition.manager.stage.overflow('hidden')`,
  having kept `stage.settings.overflow`; off, `stage.overflow(<kept>)`.

Why the Stage's switch, read out of the bundled epub.js: `Stage.create` sets the
container's inline `overflow-y: scroll` / `overflow-x: hidden` for a vertical
scrolled Stage, and `Stage.overflow(t)` rewrites the same inline style and stores
`t` in `settings.overflow`. Its only other caller is `DefaultViewManager.updateFlow`
(the continuous manager's override passes `"scroll"`), reached from
`rendition.flow()`, which epub.js runs once in `Rendition.start()` — before this
program installs — and which the library otherwise runs only from its
`changeFlow`, which this app never calls. A container whose overflow is `hidden` cannot be
scrolled by touch and can be by script — `scrollBy`/`scrollTop` still move it and
fire `scroll`, which is what the continuous manager appends and trims on, so
glides, displays and `renderAhead` go on. Rejected: a non-passive `touchmove` with
`preventDefault` (every scroll of the phone would wait on this program, and every
listener here is passive), and a class or a `<style>` of the program's own (the
DOM rule of ADR 0005 and ADR 0034 allows the highlight stylesheet and the
alignment mark only; `rules.test.ts` holds it).

**Measured (notes/NOTES_2026-09-26.md, 12:49–15:25).** `FollowingProbe.swift`,
real touches, "Cultivation Online" mid-way. The mark reads clearly in both
themes with the Voice name staying centred; a tap on `A` does nothing and a
drag past `DRAG_PX` turns it to `M`; `M` reached by a drag or a Contents row
returns to `A` on a tap without starting playback, paused or on a process
that has never played at all (#53); `M` while playing returns on a tap with
playback continuing, by a glide near or a jump far; a far drag holds `M`
across a 15-22 s wait (several sentence starts at this book's pace) with no
self-return, and landing the reading's own current chapter back on screen —
reached through Contents' current-row rather than by reversing the far
drag, which could not reliably out-run the reading's own continued advance
meanwhile — reads as `A` again unprompted. Collapsed: neither mark is
shown; a real drag reaches nothing (`line-follow.cjs`'s frame log shows the
ordinary glides continuing on schedule through the drag's own timestamp,
no extra scroll); a real tap on body text still seeks (the same frame log's
`msgs` show a fresh `speak` cue and a matching move at the tap); reopening a
playing collapsed pill leaves it playing and following, and browsing then
collapsing then reopening returns to `A` first, never surfacing `M`.

## What was done (batch 4: Continuous)

Built and unit-tested without a device, in a worktree of its own beside batch
3's, while the machine had no memory for a third simulator. It was measured on
the device after both were merged ("Measured on the device", below), and the
review fixes after that changed the rest gate and the paragraph glide again.

- **The setting.** `AppSettings.following.scrolling`, `'line'` (the default) or
  `'continuous'` (`SCROLLINGS`), shown as `By line` and `Continuous`
  (`SCROLLING_LABELS`). `settings-storage.ts` reads anything else, including a
  file written before it existed, as `'line'`. General shows `Scrolling` as the
  first row of batch 2's card, above `Line position`.
- **The message.** `FollowingMessage` gains `scrolling`, and both fields travel
  every time: `setLinePosition` and `setScrolling` each send the pair, so the
  program never holds half of an old choice. The program is built with
  `var SCROLLING = "line"` (`BAKED_SCROLLING`), and the document message re-sends
  the pair when either field differs from its baked value. On arrival, leaving
  Continuous calls `halt()` and forgets `drifting`, and a following page is then
  sent to the new target through `approach(aim())`.
- **The target carries a `lead`.** In Continuous, `aim()` and `followWord` aim at
  `{ line, lead }`, and `moveFor` returns `middle − at + lead`: the line being
  spoken is held `lead` px above the line position. `leadOf(ranges, line)` is
  `lineLead(line.left, from, to, pitch)` (`glide.ts`): the word's share of the
  way along its line, clamped to [0, 1], times the distance to the next line. At
  the start of a line the lead is 0, the same place By line holds it. At the end
  it is nearly a whole pitch, so the next line is nearly at the line position when
  the voice reaches it. The step left at a line change is the last word's width
  over the line's, about an eighth of a pitch, or 2–5 px, and the follower
  absorbs it.
  - `from` and `to` are the leftmost and rightmost client rects that overlap the
    word's line by more than half the smaller height. They are the text drawn on
    the line, not the Block's content box. The last line of a paragraph stops
    short, and a Document's own centred line starts late. Against the box, the
    lead of either would never reach a whole pitch, and every such line change
    would owe the rest as a jump.
  - `pitch` is the next line's top minus this line's top. On a Block's last line
    it is this top minus the previous line's, and on a one-line Block the line's
    own height. It is clamped to that height when it is not positive or is over
    three times it. The gap to the next Block is not part of the lead: it is a
    glide (below).
  - The rects are measured over a Range of ±`NEAR` (400) code units around the
    word, not the whole Block. A Document that is one `<div>` with `<br>`s makes a
    Block a chapter long, and its `getClientRects()` on every word would be a
    chapter's worth. `nearby()` snaps the window's ends to the text nodes the walk
    found, as `domRange` resolves offsets.
- **The follower.** `driftVelocity(e, v, dt) = v + (e/τ² − 2v/τ)·dt`, a critically
  damped second-order follower, stepped once per drawn frame (semi-implicit
  Euler). `τ = DRIFT_TAU_MS = 200` ms, and `dt = min(now − last, 2 × FRAME_MS)`,
  with the first frame counting as one, as a glide is timed. Simulated in
  `glide.test.ts`:
  - A 20 px step never passes 20 (19.98 at most), and is at 96 % after 1 s.
  - A 9 px/s ramp is followed 3.45 px behind; `2τr` predicts 3.6.
  - A staircase of 3 px every 330 ms, the words of a line, moves at 7.1–10.4 px/s
    and never stops between words.
  - Why τ = 200 ms: long enough that the page is still moving when the next word
    lands, so the steps join, and short enough that the lag stays a few pixels.
- **Whole pixels.** WebKit's `scrollTop` is integral in CSS px (01:33). The
  drift keeps an `owed` fraction, pays it a pixel at a time through `nudge`, and
  steers by `move − owed`. Steered by `move` alone, the pixel not yet paid reads
  as still to go, and the follower pushes past and back, dithering ±1 px. It
  rests when `|move − owed| < 0.5` and `|v| < DRIFT_RESTS` (0.002 px/ms, 2 px/s),
  and the next word `kick()`s it again. At 5–10 px/s that is one 1 px scroll
  every 100–200 ms: one point, three device pixels on the owner's 3× screen.
- **Drift or glide, `steer(aimed)`.** A move of more than the line's height calls
  `rest()` and then `bring(aimed, false)`: a glide within the visible page, a jump
  beyond it. Anything less is a drift.
  - Within a Block, a line change is about an eighth of a pitch plus the lag
    (about 4 px), so it drifts.
  - A paragraph break (its margin plus an eighth of a pitch) and a heading glide,
    and so does a sentence elsewhere.
  - A glide under way owns the page. `drift()` does nothing while `glide` is set,
    and `glideStep` calls `kick()` when the glide ends.
  - The Clip cue's `follow()` and the `following` message go through
    `approach()`: `steer` in Continuous, `bring` By line. `place()` and
    `settle()` stay instant, and aim with the lead.
- **Stopping.** `halt()` also `rest()`s and cancels the drift frame. That covers
  the first `touchmove`, `clear`, `browse` and every instant move. `drift()` rests
  when `!state.follow`, when browsing, or in By line. A pause stops the words, so
  the drift finishes its last approach, within about a second, and rests.
- **The rest gate and the program's own scroll (#58, ADR 0045).** The gate exists
  because iOS drops epub.js's correction scroll while *iOS* is moving the page:
  under a finger, in momentum, in a bounce.
  - This program's scroll is `container.scrollTop += y`, in `manager.scrollBy`
    read out of the bundle. It is synchronous, and a correction between two of
    them is kept. Measured: `scrollTop +=` on successive frames with an erase above
    did not move the text (notes/NOTES_2026-09-24.md, 02:35), and neither did a
    trim 324 ms after a glide (notes/NOTES_2026-09-26.md, 01:42).
  - Continuous scrolls every few frames for a whole sentence. Counted as moving,
    it would park every trim until the owner paused, and sections would pile up
    for as long as they listened.
  - So `nudge` records `ownTop`, the `scrollTop` it leaves. It also advances
    `scrolledTop` to it, but only if `scrolledTop` equalled the pre-scroll
    position. Otherwise something else moved the page since the last event, and
    that position is left to say the page is moving.
  - `noteScroll` ignores an event at `ownTop`: it takes the position, not the
    time. `watchForRest` counts a frame at `ownTop` as still.
  - Every other position still closes the gate, exactly as before: a finger, a
    fling, a bounce, and epub.js's own erase and counter corrections.
  - By line benefits too. Glides no longer close the gate, so a trim may land
    mid-glide, and the glide's per-frame re-measure absorbs it.
  - `rules.test.ts`, "the rest gate, run", evaluates the five functions, `nudge`,
    `noteScroll`, `moving`, `watchForRest` and `watch`, against a fake stage and
    clock:
    - A drift of 1 px every three frames lets a parked trim run within 217 ms.
    - A decelerating fling holds it until 200 ms after its last frame.
    - A program scroll made mid-fling does not clear `moving()`.
- **epub.js's own `check()` while drifting.** Read out of the bundle:
  `this._scrolled = f()(this.scrolled.bind(this), 30)`, where `f` is lodash's
  `debounce` with no `maxWait`. So `scrolled()`, which enqueues `check()` (the
  appender), runs only after 30 ms without a scroll event.
  - A drift below about 30 px/s nudges at least 33 ms apart, and `check()` runs
    between nudges.
  - Faster, as with a large Font Size at 2×, it runs when the drift rests at the
    end of a sentence.
  - `renderAhead()` asks for the reading's next section on every Clip cue
    regardless.

### Measured on the device (notes/NOTES_2026-09-26.md, 12:49–15:25)

`continuous-follow.cjs` (new; an independent recorder beside `line-follow.cjs`'s
own) at 1.0× (20 s) and 2.0× (10 s), plus `FollowingProbe.swift` real touches
and the existing `line-follow.cjs`/`fling-jump.cjs`, on "Cultivation Online."

1. The rolling itself, confirmed at both rates: steps of 1-4 px (median 1),
   at a median 92-100 ms apart at 1.0× and 50 ms at 2.0× (the cadence halves
   with the words' own pace; the step size does not, since `scrollTop` only
   moves in whole CSS px either way). A 6 s recording, frames extracted
   100 ms apart, showed a smooth few-pixel shift with no doubling — rolling,
   not trembling, at normal viewing speed. **Not separately isolated**: the
   lead's own growth-and-reset shape and the rolling lag in px — the frame
   log recorded `scrollTop` only, not the lead value itself; both are
   consistent with what was seen (no in-drift step ever exceeded 4 px) but
   neither was measured directly.
2. Paragraph/heading glides: 2 at 1.0× (217-302 ms), 3 at 2.0× (217-234 ms),
   both clusters near the ~250 ms figure and clearly apart from the drift's
   own much slower rate (0.09-0.12 px/ms vs the drift's own two-orders-lower
   rate) — and not rate-scaled, a fixed animation length regardless of
   reading speed. The drift's own stepping resumed after each one in the
   same recording. **Not separately isolated**: a targeted "no glide, only
   drift" case for a sentence that begins on the already-current line.
3. Not isolated (see 2).
4. Confirmed: 12 rests (183-534 ms) at 1.0×, 3 (350-1130 ms) at 2.0×, each a
   stretch of at least 12 still frames (~200 ms) with no drift step, ending
   as soon as the next word's `kick()` arrived.
5. Confirmed. A genuine continuous-playback window crossing one section
   boundary recorded zero `views` changes (this book's sections are long: the
   window was several real minutes); a `--skips 45` follow-up forced one
   append and one trim in seconds, the trim itself a single 16 ms frame
   (`-4090 px`) between two skip-glides both resting within a pixel of
   target — the text did not move. `fling-jump.cjs`'s #58 gate re-run under
   Continuous: 6 of 7 GREEN, 1 RED matching the pre-#58 signature exactly;
   a same-day, same-position comparison under By line was 3 of 3 GREEN, and
   since `FlingProbe` never plays (the drift is inactive throughout either
   way), this reads as the probe's own already-documented flakiness rather
   than a Continuous-specific regression — flagged for a larger sample, not
   treated as a confirmed defect.
6. Not measured: no Font Size change was made in this session.
7. Confirmed: a real drag during the drift stopped it at once (`M`,
   playback continuing); a real tap on `Pause` then `Play`, and separately a
   real tap on `M`, each resumed both the drift and the page.
8. Confirmed functionally, by real touch rather than through the harness: a
   Library round trip while playing, changing Line position to 40% and
   Scrolling to By line from General and returning by the Reading Button,
   took both new values live with no reload and playback still going.
   **Not separately isolated**: the lead's own instant drop at the moment
   the setting changes, at the frame level — no `arm`/`analyse` bookended
   this specific transition.

## Review fixes (after batches 3 and 4)

A review of the merged branch against #71 and the owner's decisions, and the
device run above, left five things to change. Each was measured on "iPhone 17
feat_scroll" (iOS 27.0), Cultivation Online 2001-2044, Fish "Laura" at 1.00×,
with `test/manual-test/follow-fixes.cjs`; raw lines in
`notes/NOTES_2026-09-26.md` from 15:57.

- **Pause stops the page on its frame.** `HoldMessage` gains `stop`, sent by
  `pause()` and by the reading ending on a failure (`hold({ stop: true })`); the
  renderer's `'hold'` calls `halt()` for it, which ends a glide where it is and
  rests the drift. Not on every hold: the hold `use-reading.ts` sends after a
  Clip cued while paused comes in the same task as that cue, and a tap or skip
  while paused has usually just started a glide, which it would cut short. The
  owner chose the stop at once for Continuous on 2026-09-26; By line's glide
  stops with it, since a pause is the same act in either. Measured in
  Continuous: steps of 1 px up to 16558 ms, the `hold` with `stop` at 16608, and
  no movement in the 1.5 s after it.
- **`recover` means a new Utterance.** `engine.setRate` cues `last.clip` again
  (`src/playback/engine.ts`, `setRate`), and a Voice switch re-cues too, so a cue
  with `recover` can be the sentence already being spoken. The renderer now
  reads `begins = recover && state.utterance !== message.utterance`, before it
  replaces `state`, and nothing downstream reads `recover` itself: a re-cue
  neither ends Browsing nor sends a following page to the Utterance's first line
  (the correction that follows the cue moves it by the word). Measured: M at
  4679 ms in Utterance 120, the speed change's re-cue of 120 at 6341, and in the
  3282 ms until Utterance 121 began, no scroll and no A; at 121, whose first line
  was on the screen, A at 9624 and a 56 px glide in 284 ms.
- **Continuous glides across a Block.** `steer` compared the move with the
  line's rect height, so a Document with small paragraph margins drifted across
  its gaps. `build()` now keeps each Range's Block (`built.blocks`), `lineOf()`
  records it (`line.block`), and `steer` glides when the line is in another
  Block than the one followed before (`crossed`), as well as for any move over a
  line. Measured with the book's own margins: crossings of 22 and 56 px glided
  in 207 and 284 ms. With paragraph margins forced to 0 in the live section
  documents (a test-only stylesheet, removed after): one crossing needed less
  than a pixel, since the lead had carried the page there, and two moved 4 px on
  four consecutive frames in 134 ms, a glide's shape, where the drift steps a
  pixel about every 100 ms.
- **A drag is measured on the screen.** `dragged()` compared `clientY` with the
  first move's. In a section document `clientY` is the document's, and once iOS
  takes the finger for a scroll the document moves with it. A touch tracer on
  ten of `FollowingProbe`'s drags (175 pt at 250 pt/s): in six, `clientY` ended
  8 to 11 px from its first move while `scrollTop` rose 160 to 163 px, and M came
  from a transient excursion just past `DRAG_PX`. `dragged()` now records
  `touchTop`, the container's `scrollTop` at the first move, and in a section
  document subtracts the page's scroll since: `clientY − touchY − (scrollTop −
  touchTop)`, 56 to 171 px for the same drags. In the scroll container (the
  margins) `clientY` is the top document's and nothing is subtracted.
  `FollowingProbe.testReopenAndShotAThenM`, which the device run above failed 5
  times in 7, passed 10 of 10, each on its first drag. (Gentler drags, 70 pt at
  120 pt/s, and fast ones, 600 pt/s, reached M 10/10 and 9/10 with either
  comparison, so the margin, not a count, is what the old one lacked.)
- **The rest gate forgets the program's position.** `ownTop` was kept until the
  next program scroll, so a scroll event or a frame at exactly that position
  counted as the program's however much else had moved the page since — a fling
  coming back to, or bouncing against, where the page was last put opened the
  gate mid-fling. `noteScroll()` now clears `ownTop` on the first event anywhere
  else, and `watchForRest()` on the first frame anywhere else. The executed rule
  "forgets the program's own position" fails without this (the trim ran at
  1266.7 ms, mid-bounce, where it must wait past 1466.7) and passes with it.
  `fling-jump.cjs down 8`, which never plays: Continuous 8 of 8 GREEN, By line 8
  of 8 GREEN, every change above the viewport made at rest. Whether this path
  was the one RED of 7 above is not known: that run's log was not kept apart.

Collapsing the player while paused was confirmed by the owner as it is (the
batch 3 section above).
