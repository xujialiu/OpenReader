---
status: accepted
---

# EPUB renders in a WebView, through `@epubjs-react-native/core`

EPUB is rendered by `@epubjs-react-native/core`, which hosts epub.js inside a
WebView. It inlines epub.js and JSZip as JavaScript strings rather than loading
them from a CDN, so it works fully offline, and it exposes CFI-range annotations,
`goToLocation(cfi)` and — the part that matters most — an `injectJavascript()`
escape hatch.

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
