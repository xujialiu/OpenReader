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

**Opening it sometimes landed on a blank page.** Twice out of three opens, the
2,077-spine-item book opened, sections rendered and reported their Blocks — the
screen said "108 Utterances ready" — and the view manager then held **zero views**,
an empty container and a `currentLocation()` of `{}`. The third open, taken with
the same build minutes later, rendered the cover and four sections and stayed that
way. The same thing happened to a 2,567-byte fixture on one cold open of four, so
it was never about the book's size. `rendition.display(0)` afterwards rendered
everything; moving to any section recovered completely.

### Diagnosed, 2026-09-20: a resize with no location destroys the page

**A resize clears every view, and epub.js only puts them back if it already has a
location.** Read out of the bundled epub.js and then reproduced on the device in
both directions.

The stage's resize observer calls the view manager's `resize`, which — whenever the
size really changed — calls `this.clear()` and destroys every view. The rendition's
own handler is then the only thing that rebuilds them:

```js
onResized(size, cfi) {
  this.emit(RENDITION.RESIZED, { width: size.width, height: size.height }, cfi);
  this.location && this.location.start && this.display(cfi || this.location.start.cfi);
}
```

`this.location` is set by `reportLocation`, which first runs when the **opening**
`display()` resolves. A resize landing before that finds no location, re-displays
nothing, and leaves exactly the recorded state. Four other callers of `clear()`
exist — `destroy`, `display`, `next`, `prev` — and none of them fits: the symptom
set includes sections having rendered and been reported *first*, which a failing
`display` cannot produce and which `next`/`prev` are never called to produce at an
open.

Forced on the device, with everything else unchanged
(`notes/NOTES_2026-09-20.md`, 01:51):

| forced resize | at the resize | 700 ms later |
| --- | --- | --- |
| with a location | views 0 | **views 2** — epub.js recovers |
| with the location cleared | views 0 | **views 0, children 0** — blank, for good |

**The trigger is the reader's own layout settling.** Measured once in the wild
(01:55): opening the owner's book laid the document element out twice, `402x874`
and then `402x758` **1.6 s later** — the navigation header's height arriving. The
book's opening `display()` has often not resolved within 1.6 s, and the fixture's
always has, which is the shape of "two opens in three on the big book, one in four
on the small one". It is rare rather than reliable: seven later opens of the same
book laid out once and never resized.

### The fix recovers rather than prevents, and why

`highlighter.ts` listens for `resized` and re-displays **only when epub.js has
declined to** — when there is no `location.start`. With a location the library
recovers by itself and a second display would fight it.

Recovering rather than preventing, because the trigger is not one thing: a header
settling today, a rotation tomorrow, a sheet the day after. A resize is a legitimate
event and the page has to survive every one of them; suppressing this particular
layout change would leave the next one to find the same hole.

What it costs: the target is **the lowest spine item that was on the page**, not
the reading's exact position, because by the time the handler runs `clear()` has
already destroyed the views and `scrollTo(0, 0)`'d the container — there is nothing
left to read a position off. So the reader lands at the top of the section they were
in rather than where they were in it. That is the same trade the contents list makes
(ADR 0020: "you land slightly early rather than somewhere unpredictable") and it is
strictly better than the blank page it replaces. When a reading is under way it
self-corrects within one sentence, because the next Clip cue centres the Utterance.

It is **silent on success**, deliberately. `ProblemMessage` means "a highlight could
not be drawn" and widening it to also mean "the page was rebuilt" is how a protocol
starts lying; a failed recovery still reports. The event the owner would have
noticed — a blank page — is the thing that no longer happens.

**What is not claimed.** The wild blank was never caught with the watcher
installed, so this is a mechanism that reproduces the entire recorded symptom set
and that no other caller of `clear()` can produce — not a recording of the original
failure. Seven opens of the owner's book after the fix all rendered, against a
recorded two-in-three failure rate, which is suggestive and nothing more; the
before/after on the forced resize is the evidence.

It is also **not** the cover being unpaintable: under this layout the cover image
paints, which the paginated run at `notes/NOTES_2026-09-19.md` 18:31 recorded it
not doing.

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
