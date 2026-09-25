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
   never called. But do **not** call `suspend()` while a reading is meant to
   continue: a stopped engine under an active playback session is what puts the
   app at risk of being suspended. The owner's pause is the one exception, and
   it must suspend: a real iPhone decides whether the lock screen shows the
   reading as playing from whether the app is still sending audio out, so an
   engine left rendering silence kept the lock screen on Pause for a paused
   reading (#66). `audio-graph.ts` suspends in `pause()` and resumes in
   `resume()`, queued in order, and nowhere else. **And because it is safe, it is silent**: running out of text and
   waiting for a Provider look identical from in here, one of them ends by itself
   and the other never does, and the second was six minutes of silence with the
   app still reporting `playing` (ADR 0023). `onOutOfText` says which it is, on
   `read-ahead.ts`'s four conditions — and carries the count of Utterances that
   were **never spoken**, because a Clip the Provider refused is invisible to all
   four and was announced as the end of the book.
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

## What is here

Two things leave this directory, and `index.ts` exports those two: **the
engine**, which a player screen drives, and **the clock**, which the renderer
(ADR 0005) and the lock screen (ADR 0016) read. Everything else is how those two
are built.

The split is where the platform is, and it is the whole of the test strategy.

| Runs under Node, tested in `test/playback/` | |
| --- | --- |
| `timeline.ts` | The content position as "so far into Utterance 41". ADR 0012's argument, in arithmetic. |
| `rate.ts` | The playback rate, and everything that has to be scaled by it — above all the Word Timings. The stepper of ADR 0020 is here too, on an integer grid. |
| `navigation.ts` | The four skip targets (ADR 0020). Six controls are six ways of naming one Utterance, so each is an index handed to the `seek` that already exists. |
| `read-ahead.ts` | Three Utterances ahead, from the first one not yet queued (#49), two fetches at a time, as one pure function — and the four conditions that tell running out of text from waiting for some, and what a press of Play asks for again (#45). |
| `gap.ts` | The gap timer, which here is silence appended to the Utterance's own buffer. |
| `pcm.ts` | 16-bit little-endian mono into float samples, and the one resampling. |
| `clip-cache.ts` | Provider + Voice + text, and never speed. |
| `clips.ts` | Cache, single-flight, timeout — and where `SynthesisResult` stops being a union. |
| `reader-clock.ts` | The seam: two messages, and deliberately no third. Types only. |

| Needs a device, not tested here | |
| --- | --- |
| `audio-graph.ts` | The session, the node, the buffers. The only file that imports `react-native-audio-api`. |
| `engine.ts` | The order things happen in. Orchestration and no decisions. |

Every decision has been moved out of the two platform files, so what is left in
them is a sequence that needs a real audio device to mean anything.
`test/README.md` is explicit that React Native code and native modules are not
tested in this suite by design, and a fake audio library would only prove that
the fake was called. What *is* tested about them is their source text —
`test/playback/footguns.test.ts` reads the lines that obey each footgun, the same
tool `test/app-config.test.ts` uses on `app.config.ts`, and for the same reason:
each of these fails as something else, so nothing else would notice one being
undone.

One thing was read out of the library's source here that is not in notes/NOTES.md
yet. **The queue node does not resample.** `getCurrentPosition()` divides the
read index by the *context's* sample rate while accumulating each buffer's
duration from that buffer's *own* rate, and `QueueBufferProcessor` is handed the
playback rate and no sample-rate factor at all — so a buffer enqueued at any
other rate both plays at the wrong speed and corrupts the one number the
highlight follows. The context is therefore created at the first Clip's rate.

## Not yet measured

notes/NOTES.md item 4, and it gates UI work rather than following it: a 60–90
minute backgrounded playback session on a real device. The failure modes are all
invisible on a desk — the audio session going inactive between clips, the
Keychain refusing the API key while the screen is locked, the buffer queue
draining.

Two numbers wait on that session. **The output latency**, which is a parameter of
the engine and defaults to zero: the library exposes neither the device's own
latency — 150–200 ms over Bluetooth or AirPlay — nor a usable figure for the
WSOLA stretcher's, and both are constant offsets rather than drift, which is
exactly why one measured number settles them and why ADR 0012's decision does not
depend on it. And **the interval**, one second, which is ADR 0005's correction
cadence but has not been watched against a real highlight.


## Output-driven queue and chapter boundaries (#63)

The source read index proved to be ahead of what WSOLA had actually emitted.
The native dependency patch now pulls the input an output iteration needs and
carries source-coordinate metadata through the same blends as PCM. Both position
corrections and buffer-ended events follow rendered output. Flush padding is
excluded from the content timeline. `test/native-audio/run.sh` compiles the real
patched queue, processor and stretcher for drift/lifecycle regression checks.

A seek creates a fresh queue source inside the existing context and a fresh
callback generation; the timeline resets to zero. An old source's delayed
callbacks cannot move the new reading. Pause retains the source and DSP state.
Removing future buffers for a voice handover rebuilds any already-read lookahead
from the current output coordinate, retaining the portions still wanted.

The engine does not enqueue a new document section across pending old output.
After the preceding output tail ends, it waits 100 ms before the next section.
For the owner's chapter-per-section EPUBs this is the chapter boundary; multiple
Contents entries within one section do not introduce extra resets. Source
starvation also drains and resets its stretcher, without suspending the audio
context. No sentence boundary resets a continuously fed stream.
