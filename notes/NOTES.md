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
6. **`pitchCorrection: true` must be passed when the source node is created**, or
   `playbackRate` is a resampler. The WSOLA time-stretch ADR 0009 requires is in
   the library — `common/cpp/audioapi/dsp/WsolaTimeStretcher.{h,cpp}`, native on
   both platforms — but it is opt-in per node:
   `pitchCorrection_(options.pitchCorrection)`, with the source's own comment
   "late init to avoid unnecessary allocation when pitch correction is not used".
   Omitting it raises no error and changes no API; the book is simply read in a
   rising voice, which sounds like a bad provider or a wrong sample rate rather
   than like a missing flag. `createBufferQueueSource({ pitchCorrection: true })`.
   `WsolaTimeStretcher::MAX_PLAYBACK_RATE` is 4, so the app's 1.5–3× is in range
   and clamping is not a concern.
7. **The queue node mixes two sample-rate bases in its own position, and the
   clock is the casualty.** Read from `AudioBufferQueueSourceNode.cpp`:
   `vReadIndex_` is *seeded* from the buffer's own rate (line 68,
   `buffers_.front().second->getSampleRate() * offset`) and then *divided* by
   the context's (line 156, `sampleFrameToTime(vReadIndex_,
   getContextSampleRate())`), while the other term, `playedBuffersDuration_`,
   accumulates `size_ / getSampleRate()` — the buffer's rate again
   (`utils/AudioBuffer.hpp:113`). The single-buffer `AudioBufferSourceNode`
   beside it does the same calculation consistently, against
   `buffer_->getSampleRate()` (line 119), which is what makes this look like an
   oversight rather than a convention.

   It is invisible whenever a buffer's rate equals the context's, and it
   corrupts **the one number ADR 0012 rests everything on** when they differ —
   a 24 kHz Clip in a 48 kHz context also plays at double speed, because nothing
   in the queue path resamples. So the `AudioContext` is created at the first
   Clip's own rate rather than the hardware's, and a later Clip that disagrees
   is resampled before it is enqueued.
8. **`pitchCorrection: true` makes the node play content nobody enqueued.** The
   host object builds a ~30 ms tail buffer on the first `enqueueBuffer`, and on
   every drain appends it *instead of* ending the last buffer — which also
   suppresses that `onBufferEnded` until the tail has been consumed. Anything
   deriving an Utterance boundary from buffer-end events, or summing enqueued
   durations without absorbing the excess, drifts by 30 ms per drain.
9. **`getLatency()` is the time-stretcher's latency, not the output device's.**
   It is built from the WSOLA constants (`INPUT_LATENCY_MS = 20`,
   `OUTPUT_LATENCY_MS = 10`) with a rate factor that matches neither unit
   derivation, so it answers a question nobody asked. The 150–200 ms of a
   Bluetooth route that ADR 0012 names is not exposed anywhere. Both are
   constant offsets rather than drift, so the highlight takes one latency
   parameter and the device session supplies it.
