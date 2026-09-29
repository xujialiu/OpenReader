---
status: accepted
---

# The operating system's voices arrive as a native module, not through expo-speech

_2026-09-29: not being built for now. The owner judged the phone's voices not
good enough to listen to (design 0058). Everything below still holds for when
they are. The measurements are in `notes/NOTES_2026-09-29.md`, 20:56, 21:13 and
21:25. They cover 193 voices on the owner's iPhone under iOS 27.0, all written by
`write` with markers. `byteSampleOffset` counts bytes of Float32 frames. Eloquence
marks only the first word in zh, ja and ko. Voice identifiers change when the
phone upgrades a voice. The tools are in
`test/manual-test/voices-and-providers/system-voices.md`._

There is no zero-key path in the first working version — it reads through the
remote providers that already exist. The OS voices come next, and when they do
they come through a native module built on
`AVSpeechSynthesizer.write(_:toBufferCallback:toMarkerCallback:)`, **not** through
`expo-speech`.

The product argument is in `docs/design/0014-the-phones-own-voices-come-later.md`.

## Why not expo-speech, which is already there and does work

`expo-speech` does report word boundaries on iOS — `onBoundary({ charIndex,
charLength })`, since early 2023, contrary to the widely repeated claim that it
does not. It would be the cheap answer.

It is the wrong one because it cannot write audio to a file: its native surface is
only speak, stop, pause, resume, list voices and query. It speaks directly rather
than producing a clip to be played, which means it bypasses the audio graph of ADR
0012 entirely, cannot be cached, cannot be pre-synthesized, and delivers word
positions as a stream of events instead of a timing array. Adopting it means
maintaining a second playback architecture that behaves differently from the first
and would eventually be thrown away.

## Why the native module is worth the work

`AVSpeechSynthesizer.write` with a marker callback, available from iOS 16 and so
always available above this project's floor, returns PCM buffers **and**
`AVSpeechSynthesisMarker` values carrying `byteSampleOffset` — a word boundary
locked to an exact audio sample position.

That is the most accurate word timing available anywhere in this project,
including from every paid remote provider. A provider reports the words it
believes it spoke; a marker reports which sample the word starts at. And because
the timings travel with the audio rather than arriving as events, they still line
up after caching, seeking, pausing and replaying.

## Consequences

It is native work on both platforms and should not be bundled into getting the
first version running, which the existing remote providers already cover.

`expo-tts-file` does exactly this and is MIT, but it is weeks old, has one author
and effectively no users. Its value is as a reference implementation — a single
Swift file — to read or vendor, not as a dependency.
