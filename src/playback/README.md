# src/playback — ADR 0012, ADR 0009

The audio graph. One long-lived `AudioBufferQueueSourceNode` from
`react-native-audio-api`, fed PCM buffers as each utterance is synthesized —
**not** a file player queueing one file per sentence.

Together with the segmenter, this is the bulk of the project (ADR 0006). It does
not exist in the Zotero-TTS plugin: Zotero's own player and playback engine are
roughly 1,900 lines each. ADR 0006 is specific about how they are borrowed —
`zotero/reader` is AGPLv3, so **the behaviour is learned and the code is written
fresh**. Three utterances of read-ahead, two concurrent fetches, a
pitch-preserving time-stretch, a gap timer.

## Why an audio graph, and why this is the load-bearing decision

ADR 0012's reason is not technical taste. The author used ElevenReader and
abandoned it for Speechify because its word highlighting drifted out of sync with
the audio. Drift is the specific defect that made a competitor unusable for this
reader, which is why philosophy rule 2 is "the highlight does not drift".

A file player can only report where it thinks it is, sampled at intervals, with
the position between samples interpolated from the wall clock. Three error
sources all push one way: the playback rate (1.5–3×, and pitch correction adds
its own latency), output latency between the reported position and the sound
reaching the ear (150–200 ms over Bluetooth or AirPlay), and the fact that Apple
explicitly permits the periodic observer to fire less often than requested. The
error accumulates, so a highlight correct at the start of a sentence lags by the
end of it.

An audio graph has nothing to interpolate.

## Take the position from the source node, not from the context

The rule that makes or breaks this directory:

> `AudioContext.currentTime` counts rendered frames over the sample rate — it is
> a wall clock and is **not** scaled by playback rate.

Using it reintroduces exactly the drift this decision exists to avoid, in
proportion to the 1.5–3× the app runs at. The **source node's own content
position** — its read index plus the duration of the buffers already consumed —
already advances at the playback rate, so there is no rate factor to apply and no
wall clock to drift against. That value drives both the highlight cursor
(ADR 0005) and the elapsed time on the lock screen (ADR 0016).

## Speed is applied here and nowhere else (ADR 0009)

A provider is never asked to speak faster. Every clip is synthesized at natural
pace, and the owner's speed is applied here by a **pitch-preserving
time-stretch**, which is native work on both platforms. The decisive reason is
the cache key: provider, voice and text, and deliberately not speed. Put speed
in the key and nudging 1.5× to 1.6× discards every cached clip along with the
quota already spent on it — the owner's own money, under ADR 0002.

Provider timings are reported at 1.0× and must be scaled by the playback rate.

## Footguns read out of the library's source, not its documentation

From notes/NOTES.md. Each fails in a way that looks like something else.

1. **`setAudioSessionOptions` must be given `iosCategory` and `iosMode`
   together.** The JS wrapper substitutes an empty string for whichever is
   omitted, the empty string matches no case and becomes `nil`, `setCategory` is
   called with a nil category, the session never activates, and playback
   silently produces no sound. `{ iosMode: 'spokenAudio' }` alone is enough to
   do it. The documented warning covers incompatible *combinations*, not
   omission.
2. **Pause on a route change of `OldDeviceUnavailable` yourself.** When the
   headphones come out the library rebuilds the engine and keeps playing, so the
   book starts reading itself aloud through the speaker unless the app pauses on
   that event.
3. **A drained buffer queue is safe** — it renders silence, stays in the playing
   state and resumes on the next buffer, as long as `stop()` and `pause()` are
   never called. But do **not** call `suspend()` while backgrounded: a stopped
   engine under an active playback session is what puts the app at risk of being
   suspended.
4. **Never call the library's `PlaybackNotificationManager` on iOS** — see
   [`../now-playing/`](../now-playing/) and ADR 0016. If `show()` is never
   called, the library never claims the command centre, and there is no contest
   over either `MediaPlayer` singleton.

`.spokenAudio` is the correct `AVAudioSession` mode for a reader and is
unreachable through `expo-audio`, which never sets the mode at all. It is
reachable here.

## Memory only

Synthesized audio is cached **in memory**. There is deliberately no disk cache
(ADR 0002): the owner rarely re-listens, so a cache of heard audio has little
value. What a disk cache would really be for is synthesizing a whole book ahead
of time for offline listening, which is a different feature with a different
design and two open questions of its own — what format the samples are stored in
(a ten-hour book is 1.7 GB raw against 108 MB encoded) and where "kept
indefinitely but never backed up" lives, which no JavaScript API on this
platform exposes.

## Not yet measured

notes/NOTES.md item 4, and it gates UI work rather than following it: a 60–90
minute backgrounded playback session on a real device. The failure modes are all
invisible on a desk — the audio session going inactive between clips, the
Keychain refusing the API key while the screen is locked, the buffer queue
draining.
