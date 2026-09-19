---
status: accepted
---

# EPUB renders in a WebView, through `@epubjs-react-native/core`

EPUB is rendered by `@epubjs-react-native/core`, which hosts epub.js inside a
WebView. It inlines epub.js and JSZip as JavaScript strings rather than loading
them from a CDN, so it works fully offline, and it exposes CFI-range annotations,
`goToLocation(cfi)` and — the part that matters most — an `injectJavascript()`
escape hatch.

The product argument is in `docs/design/0011-the-page-follows-the-voice.md`.

## The reader scrolls continuously, centred on the Utterance being spoken

The reader is mounted with `flow: 'scrolled-continuous'`, which selects epub.js's
`continuous` manager, and the page is scrolled so that the Utterance being spoken
sits **centred** rather than merely somewhere on screen. Paginated layout — the
library's own default, and what the highlighter was built against — is rejected.

Three things about it belong on the record.

**It adds no traffic across the bridge.** The scroll is driven by the Clip cue the
renderer already receives when an Utterance starts speaking — the `follow` path in
`renderer/reader-bridge.ts`, which fires once per Utterance and never per word. No
new message in either direction, and in particular nothing at the
`requestAnimationFrame` rate that ADR 0005 exists to keep off the bridge.

**It costs memory, and the cost is being measured rather than assumed.**
`scrolled-continuous` keeps several sections alive at once instead of swapping one
view per page turn. The 33 MB, 2,077-spine-item book in
`notes/NOTES_2026-09-19.md` is what makes that real rather than theoretical — a
book that size is the owner's ordinary reading, not an edge case. The measurement
is outstanding work; if it comes back bad, the part of this that moves is the
several-sections-alive cost, not the centring.

**The word highlight was verified under paginated layout and must be re-verified
under this one.** Both findings behind the highlighter painting at all — that a
Block record must not hold DOM nodes across renders, because epub.js replaces the
document a Block was walked from, and that `user-select: none` silently stops
`::highlight()` from painting — were gathered in the multicol iframe a paginated
reader builds (`notes/NOTES_2026-09-19.md`, 16:08). The evidence was collected in
the layout that has now changed, so none of it carries over to the layout that
ships. Re-running it on a device is outstanding work, not a formality: the second
finding was found only by bisecting where the highlight painted, and nothing about
the failure resembled its cause.

## Why not Readium, which is better maintained

Readium's `ts-toolkit` is actively released while epub.js's stable npm build
dates from February 2022 and carries hundreds of open issues. It was still
rejected, for one reason: ADR 0008 requires reading positions to interoperate
with the desktop plugin, and Zotero's reader resolves CFIs with its own copy of
epub.js. Staying in the epub.js family keeps the two sides speaking one CFI
dialect. Readium's better maintenance does not buy the one property this project
needs most, and switching dialects would break it.

`react-native-readium` was rejected on a harder ground: its `Locator` type has no
`cssSelector`, no `domRange` and no partial CFI, so there is no documented way to
construct one for a range computed in code. Its annotation API only works from a
user selection, which is not how a speech cursor moves.

## Consequences

The project depends on a 2022 artifact for its rendering. This is accepted with
open eyes, and it is why the renderer sits behind an interface: PDF will arrive
in the same WebView through pdf.js (ADR 0007), so the bridge, not the library, is
the thing worth designing well.

**Highlighting must not go through the library's annotation API.** Its
`updateAnnotation` re-renders every view's annotation pane, and each call is a
fresh string evaluation. Instead `injectJavascript` installs our own highlighter
once, which then drives the CSS Custom Highlight API from inside the WebView on
the `requestAnimationFrame` loop described in ADR 0005.
