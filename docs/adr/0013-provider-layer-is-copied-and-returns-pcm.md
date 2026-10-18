---
status: accepted
---

# The provider layer is copied, not shared, and returns PCM

The TTS provider layer comes across from the Zotero-TTS plugin as a **copy**, kept
in its own directory that imports nothing from React Native and nothing from the
playback layer. It is not extracted into a shared package that both products
depend on.

Its contract changes: a synthesis result is **raw PCM samples with a sample rate**,
not an encoded audio blob, with a decode path kept as a fallback for providers
that cannot emit PCM.

The product argument is in
`docs/design/0013-provider-support-is-copied-and-asks-for-raw-sound.md`.

## Why copy rather than share

The layer is about 3,000 lines and roughly 95% portable as it stands — its
dependency injection is already complete, and the only Zotero-specific code in
the non-system providers is two functions. Sharing it looks free and is not: the
contract change below is an improvement on mobile and pure cost on the desktop,
where Zotero wants exactly the blob the current contract returns. A shared
package would mean every provider change answering to two runtimes, which would
slow down the plugin that is in daily use to benefit an app that is not yet
written.

The directory discipline — no React Native imports, no playback imports — costs
nothing today and means extracting a package later is a move, not an
archaeological dig. It is enforced by a lint rule rather than a convention, and
the rule is **tested**, so the boundary cannot quietly stop working.

The rule covers **all of `src/core/`**, not only the providers. Scoping it to the
providers alone would have bought nothing: the provider tests reach for
`core/wav` and `core/settings`, so if those could import React Native the
providers would still be unable to run under a plain Node test runner, which is
the whole point.

The provider tests come across with it: about 3,200 lines driven entirely by fake
`fetch` implementations and injected dependencies, which barely mention Zotero.

## Why PCM rather than encoded audio

Three reasons converge on it.

The current contract returns a `Blob`, which cannot survive the port regardless:
React Native's `Blob` constructor does not accept a `Uint8Array`.

The desktop plugin never decoded audio — Zotero's engine did, and it is not
coming with us (ADR 0006). Under ADR 0012 the playback engine wants PCM buffers,
so a decode step would have to be written from nothing.

But it does not have to be written at all, because every provider on the list can
emit raw PCM directly. Asking for PCM deletes the decode step and, at the same
time, deletes the per-clip encoder padding that would otherwise be audible at
every sentence boundary.

The fallback matters though: the OpenAI-compatible provider talks to *any* server
speaking that protocol, including someone's self-hosted one, and none of those can
be assumed to offer PCM. So PCM is the default request and decoding is the path
that catches the rest.

## Consequences

`core/wav.ts` comes across, though nothing in the app calls it. A WAV a
Provider returns is recognised by its `RIFF`/`WAVE` header and handed to the
decoder whole, as `encoded` bytes; the tests and the manual-test kit use the
module to write `.wav` files. `wavDataLength()` walks RIFF chunks instead of
assuming the data starts at offset 44 — it was written that way because macOS's
`say` inserts a 4044-byte `FLLR` pad (#208).

## Amendment (2026-09-25, #65): a 422 is a refusal of the format too

The fallback asked again for MP3 only when the PCM request was refused with a `400`. The owner's Chatterbox server, a FastAPI app, refuses a value outside its `Literal` with a `422`: `{"detail":[{"type":"literal_error","loc":["body","response_format"],"msg":"Input should be 'wav', 'opus' or 'mp3'","input":"pcm"}]}` (notes/NOTES_2026-09-25.md, 14:54). Every sentence failed as "HTTP 422", so the app could not read with that server at all. `speakOnSpeechRoute` now treats `400` and `422` alike (`FORMAT_REFUSALS`); the rest is unchanged: MP3 is asked once, the provider remembers a server that refused PCM only after the MP3 request succeeded, and if MP3 fails too the first refusal is what surfaces. Other statuses still never ask twice.

That memory lived in one Provider object, and a Reading and a Download build a Provider for every sentence they send (`synthesize` in `src/offline/runtime.ts`), so every sentence paid the refusal again: three sentences sent `pcm,mp3,pcm,mp3,pcm,mp3` (#202). It is now one memory for the running app, `sharedPcmRefusals`, kept by Provider id, Address and Model, the arrangement of Fish's `sharedVoiceCache` and Speechify's `sharedQueue`; a test hands in its own. Three sentences send `pcm,mp3,mp3,mp3`, in a Reading and in a Download (`test/offline/pcm-refusal-remembered.test.ts`). It lasts until the app is closed, and another Address or Model is asked for PCM again.

What is learnt reaches only the requests sent after it. The playback engine fetches two Utterances at once, so a Reading opens with two requests out before either refusal is answered, and each pays it: measured on the simulator at 1.0.0 (9)-beta6 against a server refusing `pcm` with FastAPI's 422, a Reading sent `pcm, pcm, mp3 × 6` (`test/manual-test/voices-and-providers/dotted-host-speech-route-pcm-memory-and-notes.md`). A Download with several Sentences at once pays it likewise, once for each request already out. Holding the second request until the first is answered would make it one, but every Reading's start on a server that does PCM, OpenAI's own included, would then wait a whole sentence's synthesis for its second Clip after each launch, to save one refused request; the owner chose on 2026-10-18 to keep the requests concurrent.

`serverReason` also reads FastAPI's error shape, `detail` as a sentence or as a list of `loc`/`msg` entries, with the leading `body`/`query`/`path`/`header` dropped when a field name follows it, so a 422 about something else reads "HTTP 422 — voice: Field required" rather than the status alone. Measured after the change against the same server, with nothing rewritten: the PCM request answered 422, the MP3 request returned `audio/mpeg`, and the clip's note read "the server refused PCM; asked for MP3".

## What is copied is the author's own (2026-10-10, #149)

A copy from the plugin brings its lines into the App Store copy, where AGPL-3.0 alone does not cover code the author does not own: [ADR 0076](0076-a-contribution-is-licensed-once-more-to-the-author.md). So what comes across is the author's own, or was contributed to the plugin under the terms in `CONTRIBUTING.md`. Before copying a file, `git log --format='%an' -- <path>` in the plugin's repository names who wrote it.
