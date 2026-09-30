# Simulators, installs and the simulator's volume

## Simulators and installs

- **Several sessions share this Mac's simulators.** Use the one the owner or the task names, and check `xcrun simctl list devices booted` first. Leave alone any simulator another session is booting, driving or reinstalling.
- **A named simulator can disappear during a manual run.** On 2026-09-22 an owner cleanup deleted the recorded iPhone 17 while an Azure XCTest was waiting, and the next `xcodebuild` answered `Unable to find a device matching` that destination. Re-run `xcrun simctl list devices available`, choose a remaining matching runtime, boot it, reinstall the current Debug app, set its simulated volume to zero again, and treat the interrupted artifacts as incomplete.
- **A cached Debug app can lack a native module required by the current bundle.** On 2026-09-22 installing an old cached app over the replacement iPhone 17e and loading the current Metro bundle showed `[runtime not ready]: Cannot find native module 'ExpoUI'`. Build the Debug app from the current checkout with the simulator guide's `xcodebuild` command, install that product, then repoint its Metro port before relaunching.
- **Whether a `.app` has a module is not answered by its `Frameworks` or by its main binary.** Looking for `@expo/ui` on 2026-09-23 (#42), `ls OpenReader.app/Frameworks` listed the five Expo frameworks and no `ExpoUI`, and `strings -a OpenReader.app/OpenReader | grep -ci expoui` answered `0` — for a build that has it. Its symbols are in `OpenReader.debug.dylib` beside the binary, 425 of them. Ask that file, or `ios/Podfile.lock`, or compare the build's own time (`stat -f %Sm`) against the commit that added the dependency; the two caches this looked at, `/tmp/openreader-simulator-build` and the newest `DerivedData` product, were both from before 538fa10 13:52 and genuinely too old to reuse.
- **A new output device on the Mac puts booted simulators back to volume 60,
  with nothing booted or launched.** Measured 2026-09-23 at 19:44: the owner's
  AirPods Pro became the Mac's default output, and within a second the
  `audiosettings.plist` of both booted simulators that follow the default output
  read `sim_volume` 60 with the AirPods as `sim_output_device_uid`. One of them
  had been set to 0 half an hour earlier. A third booted device, whose output
  was `BuiltInSpeakerDevice`, was not touched. The owner is then listening on
  the very headphones a test would play into. It happened again: at 20:24:06
  the AirPods were already the default output, and the same two devices were
  reset to 60 in the same second. That was two minutes after a test run had
  ended, and nothing had been launched. Whatever the AirPods do when they
  reconnect, or switch back to the Mac, is enough. So a `set` holds only until
  the next such event. The same evening an ios-tester run played 3.7 s at
  volume 60, because a standalone `check` failed and its script went on to play
  anyway. Fix: `silence.sh check` immediately before every play, as the kit's
  scripts do, with the play chained to it by `&&`. After a failed check, `set`
  it and restart the app, which takes the value when it activates its audio
  session. In `check && terminate; launch`, the launch still runs after a failed
  check.
  It is not only the AirPods. On 2026-09-24 at 00:09:11, two devices were
  rewritten in the same second to `sim_volume` 60 with `sim_output_device_uid`
  `BuiltInSpeakerDevice`: `iPhone 17 bug`, which had read 0 at 00:06:55, and
  the dedicated `iPhone 17 bug_2`, set to 0 at 23:00 the evening before, whose
  app had been terminated and relaunched about twenty times in the half hour
  before and had played nothing. The Mac's default output was then "MacBook
  Pro Speakers". The check in front of the next play caught it. It came back at
  01:52:00, on the same two devices in the same second, during an XCTest run on
  one of them. So do not reason that a `set` holds because the headphones have
  not moved. The check in front of each play is the only guard.
  It can recur inside a single session faster than a multi-step setup takes to
  reach its own play: measured 2026-09-25 verifying #60/ADR 0047
  (`iPhone 17 issue_60`, `sim_output_device_uid` a Bluetooth MAC-style id),
  a `set` followed by a `pause-gap.cjs` run's own shut/settings-patch/open
  sequence (about 2 s) still found `sim_volume` 60 at that script's own
  `check`, twice in a row a few minutes apart. Fix used here: `set` again
  immediately before `check`, with `check` immediately before `onPlay()` and
  nothing else in between — `pause-gap.cjs` now does this itself rather than
  relying on a `set` done once earlier in the session.
  The walkthrough harness's own `play` command does **not** check the volume
  the way `reading.cjs play-for` does: measured 2026-09-29 verifying #86 on a
  device created that hour, a `check` refused (60 again, ~25 minutes after the
  boot's `set`) but a hand-written `hx.cjs '{"do":"play"}'` beside it ran the
  reading anyway, because nothing chained the two. Chain every harness play
  the same way — `silence.sh check UDID && hx.cjs … '{"do":"play"}'` — and on
  a failed check `set` again and relaunch the app (the volume is read when the
  audio session activates) before playing.
- **The simulator volume can reset immediately before a chapter run even when
  the preceding check was zero.** Measured 2026-09-25 at 10:42 on `iPhone 17
  issue63`: the first check before `play` read 60, although the device had
  read 0 during setup. Set it back to zero, check again in the same command
  chain, and do not play until that check succeeds; this run then stayed at
  zero throughout.
- **A manual-test script may not be executable.** On 2026-09-25,
  `library-open.sh` (the wrapper `LibraryOpenProbe` had then) returned shell
  `permission denied` before creating its XCTest project. Invoke scripts here
  with `bash …` or `node …` rather than relying on their mode.
- **A refused XCTest can leave a recording that reads GREEN.** After the
  00:09:11 reset, the next `scroll-theme-reader.sh` (`ScrollThemeReaderProbe`) on `iPhone 17 bug_2`
  refused it (exit 2) and ran no flings, which `white-flash.sh fling` reported
  as `XCTest failed`. `set`, relaunch the app, and run again. The reset recurred the same
  night, 01:06, independently verifying #27 on the same device: three
  `white-flash.sh fling` runs all refused (exit 2) and printed `GREEN: no white
  frame` anyway, because a refused run records nothing and analyses whatever
  static frame that leaves — a silent false GREEN, not a real result. `set` and
  relaunch fixed it, and the same three runs then genuinely flung (67–77 s of
  `Executed` time each, 3,600–3,900 frames). `white-flash.sh` now reads no
  recording whose XCTest failed: it prints `XCTest failed, recording not read`
  for that run and exits 2. Any script that records around a refusable XCTest
  needs the same rule.
- **A newly created device put its own volume back to 60 a couple of minutes
  after its first boot.** Measured 2026-09-23 on a fresh iPhone 17 (iOS 27.0):
  `silence.sh set` right after `bootstatus -b` read back 0, and a few minutes
  later `check` answered 60, with the file's modification time 12:47, about two
  minutes after the set and before anything had played. The first boot's own
  setup rewrote it. Set it again once the new device has settled — a `set`
  followed 20 s later by a `check` that still reads 0 — then relaunch the app,
  and keep the `check` in front of every play. It happened later too:
  on 2026-09-24 a new iPhone 17 booted at 01:56 read 0 at a set about 02:04:00
  and at a `check` 25 s after it, and read 60 at 02:24; its file had been
  rewritten at 02:04:54, as the device's first XCTest run was starting. Nothing
  had played.
- **`xcrun simctl get_app_container` refuses a shut-down device.** Boot it first.
- **Installing a copied Debug `.app` can change its Data container UUID.** On
  2026-09-24, `simctl install` over the booted sync simulator moved OpenReader
  from one `Data/Application/<uuid>` directory to another. `SyncProbe` still
  had the old `CONTAINER` in `/tmp/openreader-sync-params.txt`, so every
  harness write failed with `NSCocoaErrorDomain Code=4` and the test's later
  `settleAt` assertion was only a consequence. Refresh `CONTAINER` with
  `xcrun simctl get_app_container UDID top.xujialiu.openreader data` after
  every install, before launching a probe.
- **Another simulator needs the same Debug app.** `xcrun simctl install DEST "$(xcrun simctl get_app_container SOURCE top.xujialiu.openreader app)"` copies it without a build, to any device family the app supports, iPad included.
- **An iPad behaves differently from an iPhone.** An iPad-sized WKWebView defaults to the desktop content mode, where WebKit ignores `text-size-adjust` (ADR 0030). The reader asks for the mobile mode through `patches/`. Anything that depends on WebKit is worth checking on an iPad simulator too.
- **The app's console is not in the simulator's log.** `log show` has no `console.log` or `HX` lines; they are only in Metro's output. Note the time with `date` when you take a measurement, because it cannot be recovered afterwards.
- **A screenshot photographs whatever is in front, and a harness command does
  not bring the app forward.** After a Safari page run, `leading-strip.sh … app`
  sent its commands to the backgrounded app, where they ran, and photographed
  Safari, whose page still held a strip of its own: a RED for the wrong reason
  (2026-09-22). Fix: `xcrun simctl launch UDID top.xujialiu.openreader` first,
  which brings a running app to the front without restarting it, and check that
  the run's own answer reached Metro before believing its screenshot.
  `leading-strip.sh` does both.
- **Safari's first `simctl openurl` on a device sits on its Start Page for about
  25 s.** A screenshot 6 s after it was the Start Page, then a blank page, and
  the page's own requests reached the server 25 s after the openurl. Poll for
  what the page draws rather than sleeping a fixed time; `leading-strip.sh page`
  does.
- **`npx expo run:ios --port N --no-bundler` is refused**, after its CocoaPods
  step has already run: `CommandError: --port and --no-bundler are mutually
  exclusive arguments` (2026-09-22). Start this tree's Metro yourself
  (`npx expo start --port N < /dev/null`), then run `npx expo run:ios --device
  UDID --port N` without `--no-bundler`: it finds that server ("Waiting on
  http://localhost:N"), builds, installs over the app and opens it.
- **A fresh `expo run:ios` install still fetched its bundle from another
  tree's Metro.** On 2026-09-22, after `run:ios --port 8090` had built with a
  new native dependency, installed and opened the app, `/json/list` on 8090 stayed
  empty while the iPhone 17 was listed on 8087, the main checkout's Metro, which
  was serving JavaScript without that dependency. Installing over an app keeps its container, and the container's
  `RCT_jsLocation` (`localhost:8087`, left by an earlier session) outranks the
  port the build was made for. Fix it as in [metro.md](metro.md):
  terminate, `plutil -replace RCT_jsLocation` on the container plist, shut down
  and boot. `run:ios` also opens `top.xujialiu.openreader://expo-development-client/?url=…`;
  this app has no development client, and that URL did nothing visible.

## Away from the screen: the lock and the background time (#75)

- **A simulated lock passes through `active` once on its way to the
  background, and `download-away.cjs`'s `away (locked)` mark comes after it.**
  Measured 2026-09-28 (#75 verification, `iPhone 17 download`, iOS 27.0) with
  an in-app `AppState` listener (`download-sampler.cjs`), six `lock-device.sh
  lock` calls: `inactive` first, 2.1–3.0 s later `active` for 16–82 ms, then
  `inactive` and `background`. The script's mark came 0.5–1.4 s after
  `background` and 2.7–4.5 s after the first `inactive`. The runtime's
  `AppState` `active` handler therefore runs once in the middle of every
  simulated lock (it clears `expired`, ends the background task, re-queues an
  `interrupted` download and kicks the scheduler), and the background time
  starts at `background`, not at the mark. Fix: time anything after a lock from
  the app's own `background` event (`download-sampler.cjs read`), not from the
  script's mark; a device lock by a person may not pass through `active`.
- **The end of the background time (`expired`) never came in a process whose
  Reading had played, even after it was paused.** Measured 2026-09-28 with a
  listener on the offline module's `expired` event beside the runtime's
  (`download-sampler.cjs`): no `expired` in 140 s locked while a Reading
  played (twice), none in 75 s and 256 s paused while locked (170 s and 341 s
  in the background in all; the download went on for all of it, and the app's
  JavaScript never stopped), and none in a `home` run of 90 s in a process where a Reading
  had played and been paused before the run. In a process relaunched just
  before the run, with nothing played, the same `home` run got `expired` 25.5 s
  after `background` and the download went `interrupted` 0.6 s later. So the
  app's paused Reading keeps it running away from the screen on this
  simulator, whether or not a phone does (#77). Fix, for the baseline (a
  download away from the screen with no Reading): `simctl terminate` and
  `launch` first and play nothing in that process. For what follows an
  expiration while a Reading plays, which cannot happen here: the handler
  probe `EXPIRE_AT` in `download-lock-pause.cjs`, which emits `expired` from
  JavaScript, and say that it did.
- **`/tmp/openreader-lock-device` is built once and shared by every worktree,
  so a probe method added later is not in it.** `lock-device.sh` builds only
  when `/tmp/openreader-lock-device/build/Build/Products` is missing, so after
  `DeviceLockProbe.swift` gained `testLockScreenPlay`/`testLockScreenPause`
  (2026-09-28) the old build would have answered `play` and `pause` with a test
  that does not exist. Delete the directory once after changing the probe; the
  next call rebuilds it (about 30 s).
- **`xcrun simctl get_app_container` can say "No such file or directory" for an
  installed, running app on a booted device.** Seen 2026-09-29 (#88, iPhone 17
  download, iOS 27.0): both `data` and `app` failed with
  `NSPOSIXErrorDomain code=2` while the app was foregrounded and Metro
  connected — a CoreSimulator lookup glitch, not an uninstalled app. Fix: read
  the container straight off disk,
  `~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Containers/Data/Application/<ID>/`,
  and pick the entry by a marker file (`Documents/harness.json` for
  OpenReader). Everything the container path is used for (harness.json,
  catalog.sqlite, Inbox) works from that path.

## The #106 run's additions (2026-09-30, freshly created iPhone 17, iOS 27.0)

- **A first Debug build from a fresh `expo prebuild` crashed at dyld, before
  any JavaScript.** `Library not loaded: @rpath/React.framework/React`,
  referenced by the app's `ExpoModulesWorklets.framework` — the precompiled
  Expo modules were built against a different React configuration.
  `docs/install-on-simulator.md` names this fix for the JS-time crash variant;
  the dyld variant is the same fix: `cd ios && EXPO_USE_PRECOMPILED_MODULES=0
  pod install`, then rebuild. The rebuilt app launched and connected normally.
- **The first `simctl launch` of a freshly installed app can fail with
  NSPOSIXErrorDomain code=3 ("No such process").** A plain retry launched.
- **Synthetic input silently stopped reaching the app, repeatedly.** axe taps
  (`--tap-style physical`, standalone and in one `batch` session), XCUITest
  element taps and raw `XCUICoordinate` taps all answered "completed" while
  the app registered nothing — no navigation, no sync request in the helper
  server's log, no Debug Log line. It worked for minutes, died mid-run, came
  back after a reboot, and died again; on the retry after the next reboot it
  was fast and reliable (a 1.6 s Play→Back gap), on the run after that the
  same two taps landed 5.7 s apart. Never reason from the tool's success
  line: verify every tap by an app-side fact (a sync request in the delaying
  server's log is the fastest one for a Play press), and re-run the whole
  timed step when a gap comes out too wide instead of trusting the run.
- **An XCUITest tap aimed at the reader's Play landed ~54 pt high, on
  "Choose a Voice"** — the Voice sheet opened mid-run while the log showed
  `Tap "Play" Button` succeeding. `app.buttons["Play"]` resolved a ghost (the
  parked reader's reparented controls; a count query showed 1). Raw
  `XCUICoordinate` taps at the frames `axe describe-ui` reports for the live
  screen are the dependable form; print the matched counts so a ghost shows.
- **The volume reset to 60 every few minutes for an hour**, not only in the
  known first-boot window (`sim_output_device_uid` BuiltInSpeakerDevice, no
  AirPods event). Only `set` immediately before each `check`/play held; two
  runs were refused by the check and simply rescheduled after a `set`.
