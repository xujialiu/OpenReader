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

**Re-read line by line against the installed 0.13.5 before the Swift was written,
2026-09-20, and all three still hold.**
`ios/audioapi/ios/system/notification/PlaybackNotification.mm` sets
`_currentInfo[key]` only inside `for (NSString *key in info)` guarded by
`keyMap[key]`, and its `NOW_PLAYING_INFO_KEYS` maps seven names of which `state`
is not one — so `_currentInfo[@"state"]` is never written, `state` is always nil,
and `playbackState` is assigned `MPNowPlayingPlaybackStatePaused`
unconditionally. `togglePlayPauseCommand` appears nowhere in the file, in neither
`enableRemoteCommand:` nor `cleanup`. `MPNowPlayingInfoPropertyDefaultPlaybackRate`
appears nowhere either; `speed` maps to `MPNowPlayingInfoPropertyPlaybackRate`
alone.

Two things sharpen rather than change the argument. The claim above was that the
library "enables next/previous by default"; it enables **seven** commands in
`initializeWithOptions:` — play, pause, nextTrack, previousTrack, skipForward and
skipBackward at 15 s, and `seekTo` as `changePlaybackPositionCommand`. On a book
reader with no published duration, a scrubber that cannot work is worse than a
dead button. And the two unreachable commands are `seekForward` and
`seekBackward`: `enableRemoteCommand:` has branches for them that
`enableControl:`'s `validControls` set can never reach.

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

## What the module does, and the one thing it deliberately does not publish

`modules/open-reader-now-playing/ios/OpenReaderNowPlayingModule.swift` registers
`play`, `pause` and `togglePlayPause`, sets `isEnabled = false` on the other
seven, writes both rate keys and sets `playbackState` from the caller's own
value. Its JavaScript surface is three calls and one event: `show(reading)`,
`setPosition(seconds)`, `hide()`, and `remoteCommand`. Since #119 it also writes
the artwork; see below.

