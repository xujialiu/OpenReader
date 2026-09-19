# modules/open-reader-now-playing — ADR 0016

iOS only. Roughly 130 lines of Swift that own `MPRemoteCommandCenter` and
`MPNowPlayingInfoCenter`.

Why it exists at all, why calling both implementations is the thing that breaks,
and what this module is responsible for are all in
[`src/now-playing/`](../../src/now-playing/) — that is the JavaScript side and
the one place the reasoning lives. Read it first.

## What is here

1. `ios/OpenReaderNowPlaying.podspec` — and it has to be **exactly one directory
   deep**. `expo-modules-autolinking`'s `listFilesInDirectories` reads the
   module's first-level directories and lists the files in each, so a podspec at
   this directory's root is invisible to Expo while the React Native CLI still
   finds it: `pod install` succeeds, the Swift compiles, and
   `ExpoModulesProvider.swift` never imports the class. Its `s.name` must equal
   its own basename, because `scripts/ios/package.rb` re-derives the path from
   the pod name. Its `:ios` floor is **16.4 and not ADR 0001's 17.2**, because a
   pod whose minimum exceeds the app's deployment target is skipped with a
   *warning* and the app then runs with no lock screen — see ADR 0016.
2. `ios/OpenReaderNowPlayingModule.swift` — the `OpenReaderNowPlayingModule`
   named in `expo-module.config.json`. An `ExpoModulesCore.Module` that:
   - registers `play`, `pause` and — the one the library forgets —
     `togglePlayPauseCommand`, which is what AirPods single-tap and most car head
     units send;
   - sets `isEnabled = false` on the seven the library enables and this app
     cannot answer, which iOS otherwise renders as dead buttons on a book
     reader's lock screen;
   - writes `MPNowPlayingInfoPropertyPlaybackRate` **and**
     `MPNowPlayingInfoPropertyDefaultPlaybackRate`, the latter being the key a
     reader at 1.5–3× needs for iOS to render the rate correctly;
   - sets `MPNowPlayingInfoCenter.default().playbackState` honestly, which is the
     exact thing the library pins to `.paused` and cannot be told otherwise from
     JavaScript;
   - takes elapsed time as a pushed value, not a derived one — the source node's
     content position (ADR 0012), at about once a second;
   - publishes **no** `MPMediaItemPropertyPlaybackDuration`, because a book
     synthesized a sentence at a time has no known total and inventing one is the
     estimate philosophy rule 1 forbids. iOS therefore draws no scrub bar.
3. `index.ts` — the typed JS surface, consumed only from `src/now-playing/`. It
   uses `requireNativeModule` and not the optional form: the optional one hands
   back `undefined`, every call becomes a no-op, and a lock screen that does
   nothing looks exactly like one that is merely broken.

`expo-tts-file` is worth reading before extending any of this. It does the
ADR 0014 job rather than this one, is MIT, and is a single Swift file — a
reference implementation to read or vendor, not a dependency: it is weeks old,
has one author and effectively no users.

## Two SDK 57 facts that each cost a compile

- **`Events("remoteCommand")` is not optional.** `sendEvent` is delivered only to
  holders whose definition lists the name (`LegacyEventEmitterCompat.swift`), so
  an undeclared event is dropped **with no warning at all**.
- **`NativeModule<T>` cannot be extended.** In SDK 57 it is
  `typeof ExpoGlobal.NativeModule<EventsMap>` — the *constructor* type, with the
  events map discarded — so an interface extending it has no `addListener`, and
  the error says so several lines from anything about inheritance. `index.ts`
  declares its three calls and its one listener directly.

## Android is deliberately not here

`react-native-audio-api`'s `MediaSession` implementation is the better-built half
and honours playback state correctly. It keeps Android. It does enable **no**
controls by default — the opposite of iOS — so each one is turned on explicitly
from `src/now-playing/`.

## What has been verified about the module

On 2026-09-20, with the podspec and the Swift in place: `npx expo prebuild
--platform ios` and `pod install` succeed, `ios/Podfile.lock` carries
`OpenReaderNowPlaying (from ../modules/open-reader-now-playing/ios)`, the
generated `ExpoModulesProvider.swift` holds `internal import OpenReaderNowPlaying`
and `(module: OpenReaderNowPlayingModule.self, name: nil)`, and the app builds,
installs and runs. The lock-screen behaviour that followed is in
`notes/NOTES_2026-09-20.md`.

Earlier, with only `expo-module.config.json` present and no podspec and no Swift:

- `npx expo prebuild --platform ios` generates the project and succeeds.
- `pod install` (CocoaPods 1.17.0, 250 pods) succeeds. The module contributes no
  pod — `expo-modules-autolinking search --platform apple` lists it as
  `open-reader-now-playing` with `apple: { modules: ['OpenReaderNowPlayingModule'] }`
  and, unlike every real module, **no `podspecPath`** — and neither prebuild nor
  pod install treats the absence as an error.
- The app builds, installs and runs with it in place (Xcode 27.0, iOS 27.0
  simulator — with the separate UIScene fix of ADR 0018, without which no build
  of this app launches at all).

All of it was measured before the app was renamed, under this directory's old
name `own-reader-now-playing` and the module name `OwnReaderNowPlayingModule`.
The names above are the current ones; nothing else about the runs differs, and
no part of what was checked depends on the spelling.

So an `apple` platform declared with nothing behind it is tolerated rather than
merely untested. That is worth knowing because it also means autolinking will
**not** tell you the Swift is missing: the module simply will not exist at
runtime, and `requireNativeModule('OpenReaderNowPlaying')` will be what throws.
