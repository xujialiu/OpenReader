---
status: accepted
---

# Azure's word timings come over a hand-written WebSocket

_The product argument is
[design 0037](../design/0037-azure-voices-mark-the-word-on-the-phone-too.md).
This supersedes ADR 0005's Azure row, and its "this app loses word-level
highlighting for Azure". Issue #39._

## What ADR 0005 got wrong

ADR 0005's matrix said Azure has no word timings under React Native because
`WordBoundary` "exists only in the Speech SDK", and the SDK does not support
React Native. That is true of the SDK and not of Azure.

The desktop plugin never used the SDK. Its `azure-ws.ts` speaks the WebSocket
protocol the SDK speaks, by hand:
- out go the text frames `speech.config`, `synthesis.context` and `ssml`;
- back come binary `audio` frames, `audio.metadata` text frames carrying
  `WordBoundary` entries, and `turn.end`.

`WebSocket` is a global here: React Native installs it (`setUpXHR.js`), and
notes/NOTES_2026-09-19.md measured it present. The plugin's frames, with
`outputFormat` changed to `raw-24khz-16bit-mono-pcm`, return headerless 16-bit
mono samples together with word boundaries, for an English voice and a Chinese
one (measured from Node, notes/NOTES_2026-09-22.md, 14:30).

## What was chosen

- **One socket per Utterance.** Each SocketRocket socket is "intended for
  one-time-use only" (`SRWebSocket.h`), and one turn per socket is the shape the
  plugin has run daily since August. One connection does carry many turns (25 in
  8 s, notes 15:32), which is kept for #40.
- **`raw-24khz-16bit-mono-pcm`,** reported as `{ audio: 'pcm', sampleRate: 24000 }`
  (ADR 0013).
  - Not the plugin's `audio-24khz-48kbitrate-mono-mp3`.
  - Not `raw-48khz-16bit-mono-pcm` either, which from a voice listed at
    `"48000"` was 24 kHz audio upsampled, with a wall at 12 kHz (notes, 14:31).
- **The key goes in the upgrade's `Ocp-Apim-Subscription-Key` header,** never in
  the URL. React Native's constructor takes `options.headers` as a third
  argument, and Azure accepted a key sent that way, from Node (notes, 15:32)
  and from the app on the simulator (notes, 22:16). The plugin's query
  parameter was kept in mind as the fallback, and was not needed.
- **`ProviderDeps` gains the plugin's two names,** `getWebSocket` and
  `newRequestId`. `getWebSocket` returns a constructor typed with that third
  argument, because the DOM's `WebSocket` type does not declare it.
- **Word boundaries are placed by their text** (`core/align.ts`). The service
  sends `Offset`, `Duration` and `text.{Text, Length, BoundaryType}` and no text
  offset (notes, 14:30), and `29.83 dollars` arrives as one boundary. Frames are
  collected until `turn.end`, because boundaries can arrive after their audio.
  - For Chinese, the audio came first.
  - For HD Flash, half the boundaries came with the last audio.
- **The voice list is `GET …/cognitiveservices/voices/list`:** 691 voices,
  575,018 bytes, and never compressed (notes, 14:27).
  - Each is labelled with its `LocalName` and grouped by `Locale`.
  - A voice whose name says `multilingual` or `多语言` goes under `mul`, the
    plugin's rule.
  - Ids containing `:` need nothing, because a voice is held as the pair
    `{ provider, voice }` everywhere.
- **Nothing uses REST.** The connection check lists voices, which Azure
  authenticates, and ADR 0026 keeps synthesis out of connection tests.

## Where Azure gives no timings that can be used

**`MAI-Voice-2` voices send no `audio.metadata` at all,** with
`wordBoundaryEnabled: true` sent as for every voice (notes, 14:37; the plugin's
#73). Their clips carry no timings and are highlighted by Utterance.

**`:DragonLatestNeural` voices pin every boundary after about 9.5 s** to one
offset with zero duration (the plugin's #69, quoted in ADR 0001). Here each
word lights at its `start` (`src/renderer/cursor.ts`). A pinned run would light
the sentence's last word at the pin, and hold it there while the voice goes on.

So the provider looks for the pattern in the data: two or more trailing
boundaries with zero duration at one offset. When it finds it, the provider
returns the clip without timings, with a `note` saying why. It goes by the data
and not by the voice's name, so it switches itself off if Azure fixes the
voices. The plugin passes the tail through, "the fault is Azure's". Here ADR
0005 decides it the other way: a mark in the wrong place is the failure the app
exists to fix.

## Refusals

**What a refusal looks like.** A refused upgrade is a 401 with an empty body
(notes, 14:33). React Native reports a failed socket as a bare `error` and then
a `close` 1006, whose `reason` is SocketRocket's
`Received bad response code from server: N.`. That was read in the source
(notes, 14:45), then measured in the app on the simulator, exactly so, with a
wrong key (notes, 22:27).

**How each status is handled.** The status is parsed from that text:
- 401 → `auth`, naming both the key and the region, since a key used in the
  wrong region is refused with 401 too;
- 403 → `quota`;
- 429, or a close with code 4429 after opening → `rate-limit`;
- 5xx → asked once more after 500 ms, as Speechify and Fish do;
- close 1007 → the voice is not one Azure offers.

**What a rate-limit refusal does.** It waits 1, 2, 4, 8 and 16 s between
attempts, then reports, inside the 60 s `runtime.ts` allows one synthesis.
Nothing is counted or held back before a refusal: F0's documented "20
transactions per 60 seconds" was not enforced when measured (40 in 16 s, notes,
15:32), so a counter would never engage and could not be tested.

**Where no request is made.** Text with no letter or digit is never sent, as in
Fish: Azure answers `*****` with a clean `turn.end` and no audio (the plugin's
#42), and bills whether or not audio comes back. Speakable text that comes back
with no audio is an error, not silence (ADR 0027).

## Turned down

- **REST only.** It has plain statuses, and no word timings.
- **The WebSocket, with REST as a fallback.** It would change the Highlight
  Level silently, request by request, and doubles the code.
- **A REST `checkSynthesis` before synthesis.** The plugin's reason for it,
  Firefox's WebSocket hiding a refusal's status, does not hold where the close
  reason carries the status. ADR 0026 keeps synthesis out of connection tests
  anyway.
- **A client-side limit of 20 requests a minute.** See Refusals.
- **Several sentences, or a chapter in parts, per request.** Deferred with its
  reasons in #40.

## Consequences

- **The protocol is undocumented.** Microsoft documents the SDK only. The one
  published description is the speech-to-text protocol it retired in 2020, and
  it will not support problems with the underlying protocol. The plugin and this
  app now depend on the protocol together, and a change will break both at once.
- **Raw PCM is 48,000 bytes a second,** eight times the plugin's 48 kbit/s MP3.
  OpenAI, Speechify and Kokoro here send the same.
- **`offlineProvider`'s word-timing list in `runtime.ts` names `azure`.**
