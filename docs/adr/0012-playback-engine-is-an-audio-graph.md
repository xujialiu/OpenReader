---
status: accepted
---

# Playback is an audio graph, not a file player

Audio plays through `react-native-audio-api`'s `AudioBufferQueueSourceNode` — one
long-lived node fed PCM buffers as each sentence is synthesized — rather than
through `expo-audio`'s `AudioPlaylist`, which queues one file per sentence in an
`AVQueuePlayer`.

`react-native-track-player` was never in contention: v4 has been unmaintained
since August 2025 and the maintainer has said so, v5 is a different, commercial
package at €99 a month, and neither ships an Expo config plugin.

The product argument is in `docs/design/0012-the-highlight-must-never-drift.md`.

## Why not the obvious choice

`expo-audio` is the default in an Expo app, needs no extra native dependency, and
its lock-screen support is verifiable line by line in the SDK 57 Swift sources.
It was still rejected, and not on technical taste. ADR 0005 makes word-level sync
a requirement rather than a stretch goal, which fixes the acceptable drift at well
under 100 ms for the length of a book; the design file records the product history
that made it non-negotiable. What follows is why a file player cannot hold that
budget.

A file player can only report where it thinks it is, sampled at intervals, with
the position between samples interpolated from the wall clock. Three error
sources in that interpolation all push one way: the playback rate (this app runs
at 1.5–3×, and pitch correction adds its own latency), output latency between the
reported position and the sound actually reaching the ear (150–200 ms over
Bluetooth or AirPlay), and the fact that Apple explicitly permits the periodic
observer to fire less often than requested. The error accumulates, so a highlight
that is correct at the start of a sentence lags by the end of it.

An audio graph has nothing to interpolate: the source node reports the position
**within the content it has played**, computed from its own read index plus the
duration of the buffers already consumed. That value already advances at the
playback rate, so there is no rate factor to apply and no wall clock to drift
against.

**Take the position from the source node, not from the context.**
`AudioContext.currentTime` counts rendered frames over the sample rate — it is a
wall clock and is **not** scaled by playback rate, so using it to drive
highlighting reintroduces exactly the drift this decision exists to avoid, in
proportion to the 1.5–3× the app actually runs at. The node's own position
callback is the correct source for both the highlight cursor and the elapsed time
shown on the lock screen.

Gapless playback comes with it. A file player must contend with per-clip encoder
padding — 576 samples for LAME MP3, 2112 for Apple's AAC, and TTS providers do
not emit gapless metadata — which is audible at every sentence boundary and is
only avoidable by paying for uncompressed WAV clips. A buffer queue never changes
files, so there is no seam to remove.

## Consequences

The cost is system integration, and it is the reverse trade: `expo-audio` gets
lock-screen controls, Now Playing metadata, headphone controls and CarPlay for
free because it *is* the system player. The audio graph's own lock-screen layer
was audited and is not sufficient — see ADR 0016, which is the supplementary
module that answers it. That was foreseeable and does not weaken this decision,
because lock-screen integration turned out to be genuinely separable.

In exchange the graph exposes `AVAudioSession`'s mode, so `.spokenAudio` — the
correct mode for a reader, and unreachable through `expo-audio`, which never sets
the mode at all — is available.

The engine half of this choice has a real-world confirmation rather than only a
maintainer's endorsement: a reported defect where this node played at roughly 3×
with heavy static on iOS was raised by someone streaming 24 kHz PCM chunks from a
TTS service into it — this app's architecture almost exactly — traced to a race
between the audio thread pool and the JavaScript thread, and fixed in 0.13.0.
The version adopted here is later than that fix, and the reporter confirmed it
clean on a physical device.


## The output clock replaces the input cursor (#63)

The owner approved the output-driven design after the complete-chapter and
35-repetition experiment recorded in the 2026-09-25 engineering log. The graph
remains, but its original claim that the read index was already an audible
position was false: 0.13.5 supplied `ceil(rate * 128)` frames every render quantum.
At 1.55× that was 199 frames for 198.4 of demand. Dax chapter 179 led its waveform
by 94.5 / 379.9 / 657.5 ms near the start / middle / end. The excess accumulated
inside WSOLA, and `clearBuffers()` did not clear that state. A seek therefore
retained the growing lead while reconstructing the player removed it.

`patches/react-native-audio-api+0.13.5.patch` gives the queue an output-driven
stretcher. It requests only missing input, using reusable scratch storage.
Source coordinates are blended with the same window coefficients as PCM and
reported when output leaves the stretcher. `onBufferEnded` is delayed to the
output boundary too: changing only the position callback would still cue the
next sentence before it was heard. The overlap blends multiple source locations,
so this is a weighted coordinate, not a claim that every output sample has one
unique original location. The measured source span and waveform error are in the
engineering log.

At a real queue drain, zeros supply lookahead without adding content duration.
Completion waits until buffered output, pending overlap and future search
windows contain no coordinates preceding the content endpoint. The implementation
therefore verifies the tail is finished rather than relying on the prototype's
50 ms source-position margin. The context stays active; a natural drain does not
call `suspend()` or stop the source. A temporary starvation is the same lifecycle,
and content arriving during the flush waits for its reset.

The old host-created tail was `(INPUT_LATENCY_MS + OUTPUT_LATENCY_MS) * sampleRate`
— 30 ms — and entered `playedBuffersDuration_` without the app enqueuing it.
The old timeline absorbed that excess; the output-driven path no longer queues
this tail, so padding never advances the content anchor. That absorption was
removed. A seek creates a new source within the context, rejects retired-source
callbacks by generation and resets the timeline to zero. Pause keeps the source.
Native explicit clearing likewise discards stretcher state and pending end events.

The owner's pause is the one place the context is suspended, and Play resumes
it (#66). A real iPhone infers the lock screen's playing state from whether the
app is sending audio out, so a context left rendering silence kept a paused
reading on Pause there. `suspend()` stops the `AVAudioEngine` and leaves the
audio session active; after it, a source's `start` no longer starts the driver
(`AudioContext::start` returns early once initialised), so `resume()` is called
explicitly. The library runs both on a thread pool, unordered, so
`audio-graph.ts` queues them. A drain, a seek and a starvation still never
suspend, for the reason above.

Future buffers remain referenced until they reach output. If a voice change
removes already-read content, the queue reconstructs retained input starting at
the current output coordinate, resetting only the discarded lookahead. This is
needed because removing a buffer from the input list alone cannot remove samples
already inside the stretcher. Native regressions cover both partially and fully
pre-read removals, pause/resume, starvation, final endpoints and rate changes.

`use-reading` supplies section identity lazily. The engine waits for all output
from one section, then inserts a 100 ms boundary pause before allowing another.
This applies to EPUB spine boundaries, including the owner's chapter-per-spine
books; multiple navigation entries inside one spine item are not separate drain
points. Recreating a graph at every sentence was rejected because it introduces
unnecessary speech seams. A fixed highlight delay was rejected because it cannot
remove a growing backlog. Chapter isolation supplements correct sample accounting;
it is not a substitute for it.

Verification compiles the actual queue/stretcher C++ with host-only graph,
scheduling and event adapters. Full real chapter output and the 35-repetition
native run retain waveform alignment; iOS integration is verified separately.
Bluetooth output latency and provider alignment accuracy are not established by
a native host waveform test.
