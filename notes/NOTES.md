# Notes

Measured findings live here, in dated files (`NOTES_YYYY-MM-DD.md`) as in the
Zotero-TTS repo. Decisions live in `docs/adr/`; see ADR 0015 for why both.

Nothing has been built yet. What follows is the list of things assumed but **not
verified**, accumulated while planning on 2026-09-19. Each is cheap to settle and
expensive to get wrong later.

## Verify before writing much code

1. ~~`String.prototype.normalize('NFKC')` on Hermes~~ — **yes.** Measured
   2026-09-19; see `NOTES_2026-09-19.md`.
2. ~~`TextDecoder` on Hermes~~ — **yes.** Same measurement. But `Intl.Segmenter`
   is **absent**, which was not on this list and makes the `unicode-segmenter`
   polyfill mandatory rather than optional.
3. **CFI round-trip against Zotero, both directions.** Take one EPUB. Store a
   position from the desktop plugin and resolve it in an epub.js reader; generate
   a CFI with standard epub.js and hand it to Zotero's `toDisplayedRange`. Record
   not just whether it resolves, but whether it resolves to the *right* text —
   the known failure mode is silently landing on the wrong node. Zotero uses its
   own copy of epub.js, which is why this is in doubt. See ADR 0008.
4. **A 60–90 minute backgrounded playback session on a real device**, before any
   UI work. The failure modes are all invisible on a desk: the audio session
   going inactive between clips, the keychain refusing the API key while the
   screen is locked, the buffer queue draining.
5. ~~Lock-screen support in `react-native-audio-api`~~ — **audited, answered.**
   Insufficient on iOS; see ADR 0016.
6. **Whether the *Piper - Neural TTS* app's system-wide voices emit word
   markers.** If they do, free offline neural voices with word timing cost this
   project nothing at all.
7. **Sentence-splitting quality on real books**, against the constructed cases in
   the plugin's `test/fixtures/` — CJK, Romanian diacritics, angle brackets,
   numbers. Reworded: Hermes has no `Intl.Segmenter`, so what is being judged is
   the polyfill's output, not the platform's. It is the first segmenter, not the
   final one.

## Footguns found while auditing the playback library, before writing any of it

These were read out of the library's source, not its documentation, and each one
fails in a way that looks like something else.

1. **`setAudioSessionOptions` must be given `iosCategory` and `iosMode`
   together.** The JS wrapper substitutes an empty string for whichever one is
   omitted, the empty string matches no case and becomes `nil`, `setCategory` is
   called with a nil category, the session never activates, and playback silently
   produces no sound. Passing `{ iosMode: 'spokenAudio' }` alone is enough to do
   it. The documented warning only covers incompatible *combinations*, not
   omission.
2. **Pause on a route change of `OldDeviceUnavailable` yourself.** When the
   headphones come out the library rebuilds the engine and keeps playing — so the
   book starts reading itself aloud through the speaker unless the app pauses on
   that event.
3. **A drained buffer queue is safe.** It renders silence and stays in the playing
   state, then resumes on the next buffer, as long as `stop()` and `pause()` are
   never called — buffer exhaustion cannot schedule a stop. But do not call
   `suspend()` while backgrounded: a stopped engine under an active playback
   session is what puts the app at risk of being suspended.
4. **Elapsed time on the lock screen is never derived from the graph** — it is
   pushed by the caller on every change, and the reference cadence in the
   library's own example is once a second.
5. The stable version installed is a maintenance branch, not the development
   line. Two notification improvements that landed after it forked are not in it,
   and neither fixes the defect in ADR 0016.
