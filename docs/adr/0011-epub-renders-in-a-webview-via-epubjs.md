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

Four things about it belong on the record.

**It adds no traffic across the bridge.** The scroll is driven by the Clip cue the
renderer already receives when an Utterance starts speaking — the `follow` path in
`renderer/reader-bridge.ts`, which fires once per Utterance and never per word. No
new message in either direction, and in particular nothing at the
`requestAnimationFrame` rate that ADR 0005 exists to keep off the bridge.

**It costs memory, and the cost was measured rather than assumed — and it came
back small.** `scrolled-continuous` keeps several sections alive at once instead
of swapping one view per page turn. Measured on the owner's 34.4 MB,
2,077-spine-item book (`notes/NOTES_2026-09-19.md`, 20:15 and 20:32), iPhone 17
simulator, iOS 27:

| | React Native process | WebKit content process |
|---|---|---|
| launched, small fixture open | 181 MB | 32 MB |
| the big book open and settled | 318 MB (peak 531 MB) | 249 MB (peak 410 MB) |
| after 250 Utterances of reading | 344 MB | 269 MB |

The several-sections-alive cost is the second column, and **it is not what
grows**: the continuous manager holds three views and trims the rest, so 250
Utterances moved it 10 MB. What grows is the first column, ~20 MB over those same
250 Utterances, and it is the Block list the app accumulates and re-segments as
each new section reports — which paginated layout does too, only slower, because
continuous reading crosses sections sooner. So the thing this ADR said would move
if the number came back bad is the thing that did not move, and the accumulation
that did is not this decision's to pay for.

**The word highlight was verified under paginated layout and has now been
re-verified under this one.** Both findings behind the highlighter painting at all
were gathered in the multicol iframe a paginated reader builds
(`notes/NOTES_2026-09-19.md`, 16:08), so none of it carried over. Both were
re-run on the device under `scrolled-continuous` and both hold:

- A text node captured from a rendered section, looked at again after the reading
  had moved six sections on, reported `isConnected === true` with
  `ownerDocument.defaultView === null`, and the section's document had been
  replaced. The manager destroys and rebuilds views as they scroll out of reach,
  so a Block record holding a node would hold a node in a dead document and
  `isConnected` would still not say so.
- `user-select: none` still stops `::highlight()` painting. Bisected on the device
  with the same `Range`s registered throughout: `text` → painted, `none` → nothing
  drawn, `text` again → painted.

**It holds the Utterance within a pixel of the middle, and costs no frames.**
Centring error measured at 0.05 px, 0.25 px, 0.78 px and 0.97 px on four separate
Utterances of the big book, the residual being the sub-pixel of the `Range`'s own
box. Where it is larger it is because the scroll hit an end: an Utterance in the
first screen of the rendered text cannot be brought any lower than the top of it,
and that is the whole of the difference rather than an inaccuracy.

Frame intervals, recorded inside the WebView across 83 s of reading at roughly ten
times real cadence: mean 16.67 ms, p50 17 ms, p95 17 ms, p99 18 ms, max 39 ms,
three frames over 33 ms and none over 100 ms. Dragging the page through six
sections by hand-sized scrolls instead gave p99 22 ms and max 142 ms, with two
stalls over 100 ms where a section was parsed — that cost is epub.js rendering a
section and is paid by a finger scroll too.

## What the big book does that this decision did not ask about

**Opening it sometimes lands on a blank page.** Twice out of three opens, the
2,077-spine-item book opened, sections rendered and reported their Blocks — the
screen said "108 Utterances ready" — and the view manager then held **zero views**,
an empty container and a `currentLocation()` of `{}`. The third open, taken with
the same build minutes later, rendered the cover and four sections and stayed that
way. So it is intermittent, and the mechanism is not established: an attempt to
catch it by instrumenting the manager's `trim` and `erase` is the run that did not
blank, so nothing was recorded. It is written down as unexplained rather than
diagnosed.

What is established is that it is a defect of the open and not of the reading.
`rendition.display(0)` afterwards renders the cover and the four sections after
it; moving to any section recovers completely; and the reading, once moving, is
what the figures above describe. It is also **not** the cover being unpaintable:
under this layout the cover image paints, which the paginated run at
`notes/NOTES_2026-09-19.md` 18:31 recorded it not doing.

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
