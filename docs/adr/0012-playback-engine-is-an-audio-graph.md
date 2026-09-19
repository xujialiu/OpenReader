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
