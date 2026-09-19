# modules/own-reader-now-playing — ADR 0016

iOS only. Roughly 130 lines of Swift that own `MPRemoteCommandCenter` and
`MPNowPlayingInfoCenter`.

**The Swift is not written yet**, and this directory holds only
`expo-module.config.json`. ADR 0014 makes the same point about the OS-voices
module: native work on both platforms should not be bundled into getting the
first version running. This is where it goes when it is written, and the
directory exists now so that when it is, nothing has to be rearranged.

Why it exists at all, why calling both implementations is the thing that breaks,
and what this module is responsible for are all in
[`src/now-playing/`](../../src/now-playing/) — that is the JavaScript side and
the one place the reasoning lives. Read it first.

## What is missing, in the order it will be added

1. `ios/OwnReaderNowPlaying.podspec` — until this exists, Expo's autolinking
   finds no pod for the `apple` platform declared in `expo-module.config.json`.
   `expo prebuild` tolerates that; `pod install` will not.
2. `ios/OwnReaderNowPlayingModule.swift` — the `OwnReaderNowPlayingModule` named
   in `expo-module.config.json`. An `ExpoModulesCore.Module` that:
   - registers `play`, `pause` and — the one the library forgets —
     `togglePlayPauseCommand`, which is what AirPods single-tap and most car head
     units send;
   - sets `isEnabled = false` on next/previous, which iOS otherwise renders as
     dead buttons on a book reader's lock screen;
   - writes `MPNowPlayingInfoPropertyPlaybackRate` **and**
     `MPNowPlayingInfoPropertyDefaultPlaybackRate`, the latter being the key a
     reader at 1.5–3× needs for iOS to render the rate correctly;
   - sets `MPNowPlayingInfoCenter.default().playbackState` honestly, which is the
     exact thing the library pins to `.paused` and cannot be told otherwise from
     JavaScript;
   - takes elapsed time as a pushed value, not a derived one — the source node's
     content position (ADR 0012), at about once a second.
3. `index.ts` — the typed JS surface, consumed only from
   `src/now-playing/`. Deliberately absent for now: a stub that resolves and does
   nothing would be indistinguishable from a lock screen that is merely broken.

`expo-tts-file` is worth reading before writing any of this. It does the ADR 0014
job rather than this one, is MIT, and is a single Swift file — a reference
implementation to read or vendor, not a dependency: it is weeks old, has one
author and effectively no users.

## Android is deliberately not here

`react-native-audio-api`'s `MediaSession` implementation is the better-built half
and honours playback state correctly. It keeps Android. It does enable **no**
controls by default — the opposite of iOS — so each one is turned on explicitly
from `src/now-playing/`.

## What has been verified about the empty module

With only `expo-module.config.json` present and no podspec and no Swift:

- `npx expo prebuild --platform ios` generates the project and succeeds.
- `pod install` (CocoaPods 1.17.0, 250 pods) succeeds. The module contributes no
  pod — `expo-modules-autolinking search --platform apple` lists it as
  `own-reader-now-playing` with `apple: { modules: ['OwnReaderNowPlayingModule'] }`
  and, unlike every real module, **no `podspecPath`** — and neither prebuild nor
  pod install treats the absence as an error.
- The app builds, installs and runs with it in place (Xcode 27.0, iOS 27.0
  simulator — with the separate UIScene fix described in `src/spike/`).

So an `apple` platform declared with nothing behind it is tolerated rather than
merely untested. That is worth knowing because it also means autolinking will
**not** tell you the Swift is missing: the module simply will not exist at
runtime, and `requireNativeModule('OwnReaderNowPlaying')` will be what throws.
