# src/core/providers — ADR 0013

A **provider** is a source of synthesized speech reached over the network: a
hosted service, a server on the owner's own machine, or the operating system's
own voices.

This directory is a **copy** of the Zotero-TTS plugin's provider layer, not a
shared package. ADR 0013 says why: sharing looks free and is not, because the
contract change below is an improvement on mobile and pure cost on the desktop,
and a shared package would mean every provider change answering to two
runtimes — slowing down a plugin in daily use to benefit an app that is not yet
written.

## What comes across

About 3,000 lines of TypeScript, roughly 95% portable as it stands, because the
dependency injection is already complete: `createProvider(id, settings, deps)`
takes `{ fetch, getWebSocket, newRequestId, ... }`. The only Zotero-specific
code left in the non-system providers is two functions in `azure.ts`.

With it come about 3,200 lines of provider tests, which barely mention Zotero.
They land in `test/core/providers/`, which is where they already live in the
plugin, so their relative imports need no editing.

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

**A decode path stays as the fallback.** The OpenAI-compatible provider talks to
*any* server speaking that protocol, including someone's self-hosted one, and
none of those can be assumed to offer PCM. PCM is what is requested; decoding
catches the rest. That is why `disableFFmpeg` is `false` in `app.config.ts`.

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