**On a real iPhone, whether the lock screen shows the reading as playing is not
what this module writes.** Measured 2026-09-25 on an iPhone 16 Pro, iOS 27.0
(#66): `mediaremoted` logged the state as **inferred** — `setting inferred
playback state from <Paused> to <Playing>` when the audio engine started — and no
`setting playback state` line, the one the explicit `playbackState` write
produces on the simulator, appeared at all. A pause that published a rate of 0
while the engine went on rendering silence left the state Playing for as long as
the reading stayed paused, so the card offered Pause for a paused reading. The
simulator follows the explicit value instead, which is why it never showed this.
What the device follows is whether the app is sending audio out, so the owner's
pause now suspends the `AudioContext` and Play resumes it (ADR 0012); the rate
and `playbackState` are still written, and the simulator and macOS read them.

## The picture is the Cover, or the app's icon (#119)

`MPMediaItemPropertyArtwork` is the square to the left of the title on the Lock
Screen, in the Dynamic Island's compact view and in Control Centre; one key fills
all of them. Until #119 it was never written, and iOS drew an empty grey square in
its place (the owner's iPhone, 2026-10-01 14:26 and 14:29).

The reader passes the open Document's Cover as the record's `cover` field: the
`file://` URI `src/app/document-cover.ts` caches for the Library, or the empty
string when the Document declares none. `useNowPlaying` shows nothing while that
lookup is still running (`undefined`, as against `null` for none), so a Document
with a Cover never shows the icon first.

`NowPlayingPicture` builds the artwork once per Cover, in `show` on the
JavaScript thread, and the main queue only swaps it in. `publish` never builds
one: `setPosition` publishes once a second, and a new `MPMediaItemArtwork` each
time would have iOS ask for the picture each time. A Cover is drawn whole and
centred on a black square at most 1024 px a side; the owner chose the whole
Cover over a square cut from it.

The sides were transparent at first (`opaque = false`), and iOS does not show
what is behind a transparent artwork: it fills it with a backdrop of its own.
The Dynamic Island's compact view on the owner's iPhone 16 Pro drew both side
bands pure white, (255, 255, 255), against the Island's black; the simulator's
Lock Screen card drew them (238, 238, 238) in light and dark mode alike, not the
wallpaper. The one artwork serves every place, and whether iOS asks a
`requestHandler` for a different size per place was not measured, so a
size-dependent picture was not attempted. The owner chose black everywhere,
the Island's own colour: the square is drawn `opaque = true` and filled black
before the Cover is drawn on it.
A Cover UIKit cannot decode falls back to the icon, as an unreadable Cover is no
Cover in the Library.

**The icon is never loaded from the app icon set.** The compiled asset catalog
holds a 1024 px `Icon Image` rendition of `ios.icon` per appearance, under the
bundle's `CFBundleIconName`, and the first build loaded the default one with
`UIImage(named: "OpenReader", in: .main, compatibleWith:)` and a light trait
collection. That call does not return nil: it raises
`NSInternalInconsistencyException` from `-[_UIImageCGImageContent
initWithCGImageSource:CGImage:scale:]` (`_UIImageContent.m:742`), Swift cannot
catch it, and the first `show` for a Document without a Cover threw in
JavaScript and unmounted the reader (iOS 27.0 simulator, pinned under LLDB,
2026-10-01; light and dark mode alike). So `plugins/with-now-playing-icon.ts`
copies `assets/icon/icon.png` — the default appearance's white fill under the
icon's two layers, written from `OpenReader.icon` — into the catalog as the
plain image set `NowPlayingIcon`, which `UIImage(named:)` loads like any other,
and the icon goes through the same squaring as a Cover. The owner chose the
default appearance whatever the phone's: the app cannot read the Home Screen's
icon setting, and dark mode alone would only guess at it. The measurements are
in `notes/NOTES_2026-10-01.md`.

**`MPMediaItemPropertyPlaybackDuration` is never written.** A book is synthesized
a sentence at a time and only the sections the renderer has reported are even
known, so any total would be an estimate — which is the one thing this project
does not do (philosophy rule 1, ADR 0005). There is no duration along which a
scrubber could seek, so `changePlaybackPositionCommand` remains disabled.
The earlier claim that iOS draws no scrub bar was corrected by the literal
lock-screen screenshot on 2026-09-20 at 14:36: iOS 27.0 (24A434) draws a disabled
time strip with `--:--` at both ends. Absence of duration does not guarantee
absence of that strip; see the engineering log for the separate invisible-icon
measurement.

The owner subsequently reported that the lock-screen controls display normally
on a physical iPhone (2026-09-20). The missing-icon reproduction is confined to
the simulator environments measured so far; the report did not include the
phone model or OS version. We retain this integration rather than changing app
behaviour to compensate for the simulator's missing animation resources. The
observations and their limits are in the day's engineering log.

The elapsed time is the source node's **content position** (ADR 0012), pushed at
`POSITION_INTERVAL_MS` — the same value, on the same cadence, that corrects the
highlight. Between pushes iOS extrapolates as `elapsed + rate x dt`, which is
exactly how a content position advances, so `MPNowPlayingInfoPropertyPlaybackRate`
carries the owner's reading speed rather than 1 and the system's arithmetic and
the graph's agree instead of diverging by the 1.5–3x the app runs at. Measured:
SpringBoard reported `CalculatedPlaybackPosition: 1.518854/PlaybackRate:
1.500000` for the item titled 仙逆 on the player path
`top.xujialiu.openreader (47871) OpenReader`.

A remote press does not call the engine. It is resolved into a play or a pause by
`intentOf` and handed to the **same** handler the on-screen button calls,
including the coupling that a pause re-opens the player — which is why that
coupling moved out of `player.tsx` and into `reading-view.tsx`. Two paths into
one transport is how the lock screen and the screen start to disagree.

## The podspec's iOS floor is 16.4 and not ADR 0001's 17.2

Expo's autolinking skips a pod whose own minimum exceeds the app's deployment
target, and it skips it with `UI.warn "[Expo] … was not linked"` in a prebuild
that prints hundreds of lines
(`expo-modules-autolinking/scripts/ios/autolinking_manager.rb`, via
`supports_platform?` and `platform_skip_reason`). The app then builds, installs
and runs with no lock screen and nothing anywhere saying why. Stating 17.2 would
sit exactly on that boundary, so the day anyone lowered `ios.deploymentTarget`
the module would disappear silently. 16.4 is SDK 57's own floor and cannot exceed
it; `test/now-playing/module.test.ts` asserts the podspec's number is strictly
below `app.config.ts`'s.

Two further things about the layout, read out of
`expo-modules-autolinking/src/platforms/apple/apple.ts` and `src/utils.ts`: the
podspec must be **exactly one directory deep** inside the module — `listFilesInDirectories`
reads the module's first-level directories and lists the files in each, so a
podspec at the module root is invisible to Expo while the React Native CLI still
finds it, which means `pod install` succeeds, the Swift compiles, and
`ExpoModulesProvider.swift` never imports the class — and `s.name` must equal the
podspec's basename, because `scripts/ios/package.rb` re-derives the path as
`File.join(pod.podspec_dir, pod.pod_name + ".podspec")`.

## Two SDK 57 facts that cost a compile each

**`Events("remoteCommand")` is not optional.** `BaseModule.sendEvent` routes
through the app context's event emitter and
`Core/Events/LegacyEventEmitterCompat.swift` delivers only to holders whose
definition lists the name. An undeclared event is **dropped with no warning at
all**.

**`NativeModule<T>` cannot be extended in SDK 57.**
`expo-modules-core/src/NativeModule.ts` declares
`export type NativeModule<TEventsMap …> = typeof ExpoGlobal.NativeModule<EventsMap>`.
`typeof` a class is its **constructor** type, so the alias describes the static
side and carries none of the instance members — and the events map is discarded
on the way, replaced by the unparameterised `EventsMap`. An interface extending
it compiles, and then `addListener` "does not exist on type", several lines from
anything that mentions inheritance. `modules/open-reader-now-playing/index.ts`
declares the three calls and the one listener directly instead.

## Consequences

Android is deliberately not replaced. Its `MediaSession` implementation is the
better-built half and honours playback state correctly. It does, however, enable
**no** controls by default — the opposite of iOS — so each one must be turned on
explicitly.

**It is also not written.** `src/now-playing/`'s `lockScreen()` throws on any
platform that is not iOS rather than returning a no-op, because a call that
quietly did nothing would be indistinguishable from a lock screen that is merely
broken — and because there is no Android device and no emulator on the machine
this was built on, so a path written here would be a path that has never run.
The refusal names what is missing and says to delete it once it exists.

**What the simulator could not deliver.** Nothing on this machine can lock the
simulator's screen or tap it: `SBSLockDevice` reaches SpringBoard and is refused
(`_SBXXLockDeviceAndFeatures Authentication failed`), Xcode 27's DeviceHub has no
window, and `simctl` has neither a lock nor a tap. So there is **no screenshot of
the literal lock screen**, and the headphone remote — which has no simulator at
all — is untested by construction. What was tested instead is the same path from
the far end: `MRMediaRemoteSendCommand` from a separate process on the device,
which is the call SpringBoard's lock-screen button makes. See
`notes/NOTES_2026-09-20.md`.
