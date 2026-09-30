---
status: accepted
---

# A paused Contents row browses, and the page stops following the reading until it is revealed

_The product argument is
[design 0044](../design/0044-looking-at-another-chapter-keeps-your-place.md)._

_Superseded in part by [ADR 0063](0063-a-contents-row-browses-while-playing.md)
(#107): the row browses while playing too, and `goToSection`'s condition has
no `!playIntent.current`. What follows about the "Not playing" condition
describes the code before #107._

While the reading is paused, a Contents row is **Browsing** (CONTEXT.md). The
page goes to the spine item. The cursor, its highlight, the stored Reading
Position and the engine are left alone, and Play resumes the paused sentence.
This revises the Contents row's place among ADR 0020's six seeks. While
playing, and in a Document with no Reading Position yet, the row is still
ADR 0020's two steps.

Doing it took two halves, because the WebView undid a browse by itself.

## The React Native half: `goToSection` decides

`use-reading.ts`'s `goToSection` browses when all three of these hold:

```ts
if (!playIntent.current && atRef.current !== null && !unreadRef.current) {
  pendingSectionRef.current = null;
  bridgeRef.current?.browse(section);
  return;
}
```

- **Not playing.** The page follows the voice (ADR 0011), and every cue
  reveals its sentence. A browse while playing would be undone at the next
  sentence boundary.
- **A cursor exists.** A stored place that is still waiting for its own section
  (#51) has no highlighted sentence to keep. There the row does what it did
  before: it seeks, and it abandons the place with the "had not rendered yet"
  sentence. The window is the time it takes the opening place's section to
  render: 17–585 ms on the owner's books (#50, #51).
- **The cursor is a Reading Position.** `unreadRef` starts as
  `resume === null`. It is cleared by `play()`, by `pointAt`, which is the tap
  (`onTap`, and the exported `seekTo`) and all four skips, and by `resumeAt`. A
  Contents row's own seek does not clear it. So in a new Document the most
  recent row wins, and `readingPosition()` answers null while it holds, so the
  choice is written nowhere: not to `library.json`, not to the Positions File.
  CONTEXT.md's Reading Position now says what the code already did for a tap:
  "the sentence speech stopped on, or the one the owner has since pointed it
  at".

A browse issues no seek. The measured cost that removes: `engine.seek` is
`restart(); pump()`, and `pump()` starts `fetchWindow` at once, so a paused
jump synthesized the looked-at chapter's heading and up to
`READ_AHEAD_UTTERANCES` (3) more. After the fix, with a paused Fish engine and
`watchfetch` on, a browse sent no request (notes, 2026-09-24 00:07).

## The WebView half: a page-level `browsing` flag

Measured on 2026-09-23 at 23:30 (notes): the reading was paused in section 14,
and the WebView displayed section 16, the call a Contents row makes. epub.js
rendered 16, prepended 15, then prepended 14. The highlighter's `attach()`
found the paused Utterance in the new section 14 and `centreOnce()` scrolled
−7,424 px to it (stack `centre<centreOnce<attach<sweep`). epub.js then filled
upwards and trimmed, and section 16 was gone from the views. So a React Native
change alone would still have lost every browse to the chapter after next. A
display of section 17, which re-rendered only 15 and 16, stayed on 17.

`highlighter.ts` therefore keeps `browsing`:

- **Set** by a `BrowseMessage`, which `bridge.browse(index)` sends immediately
  before the same `goToLocation(String(index))` `goToSection` uses. Both are
  injected, so the flag is set before any section of that display arrives.
- **Also set by a finger dragging the page**: a `touchmove` more than 10 px
  from where that touch first moved, recognised by `Touch.identifier`. It is
  heard in each section document and in the scroll container. It uses
  `touchmove` alone because ADR 0020's rule keeps `touchstart`, `touchend` and
  the rest out of the program, so the long press on text stays the platform's.
  The listeners are passive. A tap is a `click`, which a drag never becomes.
- **Cleared only by a `SpeakMessage` with `reveal: true`.** That is the voice,
  or the owner pointing at a sentence.
- **While it is set**, `centreOnce()` and `settle()` return at once. Those two
  are the only automatic scrolls toward the reading: `attach()` on the
  reading's section arriving, and the re-centring after an Appearance reflow.
  `awaited()` also treats an off-page section as waited for, not failed, so a
  repaint while browsing does not post "not on the page".

A speak with `reveal: false` is a repaint. Its Utterance keeps the previous
Utterance's `follow`
(`var following = message.reveal || !!(state && state.follow)`), so a repaint
at the reading keeps its re-centring after a reflow. With the bridge's `follow`
option false, which nothing in the app sets, every speak is unrevealed and the
first Utterance does not follow, so that option means what it did.

## Who reveals

`reveal` is decided in React Native, per call. That side knows whether the
owner is listening.

- **Cues reveal only while playing.** `BridgeClock.onClip(cue, { reveal })`
  extends `ReaderClock` with an optional argument that the engine never passes.
  `use-reading.ts`'s clock passes `playIntent.current`. The cues that arrive
  while paused are a paused seek's Clip arriving, and `setRate` re-cueing the
  Clip it re-scales (`engine.ts`). Both used to reveal, so a speed change while
  paused pulled the page back.
- **`show()` reveals unless told not to.** The engine rebuild in
  `disposeEngine` repaints the cursor with `{ reveal: false }`: a Voice chosen
  while paused may be chosen while browsing. Tap, skip, the Contents row's own
  seek, a place from another device and a stored place landing still reveal.
- **Play reveals through its first cue**, as since #50. `engine.play()` cues
  the front at once when a Clip is queued. Otherwise the cue comes when the
  Clip arrives. A Play that is paused again before its first Clip arrives
  therefore leaves the page where it was: that cue comes while paused. Measured
  at 00:06:55. The alternative, a `show` on the press, would have drawn the
  sentence without its words and centred ahead of the display timing #50
  measured, for a case where nothing was heard.

## Measured after the change (notes, 2026-09-24)

- `browse-probe.cjs … 16`, reading paused on Utterance 190 in section 14:
  GREEN. Views `14,15,16`, page top 16, status and stored place unchanged. The
  same run as 23:30's pull-back, without it. GREEN again with a paused engine,
  and at 00:15 for 16 and for 30.
- Scrolling back up re-rendered section 14 with its highlight painted, and with
  no centring scroll.
- A rate change to 1.55, a new Voice and Font Size 18 while browsing: the page
  top stayed at section 16, 0 px.
- Play after browsing: the reading started at 190, and on the first cue the
  Utterance was at y 273..352 of the 758 px container.
- A row while playing: 190 → 529, section 20's heading, still playing, at
  2.4 s.
- A new Document: rows to 10 and then 20 moved the cursor 266 → 626. The
  Library's place was null before and after `shut`.

## Considered

- **Only the React Native change.** The measurement above shows the WebView
  undoing it.
- **Setting the current Utterance's `follow` to false on a browse, with no
  page-level flag.** An unrevealed repaint while browsing, or a Clip arriving
  while paused, builds a new Utterance state and would have had to know about
  the browse anyway. A finger drag is seen only in the WebView.
- **Decoding which scroll events were not ours** to detect a finger. epub.js
  scrolls on its own for `counter`, `moveTo`, `scrollTo` and `trim`, and
  telling those from a finger by timing is guessing.
- **No exception for a Document with no place.** Play would have loaded the
  engine at `atRef ?? 0` and read the top of whatever had reported, which is
  #46's failure.

## Limits

- A stored place still waiting for its section is given up by a row, as
  before, rather than kept.
- The opening place and a place from another device still reveal when they
  land. A browse made before either lands is overridden by it.
- The finger-drag detection has not been exercised by real touches on a
  physical phone.
