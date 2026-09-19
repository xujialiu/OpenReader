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

One message per second, not one per word.

The clock those corrections carry is the source node's own content position — see
[`../playback/`](../playback/) and ADR 0012 for why the audio context's clock is
the wrong one to read despite looking like the obvious choice.

## Highlight Level

How much text is marked as it is spoken: the word, or the whole utterance. A
provider that reports no word timings can only be highlighted at utterance level.
Timings are never estimated or interpolated to fill the gap — philosophy rule 1,
and ADR 0005's matrix names Azure and OpenAI as the providers this costs.

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
| `cursor.ts` | A Word Timing into a place in the document, and which word is current at time *t*. Three coordinate systems and every decision the renderer makes. |
| `blocks.ts` | The Blocks the WebView has reported, in reading order — sections arrive out of it and more than once. |
| `messages.ts` | The protocol between the two halves. Types, and the two message names that must not collide with the library's own. |

| Runs in Safari's JavaScript, not tested here | |
| --- | --- |
| `highlighter.ts` | The program, as a string: the DOM walk that finds Blocks, the `Range` building, `CSS.highlights`, and the `requestAnimationFrame` loop. |
| `reader-bridge.ts` | The React Native side. `ReaderClock` in, `injectJavascript` out, Blocks and problems back. A wiring file, because every decision is in the two files above. |

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
section's document as the reader pages through it, so a remembered text node,
element or `Contents` is a reference into a document that may already have lost
its browsing context — and `isConnected` does not say so, because a detached
document still owns its nodes and they still report themselves connected to it.
`ownerDocument.defaultView` is the question that answers it. The durable record is
therefore text and a CFI, which is what ADR 0008 already made the thing that
identifies a place, and the text nodes are resolved against the live document at
paint time, walked once per document and never per word.

## What rests on running the app

The whole of the WebView side. There is no automated coverage of the DOM walk, of
a `Range` built from a Block offset, of `::highlight()` painting, of the loop, or
of `rendition.display()` bringing a Block into view — `test/README.md` is explicit
that ADR 0011 puts this inside Safari's JavaScript, "which no Node test
environment simulates", and a DOM mock would prove the mock was called.

What has been seen, on the simulator, with a temporary harness driving the bridge
from a synthetic `ClipCue`: the Utterance painted at utterance level, the word
painted on top of it, a `PositionCorrection` moving the word highlight onto the
word it names, and — from **one** `onClip` message and no further bridge traffic —
`requestAnimationFrame` advancing exactly two words over eight seconds at four
seconds a word. The numbers ADR 0005 cares about, the one-second correction cadence
watched against a real voice and the output latency of `../playback/rate.ts`, still
wait on the device session of notes/NOTES.md item 4.
