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

## Why not the obvious choice

`expo-audio` is the default in an Expo app, needs no extra native dependency, and
its lock-screen support is verifiable line by line in the SDK 57 Swift sources.
It was still rejected, and the reason is not technical taste — it is first-hand
product experience. **The author used ElevenReader and abandoned it for Speechify
because its word highlighting drifted out of sync with the audio.** Drift is not
a detail to be traded away here; it is the specific defect that made a competitor
unusable for this reader.

A file player can only report where it thinks it is, sampled at intervals, with
the position between samples interpolated from the wall clock. Three error
sources in that interpolation all push one way: the playback rate (this app runs
at 1.5–3×, and pitch correction adds its own latency), output latency between the
reported position and the sound actually reaching the ear (150–200 ms over
Bluetooth or AirPlay), and the fact that Apple explicitly permits the periodic
observer to fire less often than requested. The error accumulates, so a highlight
that is correct at the start of a sentence lags by the end of it.

An audio graph has nothing to interpolate: `AudioContext.currentTime` is the
hardware sample clock. The drift does not need mitigating because it does not
exist.

Gapless playback comes with it. A file player must contend with per-clip encoder
padding — 576 samples for LAME MP3, 2112 for Apple's AAC, and TTS providers do
not emit gapless metadata — which is audible at every sentence boundary and is
only avoidable by paying for uncompressed WAV clips. A buffer queue never changes
files, so there is no seam to remove.

## Consequences

The cost is system integration, and it is the reverse trade: `expo-audio` gets
lock-screen controls, Now Playing metadata, headphone controls and CarPlay for
free because it *is* the system player, while `react-native-audio-api` ships a
`PlaybackNotificationManager` that is younger and less verified. Whether it
suffices is being checked; the answer does not change this decision, because
lock-screen integration is separable.

**That separability is the reason this choice is safe.**
`MPRemoteCommandCenter.shared()` and `MPNowPlayingInfoCenter.default()` are
global singletons, independent of whatever renders the audio. If the built-in
support falls short, a small supplementary native module can own the command
centre and the Now Playing metadata alongside the audio graph, without modifying
the library or waiting upstream. Bounded work, not a dependency on someone else.

In exchange the graph also exposes `AVAudioSession`'s mode, so `.spokenAudio` —
the correct mode for a reader, and unreachable through `expo-audio`, which never
sets the mode at all — is available.
