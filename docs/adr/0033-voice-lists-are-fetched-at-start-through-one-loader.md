---
status: accepted
---

# Voice lists are fetched at start through one loader

_The product argument is
[design 0033](../design/0033-voice-lists-are-ready-when-you-open-them.md)._

## Before

`useVoiceLists` held the listing inside its own `ask`: read the credential,
build the Provider, `listVoices` under a 15 s bound, `rememberVoices` into the
catalog. `voice-sheet.tsx` called it when it opened, for the Provider in use,
and when a Provider chip was tapped. `ask` refused while another ask of the same
hook was running (`if (asking) return`), so Providers were asked one after
another, and the rule was written into the sheet's docblock: "the one fetch that
is not a tap … nothing is fetched for the four Providers they are not looking
at". The lists live in memory for the run (`voice-catalog.ts`), so each cold
start began empty; for Fish that is four to five requests (`fish.ts`, the
`FishVoiceCache` docblock) bounded at 11 s.

## After

`src/app/voice-lists.ts` is the listing, as `createVoiceLists(deps)`:

- `load(settings, provider)` keeps one promise per `scope(settings, provider)`
  — the catalog's own key, so a Fish sources change or another self-hosted
  address is another listing — while it is in flight, and every caller gets that
  promise. It remembers the result into the catalog as before;
- `prefetch(settings)` calls `load` for every `enabledProviders(settings)` at
  once and swallows each rejection;
- `asking()` is the set of scopes in flight, a new set on each change, with
  `subscribe` for `useSyncExternalStore`.

`use-voices.ts` builds the one instance with the real credential read and
`createProvider`, and the hook becomes a view of it: `asking(provider)` per
Provider instead of one `asking` value, and `ask` joins a load in flight instead
of refusing. `shell.tsx` calls `voiceLists.prefetch` in a mount effect, once per
process, with the settings `readSettings()` returned synchronously. A return
from the background does not remount the shell, so it fetches nothing.

For Fish the start-up listing also fills the module-level `sharedVoiceCache`,
which is keyed by account and shared by every Fish provider instance — the one
`voiceLocale` reads a voice's published region from (ADR 0032).

## Tested

`test/app/voice-lists.test.ts`: every enabled Provider is asked at once; a load
joined mid-flight sends no second request and is remembered once; a failed
prefetch raises no unhandled rejection and the next `load` asks again and
rejects; listeners hear both edges of a load with a new set each time; a
Provider not enabled is not asked.
