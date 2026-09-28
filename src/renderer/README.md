# src/renderer — ADR 0011, ADR 0005

The bridge to the document, and the highlighter that lives on the other side of
it.

EPUB renders through `@epubjs-react-native/core`, which hosts epub.js inside a
WebView. It inlines epub.js and JSZip as JavaScript strings rather than loading
them from a CDN, so it works offline, and it exposes CFI-range annotations,
`goToLocation(cfi)` and — the part that matters most — an `injectJavascript()`
escape hatch.

**The bridge, not the library, is the thing worth designing well.** PDF will
arrive in the same WebView through pdf.js (ADR 0007), so one bridge serves every
format. The project depends on a February 2022 artifact with hundreds of open
issues for its rendering, and ADR 0011 accepts that with open eyes.

## Why epub.js and not Readium, which is better maintained

One reason: ADR 0008 requires reading positions to interoperate with the desktop
plugin, and Zotero's reader resolves CFIs with its own copy of epub.js. Staying
in the epub.js family keeps both sides speaking one CFI dialect. Readium's better
maintenance does not buy the one property this project needs most, and switching
dialects would break it.

`react-native-readium` was rejected on harder ground: its `Locator` type has no
`cssSelector`, no `domRange` and no partial CFI, so there is no documented way to
construct one for a range computed in code — and its annotation API only works
from a user selection, which is not how a speech cursor moves.

## Word-level highlighting is a requirement (ADR 0005)

Not a stretch goal, and the single most expensive decision in the project. It
demands playback position callbacks accurate to well under 100 ms and a renderer
that can highlight an arbitrary text range and scroll it into view on command.
Those two requirements, not the reading or the speaking, are what chose the
playback engine and this renderer.

## The page scrolls, and the line being spoken is held at the Line Position (ADR 0011, ADR 0050)

The reader is mounted with `flow: 'scrolled-continuous'` and the `continuous`
manager — `reader-bridge.ts` puts both in `readerProps`, because the layout and
the highlighter are one decision and the following measures against that
manager's own scroll container. Paginated layout, which is the library's default
and what the highlighter was first built against, is rejected: a page turn
replaces the whole screen and throws the eye back to the top, every minute or two,
for hours.

Eight properties of the following, and each is a rule rather than an accident.

