---
status: accepted
---

# One Voice for every Document

_Issue [#327](https://github.com/xujialiu/OpenReader/issues/327). The owner's
decisions of 2026-10-26 are in its plan comment. The product argument is
[design 0089](../design/0089-one-voice-for-every-document.md)._

This supersedes [ADR 0010](0010-voice-is-per-document.md) and the parts of
[ADR 0026](0026-a-coherent-reading-interface.md) that keep a Voice per Document
and give a new Document the most recent Voice whose Provider is still enabled.

The app has one Voice: `AppSettings.provider` and `AppSettings.voice`, the pair
most recently chosen. Every Document is read in it, and choosing a Voice anywhere
changes it for every Document. This is the desktop plugin's model ("One voice and
speed everywhere"), which ADR 0010 departed from.

## Why ADR 0010 is reversed

ADR 0010 bound the Voice to the Document so that changing the Voice would not
leave paid-for audio unused. In use, the cost ran the other way: a Voice chosen in
one Document never reached a Document already opened, so a new Voice had to be
chosen again in every book on the shelf. Speed and the Fish Audio Model were
already one setting for the app; the Voice was the only reading setting kept per
Document.

Two of ADR 0010's costs are accepted as they are:

- **Offline Narration in another Voice is used only after switching back to it.**
  Saved audio is filed under the Voice that spoke it (ADR 0027), so after a
  change the Reading fetches from the Provider again and the Downloaded checks
  follow the new Voice. Nothing is deleted. `Switch voice` in the Download
  drawer is the way back ([#329](https://github.com/xujialiu/OpenReader/issues/329)).
  A Document with a Download does not keep its downloaded Voice: that would
  bring the per-Document Voice back.
- **A shelf with Documents in different languages shares the one Voice.** A
  Voice per language stays out of scope, for ADR 0010's reason: it would mean
  the language detector ADR 0006 avoided.

## When the Voice's Provider is disabled

The Voice stays. Nothing substitutes another Provider's. This is what a
Document's remembered Voice did under ADR 0026, now for the one Voice:

- Saved audio plays without the Provider, its key or a network
  (`synthesize` in `src/offline/runtime.ts` looks for a saved Clip first,
  design 0027).
- The engine stops exactly at the first Utterance with no saved Clip
  (`drain` in `src/playback/engine.ts`, "Never skip missing content"), and the
  refusal, `<Provider> is disabled. Choose an enabled provider.`
  (`readinessSentence`), is the Player's note.
- Play in a Document with nothing saved in the Voice opens the Voice drawer
  (`reading-view.tsx`'s `onPlay`).
- A Download started in that Voice while the device is online stops at
  `Needs attention` with the same sentence (`scheduler.ts`, `no-key` is in
  `STOPS_ALL`).

The rejected alternative was ADR 0026's rule for a new Document, the most recent
Voice whose Provider is still enabled, applied to the app. It would change who
reads without being asked, spend on another Provider without the owner choosing
it, and leave a disabled Provider's saved audio unplayable until it was enabled
again. So `recentVoices` and `recentEnabledVoice` are gone.

## How it is built

- **`settings.ts`.** `selectVoice` sets the pair, and only for an enabled
  Provider, as the Voice drawer offers only those. `selectSavedVoice` sets it
  for any Provider: it is the Download drawer's `Switch voice`, whose menu
  lists the Voices a Document has saved audio in, a disabled Provider's
  included (#329; it replaced a "Use downloaded voice" row per Voice under the
  chapter list, which took a chapter row for every Voice saved).
  `settingsForDocument`, `unusableVoiceSentence`, `DocumentVoice` and
  `recentVoices` are removed; `settings-storage.ts` no longer reads or writes
  `recentVoices`, and an older `settings.json` that has it is read past.
- **`reading-host.tsx`.** The Reading is handed the owner's settings. The
  inheritance effect and the per-Document substitution are gone, and so is
  `voiceNote`. `ReadingHandle.chooseVoice(provider, voice)` is the one way a
  Voice chosen away from the Voice drawer reaches the Reading. For an enabled
  Provider it goes through the mounted `ReadingView`'s own `chooseVoice`, which
  the view hands the host through `onVoiceChooser` while it is mounted, so a
  playing Reading, held behind the Library or on screen, is handed over as the
  Voice drawer hands one over (ADR 0026): the old Voice reads on until the new
  one is ready, and a failure keeps the old one and says why. A paused Reading
  takes the choice at once through the same path. For a disabled Provider, or
  with no Reading mounted, it writes the settings straight away. A disabled
  Provider's Voice cannot be prepared ahead of the place, so a handover would
  fail and the choice would be dropped. Writing it changes `engineIdentity`,
  which disposes the engine, so a playing Reading stops, as disabling its
  Provider would.
- **`reader-actions.tsx`.** The Download drawer shows and downloads in the one
  Voice. Its `onVoice` is `reading.chooseVoice`. The `onStart` that wrote the
  Voice into a Document's entry when a Download started is gone.
- **The Library file.** `LibraryEntry.voice`, `VoiceChoice`, `parseVoice` and
  `useLibrary.voiced` are removed, and an entry is written without `voice`.
  The key stays known (`RETIRED_ENTRY_KEYS` in `core/document/library.ts`).
  `parseLibrary` reports every unknown key in `ignored`, and a non-empty
  `ignored` freezes the Library: `assertLibraryWritable` refuses every write,
  and `use-library.ts` tells the owner the file carries things this version
  does not understand. Dropping `voice` from the known keys would have done
  that on every device that updates. So `voice` is read past, with its contents
  unchecked, and the first write leaves it out. An older build reads an entry
  without `voice` as `null`, through its own `parseVoice`, without a problem.
  `LIBRARY_VERSION` stays 2.
- **The Debug Log.** The harness `shelf` line no longer prints `voice=` per
  entry; `{"do":"saysettings"}` prints the Voice.

## Consequences

- On updating, every Document is read in the pair `settings.json` holds, the
  last Voice chosen while its Provider was enabled, even if that Provider has
  been disabled since. What each Document remembered is dropped from the Library
  file at its first write.
- A Voice chosen from saved audio while its Provider is disabled is the one
  Voice too. The Voice drawer, which lists only enabled Providers, does not
  show it until its Provider is enabled again.
- A Clip's cache identity is unchanged: Provider, Voice and text, not speed
  (ADR 0009), and for Fish Audio the Model (ADR 0078).
