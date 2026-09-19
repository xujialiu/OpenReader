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
