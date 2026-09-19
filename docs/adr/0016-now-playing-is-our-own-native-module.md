---
status: accepted
---

# Now Playing is our own native module on iOS

The lock screen, Control Centre and headphone controls on iOS are driven by a
small native module of our own — roughly 130 lines of Swift — which owns
`MPRemoteCommandCenter` and `MPNowPlayingInfoCenter`. The playback library's
`PlaybackNotificationManager` is **never called on iOS**. Android keeps the
library's implementation.

The product argument is in
`docs/design/0016-the-lock-screen-controls-are-our-own.md`.

## Why, when the library ships one

Its iOS layer was read line by line and has three defects that point straight at
this app:

- **`MPNowPlayingInfoCenter.playbackState` is pinned to `.paused`.** The public
  API accepts a `state: 'playing' | 'paused'` field, the library's own docs and
  example app pass it, and on iOS it is silently discarded: the value is read from
  a dictionary key that nothing ever writes, so an unconditional "paused" is sent
  alongside every metadata update and cannot be changed from JavaScript. Android
  honours the same field correctly. The defect is present on the development
  branch too, and no issue reports it.
- **`togglePlayPauseCommand` is never registered.** That is the command AirPods
  single-tap and most car head units send. It was named "important on ios" in the
  epic that introduced this whole feature and left unchecked when that epic was
  closed.
- **`MPNowPlayingInfoPropertyDefaultPlaybackRate` is never written**, which is
  precisely the key a reader running at 1.5–3× needs for iOS to render the rate
  correctly.

Two commands are unreachable dead code, the shipped iOS notification code has had
no functional change in about five months, and the maintainers list this feature
as delivered with no further lock-screen work on any public roadmap. Waiting is
not a plan.

## Why it is safe rather than invasive

The library touches `MediaPlayer` from exactly one file, and that file is
instantiated lazily on the first `show()` call. **If `show()` is never called, the
library never claims the command centre and never writes Now Playing info** — so
there is no contest over either singleton. Our module owns system media
integration; the library keeps `AVAudioSession` and the audio graph.

Calling both is what would break: `addTarget:` is additive, so every button press
would be handled twice, and both writers would fight over the info dictionary with
the library re-pinning "paused" each time. One owner, and it is ours.

Our module also sets `isEnabled = false` on the commands this app does not want.
The library enables next/previous by default, which would otherwise render dead
buttons on the lock screen of a book reader.

## Consequences

Android is deliberately not replaced. Its `MediaSession` implementation is the
better-built half and honours playback state correctly. It does, however, enable
**no** controls by default — the opposite of iOS — so each one must be turned on
explicitly.
