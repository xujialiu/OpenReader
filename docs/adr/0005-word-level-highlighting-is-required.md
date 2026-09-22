---
status: accepted
---

# Word-level highlight sync is a requirement, not a stretch goal

*The product argument — what this is for and what it gives up — is
`docs/design/0005-word-level-highlighting-is-required.md`.*

Speech is highlighted word by word, to the same standard as the desktop plugin,
and this was chosen deliberately over the cheaper option of highlighting only
the current utterance.

This is recorded because it is the single most expensive decision in the project
and a later reader will otherwise assume it was incidental. It requires playback
position callbacks accurate to well under 100ms, and a document renderer that
can highlight an arbitrary text range and scroll it into view on command. Those
two requirements, not the reading or the speaking, are what dictate the choice
of playback engine and of renderer.

## Consequences

The alignment half of the problem is already solved and comes across intact:
`core/align.ts` in the Zotero-TTS plugin is 292 lines that map the words a
provider says it spoke back onto the source text, by longest common subsequence
with bridging. It exists because the obvious implementation — searching for each
word from a moving cursor — was measured dragging the highlight two lines down
the page and leaving it there, when a provider silently rewrote `29.83` as
words. It has no platform dependencies and it, its 275-line test and the
`kokoro-negative-start.json` fixture are the first things to carry over.

A provider that reports no word timings is highlighted at utterance level
instead. Timings are never estimated or interpolated to fill the gap.

## What this costs on mobile, measured rather than assumed

**Word timing is a provider capability, not a client one.** This was already
true on the desktop and stays true here, but the matrix is worse:

| Provider | Word timings on React Native |
|---|---|
| Speechify, Fish Audio, self-hosted Kokoro | yes, over plain HTTP |
| OpenAI | never — the speech API returns audio only |
| **Azure** | **no** — `WordBoundary` exists only in the Speech SDK, and Microsoft's own React Native sample carries a 2024 notice that the SDK does not support React Native |
| `expo-speech` (the OS voices) | **yes** — `onBoundary({ charIndex, charLength })` on iOS since 2023 |

So this app loses word-level highlighting for Azure, which the desktop plugin
has. That is a real regression and the options are all unattractive: proxy Azure
through a server, which contradicts ADR 0002; spike the JavaScript SDK under
React Native, which nobody has published a result for; or accept utterance-level
highlighting for Azure as the plugin already does for OpenAI.

_Superseded for Azure by
[ADR 0037](0037-azure-word-timings-come-over-a-hand-written-websocket.md)
(2026-09-22). The SDK is not the only way to Azure's word boundaries. The
desktop plugin speaks Azure's WebSocket protocol itself, and the same frames
give this app word boundaries with raw PCM. The rest of this file stands._

The unexpected compensation is that the operating system's own voices report
word boundaries for free, with no key, no network and no model to ship.

## The rendering architecture this forces

Three findings decide it, and each rules out the obvious implementation:

- **Never send a position update per word across the React Native ↔ WebView
  bridge.** `postMessage` is implemented as a script injection and `eval` per
  message. At three to five words a second that is the wrong mechanism.
- **Never put playback position in React state.** Re-rendering at the tick rate
  blows the frame budget.
- **Never highlight by mutating the DOM per word.** The CSS Custom Highlight
  API styles arbitrary `Range` objects through `::highlight()` with no markup
  change and no reflow. It arrived in Safari 17.2, and the deployment target was
  raised to 17.2 for exactly this reason (ADR 0001), so it is available
  unconditionally and **there is no fallback path to write**.

The design that works: push the whole word-timing array into the WebView **once**
when a clip starts, let `requestAnimationFrame` inside the WebView interpolate
against a start time, and send a position correction about once a second for
drift. One message per second, not one per word.

The clock the interpolation is corrected against is the **source node's own
content position** — see ADR 0012, which chose the playback engine for exactly
this reason, and which explains why the audio context's clock is the wrong one to
read despite looking like the obvious choice.

One detail that is easy to get wrong regardless: provider timings are reported at
1.0× and must be scaled by the playback rate, which in this app is 1.5–3×.
