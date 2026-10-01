# Physical iPhone

## Physical iPhone Release builds

- **The SQLite prefixed-symbol error persists with a fresh module cache** (2026-09-27). `npm ls --depth=0 --omit=dev` passed, but `node_modules/expo-sqlite/ios/sqlite3.h` was absent. The podspec copies the vendored SQLite sources there during `pod install`; package presence alone does not establish generated native-file presence. Running `pod install` restored the header. Replaying the failing Swift compiler command still failed with the cache populated before restoration, then returned 0 with a new cache after restoration. Check the generated header before a native build; restore it through Pods and use a fresh `CLANG_MODULE_CACHE_PATH` if the failed compile has already populated one. Why the generated file disappeared was not established.
- **A wireless installation takes a long time before any transfer begins** (2026-09-26). This run retried the known SQLite cache failure, then discovered a missing native dependency at JavaScript bundling time and rebuilt after Pods regeneration. Another simulator build was also active; its share of the delay was not measured. Check installed runtime dependencies and native integration first, reuse the successful isolated cache, and coordinate concurrent builds. See `docs/install-on-iphone.md`, “Before spending time on a native build”. The final Release build, wireless installation and command-line launch all returned 0; UI and playback were not verified.
- **Release bundling cannot resolve `react-native-teleport` although the manifest and lockfile declare it** (2026-09-26). This checkout lacked `node_modules/react-native-teleport`. A general `npm install --no-save --package-lock=false` failed because it selected `react-test-renderer@19.3.0`, whose React peer conflicted with the project's 19.2.3. Restore the exact missing archive with `npm pack react-native-teleport@1.2.2`, verify its integrity against the lockfile, extract it into its `node_modules` directory, then run `pod install` in `ios/` to register Teleport's native component before rebuilding. Do not upgrade React or the renderer to repair an installation checkout.
- **ExpoSQLite Swift compilation cannot find `exsqlite3_open` and other prefixed symbols** (2026-09-22, #43). The generated header existed and contained the declarations, and both the package and Pod lock reported 57.0.3. Rebuilding with a new `CLANG_MODULE_CACHE_PATH` passed this compilation stage. A stale module cache is suspected, not proven; do not replace SQLite sources or assume the phone's signing is at fault. Keep the isolated cache for subsequent builds while diagnosing.
- **RNAudioAPI reaches linking but FFmpeg symbols such as `avformat_open_input` are undefined** (same run). The four downloaded FFmpeg xcframeworks existed, but `Pods-OpenReader.release.xcconfig` had no corresponding framework paths. Running `pod install` from `ios/` after the binaries were present registered `libavcodec`, `libavformat`, `libavutil` and `libswresample`. Rebuilding with the isolated module cache returned 0 and `codesign --verify --deep --strict` passed. No app source was changed. Installation succeeded after the owner reconnected the phone; launch encountered the separate Security failure below. See `docs/install-on-iphone.md` for the commands.
- **Physical-device installation succeeds, but launch returns `CoreDeviceError 10002` / `Security`** (2026-09-22, #43). The error names invalid signing, inadequate entitlements or an untrusted profile as alternatives. Local signature verification passed, the profile was unexpired and included the phone, and application/team identifiers matched. The cause remains unconfirmed: the next step is to check developer trust under Settings → General → VPN & Device Management and retry. No successful trust action or launch was observed; do not report this as a verified fix. Full evidence is in `docs/install-on-iphone.md`.
- **A fresh `npx expo prebuild` fails the device build with `Signing for "OpenReader" requires a development team`** (2026-09-28, #77 final run). The worktree had no `ios/`; prebuild writes no team, and `-allowProvisioningUpdates` does not pick one. Pass the Personal Team on the command line, `DEVELOPMENT_TEAM=TEAM_ID` beside `ENABLE_USER_SCRIPT_SANDBOXING=NO`, or choose it in Xcode as the guide says. The team id is in `defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier` (`teamType = "Personal Team"`) and in the `OU` of the Apple Development certificate. With it, the Release build, `devicectl` install over the old app and launch all returned 0.
- **A Release build that succeeds prints `error:` lines** (2026-09-29, #83,
  `0.0.2-beta54`). The `-quiet` log of a build that exited 0 held six
  `error: the following command failed with exit code 0 but produced no
  further output`, each right after a compile step's warnings (2,122 warning
  lines in all), and no `BUILD FAILED`. They are Xcode's wording for a command
  that printed only warnings. Judge by the exit code, as the guide says, and
  grep for `BUILD FAILED` or an `error:` naming a file, not for `error:`. The
  same run needed `DEVELOPMENT_TEAM=UPR29WR8FC` after a prebuild that had
  cleared `ios/` (the item above); build 3 min 31 s with the 20260927-restored
  module cache, then install and launch both returned 0 over the cable.
- **A new bundle id fails to sign with `No Accounts: Add a new account in Accounts settings`** (2026-09-29 21:10, the System Voices app). It came with `No profiles for 'top.xujialiu.openreader.systemvoices' were found`, under `-allowProvisioningUpdates` and `DEVELOPMENT_TEAM=UPR29WR8FC`. Cause: Xcode had no Apple ID signed in (`defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists` held an empty list), and the only profile on the Mac was OpenReader's own (`~/Library/Developer/Xcode/UserData/Provisioning Profiles/`, expiring 2026-10-04 03:43:34 UTC). OpenReader still builds from that profile; anything that needs a new or renewed profile, a new app or OpenReader after that date, needs the owner to sign in again under Xcode → Settings → Accounts. Check the list before a build that needs a new profile.
- **`timeout` is not on macOS** (exit 127, the build never ran). Give the tool call its own timeout instead, or run the build in the background with its exit code written to a file and poll it.

## Physical iPhone screen

- **`xcrun devicectl device capture screen-record` refused the owner's iPhone
  16 Pro** (2026-09-23 23:24, Xcode 27): `The capability “Screen Recording” is
  not supported by this device. (com.apple.dt.CoreDeviceError error 1001)`.
  `devicectl device capture screenshot` worked on the same phone, 1206×2622,
  but a screenshot is far too slow to catch a flash of 35–60 ms. The route
  QuickTime takes was started and not finished: a Swift program that sets
  CoreMediaIO's `kCMIOHardwarePropertyAllowScreenCaptureDevices` found the phone
  as an `AVCaptureDevice` (`.external`, `.muxed`, "Xujia’s iPhone"), and an
  `AVCaptureMovieFileOutput` started at once failed with `-11805 Cannot
  Record`. The owner stopped the device test there. Next step, if it is
  needed: wait for the session to deliver frames before recording, or write
  sample buffers with `AVAssetWriter`. `AVCaptureDevice.authorizationStatus(for:
  .muxed)` throws `The passed media type 'muxx' is not supported` — ask
  `.video`.

## Physical iPhone logs and the lock screen's state (#66)

- **The simulator cannot show whether the lock screen says playing.**
  Symptom: after Pause, the owner's iPhone kept the Now Playing card on the
  two-bar Pause icon, while the iOS 27.0 simulator's `mediaremoted` logged
  `isPlaying changed to false` at once. Cause: the device infers the state from
  whether the app is sending audio out (`setting inferred playback state`); the
  simulator follows the app's explicit `playbackState` (`setting playback
  state`), and its inferred state stayed Paused with the engine running. Fix:
  measure on the device with `lock-screen-state.sh` (below).
- **`log collect --device-udid` needs root** (`log: Must be root to collect logs
  from attached device`). `pymobiledevice3 syslog live --udid IPHONE_UDID -pn
  mediaremoted` reads the same log over USB without it. Install it into a
  throwaway venv (`python3 -m venv DIR && DIR/bin/pip install pymobiledevice3`),
  not system-wide. zsh has a `log` builtin, so call `/usr/bin/log`.
- **The harness reaches a Release build on the phone, if it has Debug Mode.**
  Since #82 the poll runs only in Debug Mode, which the command in
  `docs/install-on-iphone.md` always sets; a build without it never reads the
  file. `xcrun devicectl device
  copy to --device IPHONE_UDID --domain-type appDataContainer
  --domain-identifier top.xujialiu.openreader --source FILE --destination
  Documents/harness.json` is picked up by the reader's poll. Its `HX` answers
  do reach the phone's log (next item). A `js` command's answer is written to
  the Debug Log as a `[probe]` line, and to the console as `HX PROBE …`
  (#113); it no longer shows in the player's note.
- **A Release build's `HX` lines are in the phone's log, but only while a live
  stream is attached** (2026-09-29, #74). An earlier entry here said a Release
  build prints no `HX` lines anywhere. `pymobiledevice3 syslog live --udid
  IPHONE_UDID -pn OpenReader` shows them as `OpenReader{React} <INFO>: HX …`,
  label `[com.facebook.react.log][javascript]`. INFO is kept only in memory, so
  an archive collected afterwards holds them from the moment a stream attached,
  not before. The #74 diagnostic build also writes them at the default level.
- **`pymobiledevice3 syslog collect OUT --start-time EPOCH` needs no root** and
  retrieves the persisted log (945 MB for 14 hours). WebKit's notices
  (`DragAndDrop`, `TextInteraction`, `ActivityState`, `ProcessSuspension`) were
  in it for the last half day and gone from the day before: collect soon after
  the event. Filter with `/usr/bin/log show --archive OUT --predicate
  'process == "OpenReader"' --style compact`, and add `--info --debug` only when
  a stream was attached. A predicate with `process IN {…}` and several names
  returned nothing here; `grep` the compact output instead.
- **`mediaremoted` puts the app after the verb.** Lines read `isPlaying changed
  to true for 【 … top.xujialiu.openreader (PID) … 】`, so a grep for
  `openreader.*isPlaying` never matches; the first draft of the script waited
  15 s for a Play that had happened.
- **A build with #66 unfixed stays Playing from the first Play on.** Its next
  run sees no `isPlaying changed to true`, because nothing changed. Relaunch it
  (`xcrun devicectl device process launch --terminate-existing --device
  IPHONE_UDID top.xujialiu.openreader`) and `open` the Document again before
  each run on such a build.
- **`pip install pymobiledevice3` fails with `ResolutionImpossible`, then `Failed to build 'arrow'`** (2026-09-28). PyPI read timeouts sent pip's resolver backtracking, and it fell back to an `arrow` source archive whose build needs `dateutil`. Fix: upgrade pip in the venv, `pip install --only-binary=:all: python-dateutil arrow`, then `pip install --timeout 60 --retries 5 --prefer-binary pymobiledevice3` (11.19.4 installed).
- **`syslog live` gives about 4,000 lines a second, and the app's own lines are mostly noise.** The harness poll logs `called <StartAccessing> on a URL that is not security-scoped` every 250 ms; UIKit background-task names print as `<private>` (the module's "Prepare narration" task is told apart only by its non-null `_expireHandler`). Filter while capturing. The app's foreground/background/suspended state is runningboardd's `Calculated state for app<top.xujialiu.openreader…>: running-active / running-suspended`; leaving the app with no download going on read `running-suspended` about 1.1 s after the switch.
- **A stale `Documents/harness.json` runs once at every launch.** The harness's last-seen `seq` starts at -1, so a relaunch executes whatever the file holds; the phone's copy was a `js` probe left from 2026-09-28 01:39. Leave a harmless command there (`{"seq":N,"do":"go","route":"Library"}`). `kit/phone-hx.cjs` puts `{"do":"noop"}` back after each answered command.
- **On a build before `1.0.0-beta3` (#113), two `js` answers within milliseconds leave only the second in the Debug Log** (2026-10-01 01:59, #112). A probe answered once synchronously and once from a `requestAnimationFrame` 4 ms later. Only `PROBE raf fired after 4ms …` was logged; the synchronous answer, the one that mattered, was missing. Cause: the answer travels as a `problem` message and becomes the player's note, and the Debug Log records the note from an effect, which saw only the last of two state updates. Fix: one answer per probe; a second fact is a second probe. From `1.0.0-beta3` each answer is a `[probe]` line of its own.
- **On a build before `1.0.0-beta3` (#113), a `js` answer is the owner's player note until the next note** (2026-10-01, #112). The note reads `The highlight could not be drawn: PROBE {…}`, in place of whatever the owner was reading, such as the out-of-text sentence. Tell the owner what they will see before probing.
- **The owner's own taps land in the probe's answer window** (2026-10-01 02:10:18, #112). `phone-hx.cjs`'s answer showed `[reading] play at utterance 467` 0.75 s after the probe's note. No harness handler plays on a `js` command (`reading-view.tsx`, `reader-screen.tsx`, `shell.tsx`), and the app had been in the foreground since 01:59:10, so the Play was the owner's. Read `[app]` and `[reading]` lines in an answer as possibly the owner's. Check whether the owner is using the phone before probing, and ask before any command that plays, pauses or navigates.
- **`devicectl device copy from` keeps file modification times.** A clip's `.audio` is written once, so its mtime is its save time, and a copy taken after a lock still shows when each clip was saved. `devicectl device info files` gives dates only to the minute.
- **After `npm ci`, the first `pod install` still left FFmpeg out of the link** (2026-09-29, #82). The Release build failed with `Undefined symbols … _swr_init`, `_swr_get_out_samples` from `libRNAudioAPI.a(FFmpegDecoding.o)`; `Pods-OpenReader.release.xcconfig` had no `libavcodec`. A second `pod install` added it (0 → 1 match) and the build returned 0. The same fix as the #43 entry above: the first run fetches the xcframeworks, and only a run with them present registers them. After a fresh `npm ci`, run `pod install` twice, or grep the xcconfig for `libavcodec` before building.
- **`devicectl` reaches the phone over Wi-Fi, pymobiledevice3 only over the cable** (2026-09-29, #82). With the cable out, `devicectl list devices` said `connected` and `test/manual-test/kit/debug-log.py` copied the Debug Log, while `pymobiledevice3 usbmux list` printed `[]` and `syslog collect`/`syslog live` failed with `Device not found: usbmux has no device matching udid`. A `syslog live` stream ends when the cable is pulled (`long-press-watch.py` printed `syslog stream ended` at 09:52 and stopped). For the system log, plug the cable in; the Debug Log itself needs no cable.
