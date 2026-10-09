# src/core/providers — ADR 0013

A **provider** is a source of synthesized speech reached over the network: a
hosted service, a server on the owner's own machine, or the operating system's
own voices.

This directory is a **copy** of Zotero-OpenReader's provider layer, not a
shared package. ADR 0013 says why: sharing looks free and is not, because the
contract change below is an improvement on mobile and pure cost on the desktop,
and a shared package would mean every provider change answering to two
runtimes — slowing down a plugin in daily use to benefit an app that is not yet
written.

## What comes across

About 3,000 lines of TypeScript, roughly 95% portable as it stands, because the
dependency injection is already complete: `createProvider(id, settings, deps)`
takes the platform as an argument. The only Zotero-specific code in the
non-system providers was two functions in `azure.ts`, `getChromeWebSocket` and
`newRequestId`; they stayed behind when Azure came across, and the app hands in
React Native's `WebSocket` and a request id of its own instead.

With it come about 3,200 lines of provider tests, which barely mention Zotero.
They land in `test/core/providers/`, which is where they already live in the
plugin, so their relative imports need no editing.

### What has landed so far

The OpenAI-compatible client and the three sections built on it (`openai.ts`,
`compatible.ts`), **Azure** (`azure.ts`, `azure-ws.ts`), Speechify, **Fish
Audio**, the local-engine registry with Kokoro-FastAPI, and the factory,
errors, base-URL and audio-bytes pieces they share.

That completes ADR 0005's three providers that report Word Timings over plain
HTTP — Speechify, Fish Audio and a self-hosted Kokoro — and Fish is the only one
of the three that is a cloud service needing no server of the owner's own.

**Azure came with ADR 0037,** and with word timings. ADR 0005 had counted it
out, because `WordBoundary` exists only in the Speech SDK and the SDK does not
run under React Native. The plugin never used the SDK: `azure-ws.ts` speaks the
WebSocket protocol by hand, and with `raw-24khz-16bit-mono-pcm` the same frames
return samples and word boundaries (measured, notes/NOTES_2026-09-22.md, 14:30).
It is the fourth provider with Word Timings, over a WebSocket rather than plain
HTTP, and it reports none for its `MAI-Voice-2` voices, which send no
boundaries at all.

**Not yet:** `cloudflare.ts`, `fishspeech.ts` and `mimo.ts`, which are ordinary
ports that nobody has needed yet; and `system/`, which is not coming at all —
the operating system's own voices are a native module under ADR 0014, not a
member of this layer.

So `ProviderDeps` is `{ fetch, getWebSocket, newRequestId }`. Azure brought the
last two back; `getWebSocket` returns React Native's own constructor, typed with
the request headers it takes as a third argument, which carry the key. Fish was
expected to add `newAbortController` and did not need to, because that
dependency existed only to borrow an `AbortController` from a Zotero chrome
window and this engine has one of its own (measured, notes/NOTES_2026-09-19.md).
Fish's other two injections — the session voice cache and the pause before a
retry — are not platform capabilities: each has a working default inside
`fish.ts`, the way `speechify.ts` keeps its shared serial queue there and
`azure.ts` its pause, and each exists so a test can be fast and isolated without
stubbing a global. A dependency is listed when a provider that needs it exists,
not before.

### The language hint, which came across later

