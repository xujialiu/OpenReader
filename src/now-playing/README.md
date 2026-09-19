# src/now-playing — ADR 0016

The JavaScript side of lock screen, Control Centre and headphone controls.

Its whole job is to route: **on iOS to our own native module**
([`modules/open-reader-now-playing/`](../../modules/open-reader-now-playing/)), and
**on Android to `react-native-audio-api`'s own implementation**, which ADR 0016
calls "the better-built half".

## One owner, and it is ours (on iOS)

The playback library's `PlaybackNotificationManager` is **never called on iOS**.
Not wrapped, not conditionally used — not called.

Calling both is what would break. `addTarget:` is additive, so every button press
would be handled twice, and both writers would fight over the Now Playing info
dictionary with the library re-pinning "paused" each time. The library touches
`MediaPlayer` from exactly one file, instantiated lazily on the first `show()`
call, so **if `show()` is never called the library never claims the command
centre and never writes Now Playing info**. There is no contest over either
singleton, which is what makes this safe rather than invasive.

## Why a module of our own at all

Three defects in the library's iOS layer, read line by line:

- **`MPNowPlayingInfoCenter.playbackState` is pinned to `.paused`.** The public
  API accepts `state: 'playing' | 'paused'`, the library's docs and example app
  pass it, and on iOS it is silently discarded — the value is read from a
  dictionary key nothing ever writes. Android honours the same field correctly.
  Present on the development branch too, and no issue reports it.
- **`togglePlayPauseCommand` is never registered.** That is the command AirPods
  single-tap and most car head units send.
- **`MPNowPlayingInfoPropertyDefaultPlaybackRate` is never written**, which is
  precisely the key a reader running at 1.5–3× needs for iOS to render the rate
  correctly.

The shipped iOS notification code has had no functional change in about five
months, the maintainers list the feature as delivered, and no lock-screen work
appears on any public roadmap. Waiting is not a plan.

## What this layer is responsible for

**Pushing elapsed time.** The lock screen's elapsed time is never derived from
the graph — it is pushed by the caller on every change, and the reference cadence
in the library's own example is once a second. The value pushed is the source
node's content position (ADR 0012), the same clock the highlight follows, so the
lock screen and the highlight cannot disagree.

**Disabling the commands this app does not want.** iOS's library defaults enable
next/previous, which would render dead buttons on a book reader's lock screen; our
module sets `isEnabled = false` on those. Android's `MediaSession` does the
opposite and enables **none** by default, so each one must be turned on
explicitly. Both asymmetries live here.

## Not in core

This imports the platform, so it sits outside `src/core/` and `eslint.config.js`
forbids `core/` from importing it.