- **It holds the line, and glides to it** (ADR 0050). The line the spoken word
  begins on goes to the Line Position — the owner's share of the page above the
  **open** player, without its notes (`lineAt`, #71), 20 to 80 % of the way down
  it and the middle by default — measured from the `Range`s that were just
  painted and the container's own box. A note on the player and the player
  collapsing move nothing. When the word moves onto another line the page glides
  there in `GLIDE_MS` (250 ms), easing out, timed in drawn frames so that a
  stalled frame pauses a glide instead of jumping it; a move further than the
  visible page is made at once. A Clip without Word Timings is held by its whole
  Utterance, and an Utterance taller than the screen then has its *start* at the
  top.
  `glide.ts` holds the curve as source text, so `glide.test.ts` runs what Safari
  runs. That is **By line**, the default. In **Continuous** (`SCROLLING`, the
  owner's `Scrolling` row, #71) every word carries the line past the Line
  Position by its share of the way along the line times the distance to the next
  (`leadOf`), and the page drifts there on frames of its own (`drift`): a
  critically damped follower (`driftVelocity`, τ 200 ms) paid out in whole pixels.
  A move of more than a line — a paragraph break, a heading, a sentence elsewhere —
  is still a glide or a jump (`steer`).
- **Nothing crosses the bridge per word.** The page moves on the Clip cue that
  already arrives once per Utterance (`follow` below) and on the words the loop
  already draws, inside the WebView; ADR 0005 exists to keep per-word traffic off
  the bridge. What #71 added crosses only when something changes: to the
  WebView, the owner's Line Position and Scrolling (`following`), M (`return`),
  the player collapsing or opening (`followOnly`) and the open player's own
  height (`openPx` on `inset`); back to the app, `openreader:following`, when A
  or M changes. By line, a word moves the page only when it is on another line,
  so the loop scrolls at most once a line; in Continuous a word only sets where
  the drift is going, and the loop itself never scrolls.
- **The scroll is not hidden from epub.js.** It goes through the manager's own
  `scrollBy` with its `ignore` flag *off*, so it reaches the continuous manager
  exactly as a finger scroll does — which is what makes it render the section the
  reading is about to walk into. `ignore` is the flag the manager's own `onScroll`
  checks before enqueuing the `check()` that appends the next section, so a scroll
  it was told to ignore renders nothing new and the reading would run off the end
  of the rendered text.
- **And the scroll alone is not enough, so the reading asks** (ADR 0023). The
  manager appends the next spine item only when the scroll comes within 500 px of
  the bottom of everything it holds, and the only thing that scrolls while a book
  is read aloud is that following, which stops at the line being spoken. A
  section whose text ends far above its own bottom therefore runs the reading out
  of Utterances with the rest of the book unrendered — measured at 3,072 px of
  section holding one line of text, the scroll at 0 and 758 px of viewport, so
  758 + 500 never reaches the bottom. `renderAhead` asks for the section after the
  one being spoken, on the same Clip cue and so with nothing added to the bridge,
  through the manager's own queue — which is what stops the appended view being
  taken apart by an `update()` before its iframe has loaded — and sweeps when its
  display resolves, a second look now that the content hook below adopts it.
  Nothing keeps it alive: the manager trims it as before, the Block records
  survive it (`blocks.ts`), and `follow()` displays it when the voice arrives. The
  program also sweeps on every Clip cue, which is what closed the state the
  reading of 04:43 died in — a section epub.js rendered by itself, sitting on the
  page unreported — before the content hook did.
- **A section `follow()` had to display is placed on the frame after it
  arrives** (#50, ADR 0023). The content hook that adopts it runs inside that
  display, before epub.js's own `moveTo` to the Block the display named, and in
  the same task. Moving the page to the line there added the two scrolls
  together: measured at 725 px and then 958 px more, with the painted sentence
  724 px above the screen.
  So the highlight is painted at once — its word quietly, so that it starts no
  glide of its own — and the page is placed on the next frame through `settle()`,
  at once and not by a glide, which then keeps the line in place while epub.js
  lays the neighbouring sections out. Any other section that arrives, such as a
  view the manager rebuilt, is placed at once, as before.
- **Nothing follows while the owner is browsing** (#52, ADR 0044), and the
  player shows it as **M** (#71, ADR 0050). A Contents row while paused sends a
  `browse` message, then displays its section, and a finger dragging the page
  sets the same `browsing` flag. Until it is cleared, `placeOnce()`, `settle()`
  and `followWord()` do nothing and a glide under way stops, so neither the
  reading's section arriving, nor an Appearance reflow, nor the next line, nor
  the next sentence takes the page back. Any move of a finger on the page also
  stops a glide where it is, from the same `touchmove` listener. It has to be
  the WebView's flag: displaying the section after next re-rendered the
  reading's own section as a neighbour, and `attach()` took the page to the
  paused sentence as it arrived (−7,424 px, measured 2026-09-23 23:30).
  A gesture with two fingers on the page, a pinch, neither browses nor stops a
  glide (#79, design 0052). `landed`, a passive `touchstart` listener beside
  `dragged`, marks the gesture a pinch when a second finger lands, and
  `dragged` ignores it until the next gesture's first finger. The page cannot
  be magnified either: the patched template's viewport is
  `maximum-scale=1.0, user-scalable=no`.
- **What clears it** (#71, Zotero-TTS's rule). A revealed highlight — the first
  cue after Play, a tapped sentence, a skip, a place from another device; M
  (`return`); the player collapsing (`followOnly`); and, by itself, a cue the
  reading moved on to while playing (`recover`) whose sentence begins with its
  first line on the visible page and the page at rest. A recovering cue whose
  sentence cannot be seen leaves the page where it is and displays nothing. A
  cue while paused, and the repaint after an engine rebuild, are sent
  unrevealed and clear nothing. `setBrowsing()` is the one writer, and it posts
  `openreader:following` to the app only when A or M changes.
- **Collapsed, the page only follows** (#71). `followOnly` makes `dragged()`
  ignore the finger and flips epub.js's own `stage.overflow()` to `hidden`, so a
  finger cannot scroll the container and the program still can; opened, the
  Stage's own value is given back.

**Every section epub.js displays is adopted as it is displayed** (ADR 0036). The
program's `sweep` — the stylesheet, the Blocks, the tap listener — is registered
on epub.js's content hook, the chain the library's own theme reaches every
section document through, and not on its `rendered` event. That event has never
reached the program: the library's template registers its own `rendered`
listener first, that listener `JSON.stringify`s the whole Section, which is
cyclic, and epub.js's emitter has no `try`, so the dispatch ends there. Until the
hook, the program adopted sections only as it installed, on `relocated` and on
each Clip cue, and a chapter a fast fling brought in after the last `relocated`
stayed white on a dark page, at the book's own size and deaf to taps (#34). The
`relocated` and Clip-cue sweeps stay as second looks; a sweep is idempotent per
document.

**The page the sections sit on is the reader's own** (ADR 0043). The program's
stylesheet reaches only the sections' documents; the library's template and the
WebView around them take their colour from the library's theme, whose page is
`#fff`, and showed white wherever no section was drawn — on opening, below a
short document, in the gaps of a long fling (#27). `readerProps.defaultTheme` is
the library's theme with that page transparent, so what shows there is the
reader's `INK.page`, and the bridge puts it in the library's provider before the
first WebView is created, because the WebView takes its colour from the
provider, not from the prop. The program is still installed only after the first
section has been displayed, so that section's first frame is under the
library's theme, its page now transparent.

**Nothing above the page changes while the page moves** (ADR 0045). epub.js
keeps the text still, when it adds or removes a section above the viewport, by
moving the scroll position itself: `trim()` scrolls back by each section it
erases above, and a prepended section's `counter()` scrolls on by its height.
iOS drops that scroll while it is moving the page, under the finger or in a
fling's momentum or bounce, so a fast scroll past the laid-out text jumped by a
whole section and landed on an empty page (#58). The program's `holdStill`
parks `trim()`, and the prepend in `check()`, while the page moves, and runs them
through the manager's own queue once the scroll position has held for 200 ms
over four frames. Movement is read from the scroll position, never from
touches: a finger that lands on a moving page seldom reaches the page at all.
Going forward nothing is held up; a fling back stops at the top of the
laid-out text until the page is still (design 0045). **The program's own scroll
is not movement** (#71, ADR 0050): `nudge` remembers the position it left the
page at (`ownTop`), and a scroll event or a frame that finds the page there does
not close the gate. What drops epub.js's correction is iOS moving the page, and
Continuous scrolls every few frames for as long as a sentence is read, which
would otherwise park every trim until a pause. Any other position — a finger, a
fling, a bounce, epub.js's own correction — closes it exactly as before, and
`rules.test.ts` runs the gate's functions to hold both halves.

**Several sections are alive at once**, which is what continuous scrolling costs
and what paginated layout did not. The Block records are keyed by spine index and
survive a section being destroyed and rebuilt, and they must: measured on the
owner's book, a text node captured from a section and looked at again after the
reading had moved six sections on still reported `isConnected === true` while its
`ownerDocument.defaultView` was `null`, and the section's document had been
replaced by a new one. That is the 16:08 finding happening under this layout
rather than under the one it was found in.

The cost itself came back small. On the 2,077-spine-item book the manager holds
**three views** and trims the rest, and the WebView process moved 259 → 269 MB
across 250 Utterances of reading while the React Native process moved 322 →
344 MB. ADR 0011 has the figures and what they mean for the decision.

## Three things this directory must never do

Each rules out the obvious implementation.

1. **Never send a position update per word across the bridge.** `postMessage` is
   implemented as a script injection and `eval` per message. At three to five
   words a second that is the wrong mechanism.
2. **Never put playback position in React state.** Re-rendering at the tick rate
   blows the frame budget.
3. **Never highlight by mutating the DOM per word.** The CSS Custom Highlight API
   styles arbitrary `Range` objects through `::highlight()` with no markup change
   and no reflow. It arrived in Safari 17.2, and ADR 0001 raised the deployment
   target to 17.2 for exactly this reason, so it is available unconditionally and
   **there is no fallback path to write.** A per-word wrapping fallback would be
   a second implementation of the hardest part of the app, written to be worse;
   raising the floor deleted it rather than deferring it. Nothing in this
   directory should ever grow a capability check around `::highlight()`.

**And never highlight through the library's annotation API.** Its
`updateAnnotation` re-renders every view's annotation pane, and each call is a
fresh string evaluation.

## The design that works

`injectJavascript` installs our own highlighter **once**. When a clip starts, the
whole word-timing array is pushed into the WebView in one message.
`requestAnimationFrame` inside the WebView interpolates against a start time, and
a position correction is sent about **once a second** for drift.

One message per second, not one per word. The scroll that keeps the line being
spoken in place rides on the first of those two and on the words the WebView
already draws from it, and adds no third.

Eleven other messages cross to the WebView, and none is on the frame path:
`hold` and `clear`, which stop the loop and take the highlights away; `browse`,
M's `return` and the collapsed player's `followOnly`, which say whether the page
follows the reading; how much of the page the player and the navigation bar are
covering (`inset`, with the open player's own height as `openPx`, and `bar`),
which are the following's inputs (ADR 0020, ADR 0048, ADR 0050); the owner's
**Line Position** and **Scrolling**, together (`following`, ADR 0050);
`measured`, below; and the owner's **Appearance** — the font, size and text
alignment the document is set in — and **Theme**, as stylesheets the program
installs (`appearance`, `theme`, ADR 0021, ADR 0022, ADR 0034). Appearance is a
message and not a rebuilt program because `injectedJavascript` is evaluated at
page load and the program refuses a second installation, so a new source string
would change nothing on a book that is already open.

The size is the owner's in every Document (ADR 0030), so it is measured against
each Document's own **body text size**. Until that is known, each section's
Blocks message also carries how its characters are sized, counted over a
bounded number of them; the bridge decides once, sends `measured` so the
counting stops, and hands the size to the app to keep for the next open.

The clock those corrections carry is the source node's own content position — see
[`../playback/`](../playback/) and ADR 0012 for why the audio context's clock is
the wrong one to read despite looking like the obvious choice.

## Highlight Level

How much text is marked as it is spoken: the word, or the whole utterance. A
clip that comes without word timings can only be highlighted at utterance level.
Timings are never estimated or interpolated to fill the gap — philosophy rule 1.
It costs every OpenAI voice (ADR 0005), and Azure's `MAI-Voice-2` voices, along
with any Azure clip whose timings end pinned to one instant (ADR 0037).

## The two halves of this directory

The React Native side (the bridge: messages out, corrections in, `goToLocation`)
may import `react-native` and `@epubjs-react-native/core`.

The WebView side (the highlighter, injected as a string) runs in Safari's
JavaScript, not Hermes, and may use the DOM freely. Keeping the two clearly
apart in separate files matters more here than anywhere else in the project,
because nothing in the type system distinguishes them.

## What is here

`index.ts` exports one thing worth using: `useReaderBridge`, which a reader
screen mounts and whose `clock` is handed to `createPlaybackEngine`. Everything
else is exported because the other half of the directory or a test needs it.

The split is where the platform is, and it is the whole of the test strategy.

| Runs under Node, tested in `test/renderer/` | |
| --- | --- |
| `cursor.ts` | A Word Timing into a place in the document, and which word is current at time *t*. Three coordinate systems and every decision the renderer makes — plus the two walks back along that chain, a tapped point and a stored Reading Position, into the Utterance to read from. |
| `blocks.ts` | The Blocks the WebView has reported, in reading order — sections arrive out of it and more than once. |
| `messages.ts` | The protocol between the two halves. Types, and the five message names that must not collide with the library's own. |
| `body-text.ts` | A Document's body text size, from the character counts the WebView reports: the size most of the text is set in, once enough text has been seen. |

| Runs in Safari's JavaScript, not tested here | |
| --- | --- |
| `highlighter.ts` | The program, as a string: the DOM walk that finds Blocks, the `Range` building, `CSS.highlights`, and the `requestAnimationFrame` loop. |
| `reader-bridge.ts` | The React Native side. `ReaderClock` in, `injectJavascript` out, Blocks and problems back, and the layout the highlighter was proved under. A wiring file, because every decision is in the two files above. |

Every decision has been moved out of the two platform files, so what is left in
them is a DOM walk and a sequence that need a real book to mean anything.
`test/renderer/rules.test.ts` reads the lines that obey each of the rules above
— the same tool `test/playback/footguns.test.ts` uses, and for the same reason:
each of them fails as something else, so nothing else would notice one being
undone. It also parses the injected program, which is the only thing that
catches a typo in a 300-line string before the app runs.

## Blocks, and why their text is verbatim

A **Block**'s text is the concatenation of its text nodes exactly as the document
spells them — the source file's newlines and indentation included. An offset into
that text is turned back into a `Range` by walking the same nodes, so collapsing
whitespace here would break the one mapping that must not drift. A Provider
speaks the newlines without noticing.

What counts as a Block is decided by the document's own computed `display` rather
than by a list of tag names, because CONTEXT.md's definition is "a run of text
the document itself presents as one unit" and an EPUB is as likely to lay its
paragraphs out in `<div>`s as in `<p>`s.

## Two things a device found that nothing here could have

Both are recorded because each fails as *nothing happening*, and both took a
screenshot to find.

**`user-select: none` silently stops `::highlight()` painting.** WebKit paints a
custom highlight through the machinery it paints a selection with, so text the
document has declared unselectable gets no highlight geometry. The library's
template applies `body { user-select: none }` through `rendition.themes.default`
whenever `enableSelection` is false — its default, and the app's. Nothing about it
looks like a failure: `CSS.highlights` accepts the `Highlight`, `::highlight()`
parses into `cssRules`, the `Range` covers exactly the right word, and the page
stays blank. `highlighter.ts` therefore declares the selectability its own
highlight needs, keeping `-webkit-touch-callout: none`, which is the property that
actually suppresses the iOS long-press menu. The cost is that text is selectable
by long-press again; the highlight is why the app exists.

**Nothing that does not survive a render may be remembered.** epub.js replaces a
section's document as the reader moves through the book — under
`scrolled-continuous` the manager destroys the views that scroll out of reach and
rebuilds them on the way back — so a remembered text node,
element or `Contents` is a reference into a document that may already have lost
its browsing context — and `isConnected` does not say so, because a detached
document still owns its nodes and they still report themselves connected to it.
`ownerDocument.defaultView` is the question that answers it. The durable record is
therefore text and a CFI, which is what ADR 0008 already made the thing that
identifies a place, and the text nodes are resolved against the live document at
paint time, walked once per document and never per word.

## A highlight that moves repaints its Block (ADR 0038)

A `::highlight()` background on a line with another line above it is painted from
the bottom of the upper line's text, and the WebKit the app ships against
repaints only a text node's own box when a highlight's ranges change. Above the
first line of a text node that is not the first line of its paragraph, which is
the first line after every `<br />`, the leading was painted by the next whole
repaint and never erased: #35, an amber strip above a word the voice had already
left. So `put()`, the only function that changes a highlight, repaints the whole
Block of every Range it takes out or puts in, through a Range over the Block's
element in a Highlight that is never registered. A screenshot is the only thing
that sees it; `test/manual-test/scrolling-and-theme/leading-strip.sh` takes one.

## What rests on running the app

The whole of the WebView side. There is no automated coverage of the DOM walk, of
a `Range` built from a Block offset, of `::highlight()` painting, of the loop, or
of the scroll that follows the line being spoken — only the glide's curve,
which `glide.test.ts` evaluates as source — and `test/README.md` is explicit
that ADR 0011 puts this inside Safari's JavaScript, "which no Node test
environment simulates", and a DOM mock would prove the mock was called.

What has been seen, on the simulator, with a temporary harness driving the bridge
from a synthetic `ClipCue`: the Utterance painted at utterance level, the word
painted on top of it, a `PositionCorrection` moving the word highlight onto the
word it names, and — from **one** `onClip` message and no further bridge traffic —
`requestAnimationFrame` advancing exactly two words over eight seconds at four
seconds a word.

And under `scrolled-continuous`, on the owner's 2,077-section book, the same way:
both highlights painting, the Utterance held within a pixel of the middle of the
viewport, an Utterance taller than the viewport pinned to its top instead, the
reading walking eight sections while the manager kept three views alive, and both
of the 16:08 findings reproduced deliberately — `user-select: none` bisected until
the highlight stopped painting and started again, and a text node from a section
the reading had left reporting `isConnected` while its document had no
`defaultView`. The figures are in ADR 0011 and `notes/NOTES_2026-09-19.md`.

The numbers ADR 0005 cares about, the one-second correction cadence watched against
a real voice and the output latency of `../playback/rate.ts`, still wait on the
device session of notes/NOTES.md item 4: a synthetic cue proves the renderer, not
the clock behind it.