The plugin's `src/core/fish-language-hint.ts` prefixes `[Speak in American
English]` to a Fish request of one to three words, because Fish's language
detection drifts on context-poor text (`100 exp` read as "cn xp"). The first
port left it out for two reasons: it counts words with **`Intl.Segmenter`,
which this Hermes does not have**, so ported as it stood it would have returned
the empty string on every call on the device while passing its tests under Node;
and Fish was not proven to leave the cue unspoken.

It came across with #23 (ADR 0032). The count is written by hand in
`src/core/fish-language-hint.ts`, held to Node's `Intl.Segmenter` by a test for
text with spaces and counting one word per letter in scripts without them; the
names are a table, `src/core/language-names.ts`, held to `Intl.DisplayNames`.
The cue is not spoken (measured, notes/NOTES_2026-09-21.md, 23:45). The locale
is found inside `fish.ts` from the voice — its id's language, or for an `en/…`
or `mul/…` voice the region its listing published — so `SynthesisOptions` still
has its two fields.

Two smaller things went with the contract rather than with Fish.
`ListVoicesOptions` here has no `refresh`, so the plugin's superseded-generation
bookkeeping is gone; and `TTSProvider` has no `voiceListNotices`, so there is no
status line to put "the list may be stale" or "the library's query window cut
this short" in. The plugin answered `[Default]` beside such a line when every
source failed. With no line to answer beside, Fish's `listVoices` **reports**
instead: a refused key rejects at once, a listing that found nothing but its own
`Default` entry rejects with the reason, and a listing where one source worked
returns what that source found. A catalogue of one voice is otherwise
indistinguishable from a server that is down.

The settings these providers read are declared in `factory.ts` as
`ProviderSettings`, by the fields that are actually read. The plugin imported
its whole `Settings` type, which reaches `createZoteroPrefs()`: type-only, so it
erased, but one change to a value import would have pulled XPCOM in here without
the lint boundary noticing.

`core/wav.ts` comes across too, even though the PCM path bypasses most of it:
`wavDataLength()` walks RIFF chunks instead of assuming data starts at offset
44, because macOS's `say` inserts a 4044-byte `FLLR` pad, and it is still needed
to parse the WAV that at least one provider returns while documenting MP3.

## The contract changes: PCM, not a blob

A synthesis result is **raw PCM samples with a sample rate**, not an encoded
audio blob. Three reasons converge:

- The current contract returns a `Blob`, which cannot survive the port anyway —
  React Native's `Blob` constructor does not accept a `Uint8Array`.
- The desktop plugin never decoded audio; Zotero's engine did, and it is not
  coming with us (ADR 0006). The playback engine of ADR 0012 wants PCM buffers,
  so a decode step would have to be written from nothing.
- It does not have to be, because every provider on the list can emit raw PCM —
  which also deletes the per-clip encoder padding that would otherwise be
  audible at every sentence boundary.

**A decode path stays as the fallback**, and two providers now use it. The
OpenAI-compatible provider talks to *any* server speaking that protocol,
including someone's self-hosted one, and none of those can be assumed to offer
PCM. And **Fish Audio cannot report PCM honestly**: its word timings arrive
inside an event stream whose own `Content-Type` is `text/event-stream`, and
nothing in the stream or in Fish's documentation names an output sample rate, so
`pcm` would mean guessing `PCM_SAMPLE_RATE`. A guessed rate is not a decode
error — it is drift, because the playback clock of ADR 0012 is the samples
consumed divided by that rate while Fish's word times arrive in real seconds. So
Fish asks for MP3 and says `encoded`, which is the one answer that cannot put the
highlight somewhere plausible and wrong.

That qualifies ADR 0013's "every provider on the list can emit raw PCM": every
provider on the list can emit *bytes a decoder accepts*, and all but Fish can
emit samples at a rate they will name. PCM is what is requested; decoding catches
the rest. That is why `disableFFmpeg` is `false` in `app.config.ts`.

So `SynthesisResult` is a union of the two, and a provider says which it has:

```ts
| { audio: 'pcm';     samples: Uint8Array; sampleRate: number; timestamps?; note? }
| { audio: 'encoded'; bytes:   Uint8Array; mediaType: string;  timestamps?; note? }
```

`pcm` means **16-bit signed little-endian mono** at `sampleRate` hertz — the
layout `core/wav.ts` writes. Nothing is inferred: a provider asks its server for
PCM wherever the protocol allows it, and reports `encoded` only when what came
back is not samples. `audio.ts` makes that one decision for all of them, from
the server's `Content-Type` and, where a reply carries none (Kokoro's captioned
route answers JSON), from the container signature in the bytes themselves.

The field is still called `audio`, which is deliberate: it was the `Blob`'s name,
so every site that has not been updated fails to compile instead of quietly
type-checking against a string.

## The boundary, and how it is held

> kept in its own directory that imports nothing from React Native and nothing
> from the playback layer

Enforced, not documented: `eslint.config.js` has a `no-restricted-imports`
override scoped to `src/core/providers/**`, and
`test/core/providers/import-boundary.test.ts` lints source text against the real
config and fails if the rule stops firing.

What the rule rejects here, with real messages:

```
src/core/providers/probe.ts
  1:1  error  'react-native' import is restricted from being used by a pattern.
              ADR 0013: the provider layer imports nothing from React Native.
              Inject it (createProvider takes { fetch, getWebSocket, newRequestId, ... }).
              no-restricted-imports
```

The temptation the rule exists to catch is specific: a provider that has just
produced PCM is one `import { AudioContext } from 'react-native-audio-api'`
away from playing it itself.

## Two things a provider never does

**Never asks for a speed** (ADR 0009). Every clip is synthesized at the voice's
natural pace; the owner's 1.5–3× is applied on playback. `SynthesisOptions` has
no speed field, and the cache key is provider, voice and text — deliberately not
speed, because nudging 1.5× to 1.6× would otherwise discard every clip the
owner has already paid for.

**Never estimates a word timing** (ADR 0005, philosophy rule 1). A provider
either reports word timings or does not. One that does not is highlighted at
utterance level. Nothing is interpolated to fill the gap.
