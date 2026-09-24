# Device and manual tests

Before writing a script, inspect this directory and reuse or extend the relevant
one. Save useful new reproduction, inspection and verification scripts here as
soon as they work. Document the invocation, prerequisites, expected result and
what the script cannot prove. One-off probes may stay temporary; a working tool
needed for the next run belongs here.

Keep generated Xcode projects, builds, logs and screenshots outside the
repository. Accept device IDs and artifact destinations as arguments. Load only
needed credentials from `~/.secrets/openreader/`; never print or commit their values.
Follow the simulator installation guide and AGENTS.md's silence, playback-duration
and final-running-app requirements. Choose playback duration for the fact being
measured, and stop immediately afterwards, including after failures.

## Silence the simulator, never the Mac

```sh
bash test/manual-test/silence.sh set SIMULATOR_UDID     # that device to zero, read back
bash test/manual-test/silence.sh check SIMULATOR_UDID   # exit 2 unless it is zero
```

This writes `sim_volume` in that one device's own
`~/Library/Developer/CoreSimulator/Devices/UDID/data/var/run/simulatoraudio/audiosettings.plist`.
It is the simulated device's volume, on the 0-100 scale its volume buttons use,
and the app on it reads the same number back as `AVAudioSession.outputVolume`.
Nothing outside that device changes: not the Mac's output, not another
simulator. The UDID may be left out only when exactly one simulator is booted.

Measured on 2026-09-21 with a throwaway iOS 27.0 device, an app playing a 440 Hz
tone through `AVAudioSession(.playback)` and `AVAudioEngine`, and a CoreAudio
process tap recording what that guest process actually delivered to the host:
at `sim_volume` 60 the tap read peak `0.090000`, rms `0.063639` over 286,720
samples; at `sim_volume` 0 it read peak `0.000000`, rms `0.000000`, and the app
reported `outputVolume=0.0`. The Mac's own volume was not touched for either.

Three properties decide how to use it, all of them in Pitfalls below: a boot
resets it to 60, an app takes the value when it activates its audio session, and
a shut-down device has no file at all. So: boot, `set`, then launch the app.
`lock-screen.sh` (tap mode), `reading.cjs play-for`, `voice-playback.cjs` and
`offline-playback.cjs` all `check` it before they play.

## Real books

`~/Works/epub_books` is the owner's own library: long English web novels, each
split into parts of about 250 chapters (`<Book>/<Book> <start>-<end>.epub`, a
few MB each; its own README says how they were split). Take one when a generated
fixture is too tidy to show the behaviour: a part has hundreds of spine items,
chapters several screens tall and a real navigation document, which is what
section boundaries, `renderAhead`, `display()` and a chapter download meet in
the owner's actual reading.

Load a part the way any fixture is loaded: copy it into the app's
`Documents/Inbox` (`xcrun simctl get_app_container SIMULATOR_UDID
top.xujialiu.openreader data`) and add it with the harness,
`{"seq":N,"do":"add","file":"NAME.epub"}`, then open it by the Document Id the
answer names. The books are personal copies: they stay outside the repository,
and what is committed is what was measured, never their text.

## Pitfalls

What has gone wrong before, and what fixed it. When `xcrun`, Metro, XCTest or a
manual step goes wrong or misleads you, add it here, with its symptom, cause and
fix (AGENTS.md).

### Physical iPhone Release builds

- **ExpoSQLite Swift compilation cannot find `exsqlite3_open` and other prefixed symbols** (2026-09-22, #43). The generated header existed and contained the declarations, and both the package and Pod lock reported 57.0.3. Rebuilding with a new `CLANG_MODULE_CACHE_PATH` passed this compilation stage. A stale module cache is suspected, not proven; do not replace SQLite sources or assume the phone's signing is at fault. Keep the isolated cache for subsequent builds while diagnosing.
- **RNAudioAPI reaches linking but FFmpeg symbols such as `avformat_open_input` are undefined** (same run). The four downloaded FFmpeg xcframeworks existed, but `Pods-OpenReader.release.xcconfig` had no corresponding framework paths. Running `pod install` from `ios/` after the binaries were present registered `libavcodec`, `libavformat`, `libavutil` and `libswresample`. Rebuilding with the isolated module cache returned 0 and `codesign --verify --deep --strict` passed. No app source was changed. Installation succeeded after the owner reconnected the phone; launch encountered the separate Security failure below. See `docs/install-on-iphone.md` for the commands.
- **Physical-device installation succeeds, but launch returns `CoreDeviceError 10002` / `Security`** (2026-09-22, #43). The error names invalid signing, inadequate entitlements or an untrusted profile as alternatives. Local signature verification passed, the profile was unexpired and included the phone, and application/team identifiers matched. The cause remains unconfirmed: the next step is to check developer trust under Settings → General → VPN & Device Management and retry. No successful trust action or launch was observed; do not report this as a verified fix. Full evidence is in `docs/install-on-iphone.md`.

### Metro and the bundle

- **The app runs code you have already changed.**
  - Cause: Metro started with `CI=1` does not watch files. It serves what it read at start, and its log says so once: "Metro is running in CI mode, reloads are disabled".
  - Fix: start it as `npx expo start --port PORT < /dev/null`. It will not prompt, because stdin is not a terminal.
  - To confirm the change is in what Metro serves: `curl -s "http://localhost:PORT/index.bundle?platform=ios&dev=true&minify=false" | grep -c <identifier from your change>`.
  - Ask a few seconds after the write, not in the same breath. Measured 2026-09-23: a bundle fetched straight after a `cp` put a file back still held the code the `cp` had replaced, and one fetched 3 s later did not. One stale answer is Metro's watcher catching up, not CI mode.
- **The bundle is stale or broken after `npm ci` or a new patch.** `node_modules` was replaced under a running Metro. Restart it with `--clear` and check the bundle as above.
- **A new worktree has no `node_modules`**, so `npm run typecheck` answers `sh: tsc: command not found` until `npm ci` has run. Plain `npm ci`, with nothing passed to it, is the whole command: 831 packages in 4 s, ending in `patch-package` (`@epubjs-react-native/core@1.4.8 ✔`).
- **`npm ci` stops with `ERESOLVE could not resolve`, naming `react-dom@19.3.0`.** From 538fa10 on 2026-09-22 until 2026-09-23 this was every new worktree's first wall, and `--legacy-peer-deps` was the way past it. It is now fixed at the root (#42, ADR 0039): `package.json` overrides `react-dom` to `$react`, so the lockfile holds the `react-dom` the pinned `react` peers with, and no command in this repository needs the flag. The symptom returns only on a branch from before that fix, or if the override is dropped — pass `--legacy-peer-deps` once to get moving, then merge `main`, rather than writing the flag into an instruction again. `react-dom` does not reach the iOS bundle either way: the same Hermes bundle hash comes out of both trees (engineering log, 2026-09-22 13:02 and 2026-09-23 02:48).
- **A port is taken by a Metro that serves another tree.**
  - Check with `lsof -nP -iTCP:PORT -sTCP:LISTEN`, then `lsof -a -p PID -d cwd`.
  - A cwd in another worktree, or under `.orca-worktree-trash`, is not yours. Take the next free port rather than stop something another session may be using.
  - The stale-directory case is also in `docs/install-on-simulator.md`.
- **The installed Debug app can follow another port without a rebuild**, but
  `xcrun simctl spawn UDID defaults write …` is not how, whatever it reads back.
  - Symptom: `xcrun simctl spawn UDID defaults write top.xujialiu.openreader
    RCT_jsLocation localhost:8084` is accepted, `defaults read` answers
    `localhost:8084`, and the app still fetches its bundle from the old port —
    it showed the *other* worktree's `ConfigError: The expected package.json
    path … does not exist` in a red box.
  - Cause: `simctl spawn` runs outside the app's container, so it writes
    `<device>/data/Library/Preferences/<bundle>.plist`, while the app reads
    `<device>/data/Containers/Data/Application/<uuid>/Library/Preferences/<bundle>.plist`.
    Editing *that* file with `plutil -replace` while the device is booted also
    changes nothing: the simulator's `cfprefsd` is still serving the old value.
  - Fix: terminate the app, `plutil -replace RCT_jsLocation -string
    localhost:PORT` on the **container** plist, then `xcrun simctl shutdown` and
    `boot` so `cfprefsd` re-reads it. Prove it from the app's own side rather
    than from `defaults`:
    `xcrun simctl launch --console-pty UDID top.xujialiu.openreader` prints
    `[RCTMultipartDataTask] GET http://localhost:PORT/.expo/.virtual-metro-entry.bundle…`,
    and the device then appears in `curl -s http://localhost:PORT/json/list`.
- **An Expo Debug build writes its own port back over `RCT_jsLocation` at every
  launch**, so the plist fix above does not hold for it.
  - Symptom (2026-09-22, iPhone 16, a Debug app built at 04:05 that day): the
    container plist, edited to `localhost:8089` with the device shut down, read
    `8089` after the boot and `localhost:8086` again as soon as the app
    launched. The app loaded from 8086, and 8089's Metro never logged a bundle.
  - Cause: Expo SDK 57's `adoptInfoPlistMetroPort()`
    (`node_modules/expo/ios/AppDelegates/ExpoReactNativeFactory.swift`), Debug
    only. It reads `RCTMetroPort` from the app bundle's own `Info.plist`, which
    `expo run:ios --port` bakes in, and writes `localhost:PORT` into
    `RCT_jsLocation` whenever the two differ. `plutil -p "$(xcrun simctl
    get_app_container UDID top.xujialiu.openreader app)/Info.plist" | grep
    RCTMetroPort` shows the port a build insists on.
  - Fix without a rebuild: copy the `.app` out of the device, `plutil -replace
    RCTMetroPort -string PORT` on the copy's `Info.plist`, `codesign --force
    --sign - --preserve-metadata=entitlements` the copy, terminate the app and
    `xcrun simctl install UDID COPY.app` over it. The data stays. The next launch
    logged `iOS Bundled … index.ts` in the new port's Metro and appeared in its
    `/json/list`.
  - A build whose `RCTMetroPort` is empty does not: `adoptInfoPlistMetroPort()`
    returns before writing anything, and the container's `RCT_jsLocation` stands.
    With a **fresh** container, which has no `RCT_jsLocation` at all, what stands
    is the default 8081 — another tree's Metro on this machine. Measured
    2026-09-23 02:58 (#42): `npx expo run:ios --device UDID --port 8090` built,
    installed on a device that had never held the app, reported "Waiting on
    http://localhost:8090" and opened it, and 8090 logged no bundle and answered
    `[]` on `/json/list`. So `--port` is what `run:ios` waits on, not what the
    app it opens asks. One `xcrun simctl terminate` and a relaunch with
    `-RCT_jsLocation localhost:8090` fixed it: `iOS Bundled 3791ms index.ts
    (1605 modules)` in that Metro, and the device in its `/json/list`.
    That is the other observation of the same day (**Simulators and installs**,
    "A fresh `expo run:ios` install still fetched its bundle from another tree's
    Metro"): the build `expo run:ios --port 8090` made at 12:29 has `RCTMetroPort`
    `""` in its `Info.plist`, and it kept a container's older `localhost:8087`
    until the plist fix above. So read `RCTMetroPort` in the bundle first: empty,
    use the plist fix; a port, re-sign a copy with the port you want.

- **A launch argument points a Debug app at another Metro port, with no plist
  edit and no reboot.** `xcrun simctl launch UDID top.xujialiu.openreader
  -RCT_jsLocation localhost:PORT` puts the value in the process's argument
  domain, which `NSUserDefaults` reads before the container plist the bullet
  above has to edit. Measured 2026-09-22: a Debug app freshly copied onto a new
  iOS 27.0 device fetched its bundle from port 8088 on its first launch, Metro
  logged `iOS Bundled`, and the device appeared in `/json/list` there. It
  belongs to the launch it is passed to, so pass it on every relaunch.
- **An existing probe's own `app.terminate(); app.launch()` drops that launch
  argument too, and reconnects to whatever Metro the container plist last
  held.** Every probe in `ios/` does this at the start of most methods
  (`OfflineFixProbe.testConfigureFishProvider` among them) because in the
  common case — one simulator, the default port — a bare relaunch reconnects
  to the same server. On a device kept on a non-default port by the launch
  argument alone (a dedicated worktree simulator, this file's own example),
  it does not: measured 2026-09-22, `xcresulttool`'s failure screenshot showed
  a red `ConfigError: The expected package.json path …/fix/package.json does
  not exist` — a **different, already-deleted** worktree's Metro, left over in
  the container plist from before this session repointed the device with the
  launch argument. `curl -s http://localhost:PORT/json/list` answered `[]`
  throughout. Fix as in the bullets above: `xcrun simctl terminate`, then
  `launch UDID BUNDLE -RCT_jsLocation localhost:PORT` **from the host**, not
  from inside a test — and prefer a probe method that only `.activate()`s an
  already-connected process when running against a device like this one.
- **Reusing another worktree's installed Debug app is safe only while the native
  side matches.** Compare `git diff --name-only main` against `package.json`,
  `app.json`, `plugins/` and `patches/`; a change to `patches/` or to a
  `scripts` entry is JavaScript and rides over Metro, a change to a dependency
  or a config plugin is not.
- **The kit's CDP scripts talked to port 8081 whatever port this tree's Metro
  is on.** `reading.cjs` and `voice-playback.cjs` had `127.0.0.1:8081` written
  in, and `offline-playback.cjs` goes through `cdp.cjs`, whose default was the
  same. On 2026-09-22 every port from 8081 to 8084 held a Metro serving a
  deleted worktree, so this tree's was on 8085 and the scripts found no target,
  or the wrong device's.
  - Fix: `OPENREADER_METRO=http://127.0.0.1:PORT` in the environment; `cdp.cjs`,
    `reading.cjs`, `voice-playback.cjs` and `stop-on-word.cjs` all take it.
- **A detached shell can let a newly started Metro exit immediately.** On
  2026-09-22 `npx expo start --port 8092 < /dev/null > /tmp/metro.log 2>&1 &`
  returned without a process or log, so the port never opened. Run Metro in a
  persistent terminal session and check its cwd, `/status`, and the bundle
  before launching the app.
- **`watchfetch` misses the first request the app makes as it starts.** The
  shell asks every enabled Provider for its Voices on mount (#24), and the
  harness's first poll is 250 ms later, so with `watchfetch` already in
  `harness.json` at launch the log shows Fish's listing pages 2–4 and never
  page 1. Page 1 was sent; its absence from the log proves nothing.
- **`simctl launch --console-pty` piped through `timeout` and `grep` printed
  nothing at all**, right after repointing a Debug app's `RCT_jsLocation` to a
  new Metro and rebooting the device (the fix two bullets up). `timeout 12
  xcrun simctl launch --console-pty UDID BUNDLE | grep -i bundle` produced no
  output — not even a first "Bundling" line — which reads exactly like the app
  still not reaching the new port. It was reaching it: a plain `xcrun simctl
  launch UDID BUNDLE` right after, with no pipe, showed a `Bundling NN%…`
  banner on a `simctl io screenshot` within a few seconds, and `curl -s
  http://localhost:PORT/json/list` (empty immediately after `launch`, since the
  debug target only registers once the bundle finishes and the inspector
  connects) listed the device once that finished. Cause not isolated further
  (`timeout`'s signal racing the pty's buffering through the `grep` pipe is the
  suspect). Fix: prove a repointed Metro connection with a plain `simctl
  launch` plus a screenshot and a couple of seconds of polling `/json/list`,
  not `--console-pty` piped through `timeout`/`grep`.

### Simulators and installs

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
- **A newly created device put its own volume back to 60 a couple of minutes
  after its first boot.** Measured 2026-09-23 on a fresh iPhone 17 (iOS 27.0):
  `silence.sh set` right after `bootstatus -b` read back 0, and a few minutes
  later `check` answered 60, with the file's modification time 12:47, about two
  minutes after the set and before anything had played. The first boot's own
  setup rewrote it. Set it again once the new device has settled — a `set`
  followed 20 s later by a `check` that still reads 0 — then relaunch the app,
  and keep the `check` in front of every play.
- **`xcrun simctl get_app_container` refuses a shut-down device.** Boot it first.
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
  port the build was made for. Fix it as in **Metro and the bundle** above:
  terminate, `plutil -replace RCT_jsLocation` on the container plist, shut down
  and boot. `run:ios` also opens `top.xujialiu.openreader://expo-development-client/?url=…`;
  this app has no development client, and that URL did nothing visible.

### Screenshots of a sheet

- **A sheet photographed as it opens can be 1 pt short of where it rests, and
  that reads as a layout change.**
  - Symptom: two screenshots of the same sheet differ by one vertical offset of
    everything in it. On 2026-09-22 the #28 before-shot of the loading voice
    sheet sat 3 px lower than the fixed build's, title, chip and note alike,
    and the grip's last pixel row was only partly covered.
  - Cause: the modal's slide-in eases out and pauses one point short. Recorded
    with `simctl io recordVideo`, the sheet's top edge went 1318, 1316, 1315,
    **1314** px, stayed at 1314 for 30–70 ms, then jumped to 1311 and rested
    there. That pause is the frame a `simctl io screenshot` most easily lands
    on. The old build's before-shot and a new-build frame at 1314 were
    pixel-identical over the whole sheet except the note #28 moved.
  - Fix: before comparing positions across screenshots, check that the sheet's
    top edge is at rest: two consecutive frames that agree, or the frames of a
    recording (`voice-sheet-loading.cjs` with `VIDEO=1`, below). Compare
    resting frames with resting frames, or 1314 with 1314.
- **The voice sheet's loading state after a cold start can be shorter than one
  screenshot.** Measured 2026-09-22 in three cold starts: in the two that were
  recorded, the Voices arrived 0.5 s and 1.0 s after the sheet came to rest
  (the #24 run saw about 5 s), and each `simctl io screenshot` took 0.4–0.6 s,
  once 1.1 s. A burst caught the loading state at rest in one frame, one, and
  two. Record the screen instead (`VIDEO=1`): `ffmpeg` or `cv2.VideoCapture`
  reads every frame, and the recording keeps the device's 1206×2622 pixels.

### Screenshots of the reading page

- **Paint an earlier run left on the screen is still there when the next run
  starts, in the same place.** Stale paint stays until something repaints its
  area, so a probe that ran the same sequence again saw its predecessor's strip
  and counted it as its own: a run with the trigger removed still read RED
  (2026-09-22, #35). Fix: begin every run with a fresh render,
  `rendition.display(0)` in the reader or a reload in Safari, and photograph that
  baseline once to see it clean.
- **A thin region of highlight colour is not always a strip.** Inside a
  highlighted word, the counter of an `e` or a `q` is amber cut off from the
  rest of the word by the glyph's strokes, 9 to 31 px tall at Font Size 28, and
  a detector that sorts regions by height reports it as stale. Ignore a region
  that lies inside a word's box, as `leading-strip.py` does.
- **A strip on the same line as the held word merges into it if the detector
  groups pixel rows.** Grouped by rows, the 6 px strip above "He" and
  "completed" beside it made one 102 px band that read as the held word, and the
  run as GREEN. Group connected regions instead, and hold on a word on another
  line.
- **A RED from `leading-strip.py` can be React Native's own LogBox, not a
  strip.** Symptom (2026-09-22, #35, iPhone 16 simulator): a STALE region at the
  same y 2342..2395, x 72..125 on every affected run, colour ~(250,186,48),
  whatever sentence or line height was under test. Cause: any `console.warn` or
  `console.error` from the app's own JS (not the reader's WebView) opens the
  "Open debugger to view warnings." banner, whose amber "!" icon falls inside
  the detector's colour threshold; the banner is global app state, so it
  outlives a `shut`/`open` reader cycle and every later screenshot reads it as a
  stale strip until something clears it. Met from two unrelated triggers here: the
  `injectedJavaScript` race below, and React Native's own `Sending
  onAnimatedValueUpdate with no listeners registered` during rapid automated
  `shut`/`open` cycling — neither related to the highlighter. Fix: `xcrun simctl
  terminate` then `launch` the app to clear LogBox; the same probe read GREEN
  immediately after that restart, no code change. `leading-strip.py` now tells
  the icon apart by its blue, 48 all over the icon against 2 to 5 in the word
  colour, and reads that same screenshot as GREEN; restart anyway, since the
  banner covers whatever is under it. A screenshot showing the actual reading
  text is still worth reading by eye — the true strip and this false one look
  nothing alike once you see them.
- **`do:"js"` sent right after `do:"open"` can race the WebView's own bridge.**
  Symptom (2026-09-22): Metro logged `WARN Error evaluating injectedJavaScript:
  ... TypeError: undefined is not an object (evaluating
  'window.ReactNativeWebView.postMessage')` and the harness's answer was "no
  answer from the reader" (INVALID), although the Document had visibly finished
  opening. Not reproduced on an immediate retry with the same 8 s gap between
  `open` and `js`. Treat one INVALID right after an `open` as worth a retry
  before treating it as a real failure, and check Metro's log for this WARN when
  it happens — it is also what leaves the LogBox banner above.

- **`leading-strip.sh app` reaches the probe but the detector fails with
  `ModuleNotFoundError: No module named 'PIL'`.** Symptom (2026-09-22): the
  Metro log contained `PROBE leading strip probe started` and `app.png` was
  written, but `leading-strip.py` exited before classifying it. Cause: the
  active `/usr/bin/python3` is Xcode's Python 3.9 without Pillow installed.
  Fix: install Pillow into that interpreter with `python3 -m pip install --user
  Pillow`, then rerun the detector or the complete `leading-strip.sh` command;
  the app-side probe itself does not need to be repeated when its screenshot is
  already present.

### The walkthrough harness (`Documents/harness.json`)

- **A command does nothing.** Each command needs a new `seq`; the same `seq` twice runs once.
- **Waiting for an `HX` line hangs.**
  - Cause: only an open reader logs on a timer. The Library logs only when a command answers.
  - Fix: wait for the effect itself, such as a file being written or the answer to `navstate`.
- **`known` in the status line right after a resume does not say which sections
  have reported.** #51 was filed with "spine item 20 never rendered", from a
  status line of 122 Utterances. The same reopen repeated on 2026-09-23 at 19:24
  showed `known=179` a second later. A Contents jump to item 20 then answered
  at once, with `utterance=122` and `known` still 179, which means item 20 had
  reported its 57 Utterances before the jump. To tell whether a section has
  reported, jump to it with `{"do":"section","section":N}`. A section that has
  reported answers at once and leaves `known` as it was.
- **A `js` answer reads as empty or cut off.**
  - Cause: it arrives in Metro's log as `note="The highlight could not be drawn: PROBE …"`, JSON-escaped and cut at 500 characters.
  - Fix: parse the quoted string after `note=` as JSON instead of grepping up to the next `"`, and keep answers short.
- **Two readers answer.** `open` pushes a reader on top of any reader already open, and every mounted reader answers `js`. Send `shut` first.
- **The Library shows two Documents with one title.** `add` names the entry after its file in `Documents/Inbox/`. Give each copy its own file name, and open by Document Id when titles collide.
- **An old probe looks like a new error.** A `js` answer stays in the reader's notice as "The highlight could not be drawn: PROBE …" until the reader is opened again.
- **A screenshot taken right after a GREEN `follow-probe.cjs` run still shows a red "could not be drawn: PROBE …" banner.** Not a stale leftover this time: the script's own `read()` is itself a `js` command, and `reading-view.tsx`'s `js` handler posts *every* answer — success or not — through the same `openreader:problem` channel a real highlight failure uses, prefixed `PROBE `. So the banner in the screenshot is the script's own measurement being echoed back, not a defect; `follow-probe.cjs` already excludes it from its own GREEN/RED verdict (`detail.indexOf('PROBE') !== 0`), and the embedded JSON's own `"problems":[]` says the same. Measured 2026-09-23 verifying #50: a run scored GREEN (no problem posted, Utterance on screen) while the very screenshot taken immediately after read "The highlight could not be drawn: PROBE {...}". Trust the script's verdict (or grep the log for `could not be drawn` lines that do **not** contain `PROBE`) over a screenshot's banner text, and note in a report that the banner is the harness's own artifact when it appears after a passing run.
- **The title `add` gives an entry lasts only until the book's first open.**
  `add` names the entry after its file (`fixture-phone-129`), and the reader's
  first open retitles it from the EPUB's own metadata (`ZTTS Positions
  2026-09-22 Fixture Phone`, measured 2026-09-22). A probe's `BOOK_TITLE`
  matches `label BEGINSWITH`, so the file name finds the row for the first
  open and only the metadata title finds it afterwards.
- **A stale `harness.json` replays on every reader remount, not only on app
  launch.** The documented `seenRef` reset (below, "The walkthrough harness
  re-runs its last command on every launch") also happens on a plain
  Back-then-reopen: `useHarnessCommands` lives inside the reader screen, so a
  fresh mount gets a fresh `seenRef` starting at -1 and replays whatever
  `harness.json` still holds. Measured 2026-09-22: reopening a reader with a
  three-runs-ago `scroll-theme.cjs` command still on disk logged `WARN Error
  evaluating injectedJavaScript: … TypeError: undefined is not an object
  (evaluating 'window.ReactNativeWebView.postMessage')` on each reopen — the
  injected script's own `window.__scrollTheme` no longer existed in the fresh
  WebView, and even its `catch` block's `postMessage` call ran before the
  bridge was ready. `rm Documents/harness.json` after a command has answered,
  not only before a relaunch.
- **A stale `{"do":"section"}` replayed on a fresh mount can race the
  library's own `initialLocation` bootstrap and swallow the very next real
  tap.** Measured 2026-09-24 verifying #54/#55 (`SyncProbe.swift`,
  `testPendingPlacePlayWaitsOnReopen`/`testPendingPlacePauseWhileWaiting`): a
  method that jumped to a deep section with `{"do":"section"}`, then left the
  reader and reopened it (a second fresh `ReadingView` mount, whose `seenRef`
  also starts at -1 — the pitfall above is true of a remount, not only a
  relaunch), replayed that same stale command right as the reopened book's
  own stored place was loading via `initialLocation`. Metro logged `Error
  evaluating injectedJavaScript: … ReferenceError: Can't find variable:
  rendition`, and that `console.warn`-equivalent raised React Native's "Open
  debugger to view warnings." banner over the floating player — the exact
  overlap this file's XCTest section already documents for a Play tap — which
  then swallowed the *next* method's tap: once a real `Back` tap that never
  reached the Library (`XCTAssertTrue failed - Back did not reach the
  Library`, with a harness `{"do":"shut"}` proving the navigation itself was
  fine seconds later), once a real `Pause` tap whose reading kept playing
  unpaused for the rest of the run because the tap landed on the banner, not
  the button underneath it (a screenshot taken mid-run showed the banner
  sitting over the transport, `Annelie - Female Afrikaans` visible above it).
  Both symptoms stopped once `Documents/harness.json` was deleted again
  immediately before the reopen, not only once at the run's own start — a
  real reopen never carries this file, so a probe reopening one must clear it
  at exactly the moments a real reopen would find it absent.
- **`Scroll Fixture`'s Contents rows cannot be followed, although its
  navigation document sits beside its package document.** Opening Contents on
  it showed "None of these rows names a file in this book. The contents live
  in a different folder from the pages, which this app matches by name — so
  the list can be read but not followed," and a real tap on a `Chapter 3:` row
  found no such button. The folder is not the reason here. Read in the
  reader's WebView on 2026-09-22, epub.js hands this EPUB 3 navigation
  document's hrefs over with a leading slash — `book.navigation.toc` gave
  `/contents.xhtml`, `/ch001.xhtml`, `/ch002.xhtml` — while `book.spine`
  gave `contents.xhtml`, `ch001.xhtml`, `ch002.xhtml`, so no row matches
  (`core/document/contents.ts` compares the two as strings). Do not assume a
  generated fixture's Contents are followable from reading its generator;
  check the sheet's own banner. `{"do":"section","section":N}`
  (`reading.goToSection`) jumps to a spine index directly and is unaffected —
  a cleaner substitute than `Player.onSkip` calls for reaching a specific
  chapter's top on a Document whose Contents cannot be followed.

### XCTest

- **A SwiftUI menu row is an `Other` until it has the button trait.** A row
  built on `ChoiceMenu` (ADR 0035) is one accessibility element made with
  `accessibilityElement('ignore')`, which starts with no traits, so on
  2026-09-22 `app.buttons` could not find `Alignment, Justify` and XCTest
  listed it as `Other`. `ChoiceMenu` adds `isButton`; if a row built some other
  way is missing from `app.buttons`, look for it with
  `descendants(matching: .any)`. The open menu's items are `Button`s whose
  `identifier` is the SF Symbol (`text.alignleft`, `sun.max`) and whose label is
  the title, and the checked one `isSelected`.
- **A relaunch lands in the last reader instead of the Library.** That is state restoration. Tap `Back`, if it exists, before looking for Library rows.
- **Back-to-back `-only-testing` runs against the same live app inherit
  whatever screen or sheet the previous run left**, since a new `xcodebuild
  test` invocation's `app.activate()` foregrounds the process as-is rather
  than relaunching it. Measured 2026-09-22: a method written to start from
  Library (open the book, `More actions` → `Download`) was run right after an
  earlier method that had deliberately left the Download sheet open over the
  reader; `More actions` was never found (it is behind the open sheet), and
  the next line failed with "No matches found for … 'Download'". `xcrun simctl
  terminate` + `launch` between runs (not just `app.activate()` inside the
  test) restores the known starting screen; a method that must tolerate
  either starting point should check for a sheet-specific element first.
- **A tap right after the reader opens hits a blank page.** The header and "More actions" exist before the Document is laid out. Wait for `Play` or `Choose a Voice`, then for "Laying the document out…" to go.
- **Waiting for "Laying the document out…" never waits.** It is the label of the WebView's scroll view, an `Other`, not a static text. Query `app.descendants(matching: .any)`.
- **A cold launch straight into 仙逆 takes over 40 seconds to lay out.** A warm open takes 3–6 seconds. Time tests from a warm open.
- **A coordinate tap on text does nothing.** It landed between two lines, which the reader treats as blank space by design. Take the point from a screenshot of the middle of the line.
- **One tap on `Pause` is not always a pause.** Measured 2026-09-21: a tap three
  seconds after Play left the reading running — no pause handler, no `pause`
  sync run, and the reading went on to the end of the book while the probe sat
  in its fifteen-second wait for `Play` to come back. The same one-tap pause had
  worked in the two runs before it. Tap, wait for `Play` to exist, and tap again
  (`SyncProbe.testSeekAwayAndBack` does it four times at most), and treat a run
  whose transport still says `Pause` as a failed measurement, not a slow one.
- **A timed tap cannot be aimed at a window a few hundred milliseconds wide.**
  Issue #20's claim rule needs a real tap between "an adopted place is pending"
  and "the section it names has rendered". Against the owner's own folder that
  window is inside the 1.40 s measured from `app.activate()` to the highlight
  landing (2026-09-21), network round trip included, and one `.tap()` on a
  coordinate took **1.60 s** to dispatch — wider than the window it was aiming
  at. Point `sync.url` at the stalling stub (`slow-webdav.py`, **Against the
  owner's real folder** below) instead: the stub decides when the place
  arrives, so the tap can be scheduled against its delay.
- **`press(.home)` pokes a sync of its own, so a timed tap's clock starts
  there.** `shell.tsx` pokes on `background` as well as on `active`, and
  single-flight coalesces the activation's poke into the run the Home press
  already started. With a 6 s stall the place therefore arrived ~6.1 s after
  **Home**, not after `activate()` three seconds later; a delay measured from
  the activation missed by the whole three seconds.
- **A tap that lands too early looks exactly like the claim rule failing**, so
  say which one happened. The tell is `status.resume`: `abandonResume` shows the
  sentence a *failed* resume left behind ("The sentence this book was left on is
  not in the text that has rendered…"), which only exists once the place has
  arrived and missed. A tap before the place arrives clears nothing, leaves
  `resume` null, and the place then wins — the same screen as a broken claim
  rule, from the opposite cause.
- **A chip is not a `.radioButton`.** The voice sheet's provider and locale
  chips have `accessibilityRole="radio"`, and
  `app.descendants(matching: .radioButton)` found none of them on iOS 27.0.
  Find a chip by its label (`label == 'en-US'`), as `ReaderProbe` does.
- **`Back` is not what the back button is called.** It is named after the screen
  behind it: the Sync screen's is `Settings`, the Settings screen's is `Library`.
  Only the reader's is `Back`. A book handed over with `simctl openurl` is pushed
  onto whatever stack is on screen, so a reader opened over Settings goes back to
  *Settings*, and `app.buttons["Back"]` then finds nothing — the run reports
  "… is not on the shelf" for a book that is on the shelf. Walk towards the
  Library by something the Library has (`label BEGINSWITH 'Actions for '`), tap
  `app.navigationBars.buttons.element(boundBy: 0)` rather than a label, and
  relaunch the app when there is no back button left (`SyncProbe.openBook`).
- **iOS's own "Save Password?" AutoFill prompt is not in the app's
  `XCUIApplication` tree at all**, and it blocks whatever a query against that
  tree tries next. Raised once after `clearAndType` submits a *new* secure
  field (`testEnterFolderAndSwitchOn`'s Password), it sits over the Library
  the next time the app is queried and made one run's `statusLines` (`app.
  staticTexts.allElementsBoundByIndex`) fail with `Failed to get matching
  snapshot: No matches found for Element at index 2 …` — an accessibility
  snapshot mismatch, not a missing element, because the system sheet was
  mutating the tree out from under the query. It belongs to a system process,
  reached the same way `UIA.MediaControls.NowPlaying.CenterButton` is: a
  second `XCUIApplication(bundleIdentifier:)` for whichever process owns it —
  `com.apple.springboard` answered `Not Now` reliably here; try
  `com.apple.PasswordBreachSheet` and
  `com.apple.AuthenticationServicesUI.AutoFillPromptUI` too, since which
  process actually owns the sheet was not pinned down further. Call before any
  whole-tree query after a first-time password submission; harmless the rest
  of the time, since it waits at most a couple of seconds per candidate and
  moves on when none exists.
- **A probe's expected list can go stale when the app's own list changes.**
  `GeneralFontsProbe.testFontsPageListAndBackButton` still asserted all eleven
  Fonts-page names, four of them CJK (`苹方`, `宋体`, `楷体`, `圆体`), and failed
  with six `XCTAssertTrue` failures (2026-09-22, independent #32/#33
  verification) naming exactly those four as missing. The app is not wrong:
  `READING_FONTS` in `highlighter.ts` dropped those four in `01ab1c2` (#12,
  2026-09-21), predating this probe failure and untouched by #32/#33's diff —
  three of the four do not resolve as distinct faces on this runtime
  (`UIFont.familyNames` has only PingFang of the four), so the rows were
  removed rather than left doing nothing (see the comment above
  `READING_FONTS`, and ADR 0029). The element tree confirms it: the Fonts
  `ScrollView`'s own accessibility label reads "Vertical scroll bar, **1
  page**" with exactly the current seven `Button`s inside it (`Original Book
  Font`, `System`, `Georgia`, `Times New Roman`, `Palatino`, `Avenir Next`,
  `Helvetica`) — there is nothing further to scroll to, so the `swipeUp()`
  that follows the missing-row assertions produces a byte-identical
  accessibility tree, which reads exactly like a broken gesture and is not
  one. `test/manual-test/README.md`'s own **Font Size against Documents…**
  section still says "nine named `preview` faces" for the same reason: prose
  the code has moved past. Treat a Fonts-page name mismatch as a probe/doc
  staleness question first — diff the failing names against `READING_FONTS`
  — before suspecting the row under test; fixing the probe's expected list
  (or the stale README prose) is a separate, already-scoped change, not
  something to fold into an unrelated feature's verification.
- **A real, accessibility-matched tap can land on a debug overlay instead of
  the button underneath.** Measured 2026-09-22 verifying #34: `app.buttons["Play"].tap()`
  resolved and reported success (the test passed), but nothing played — no
  `playing=true` HX line anywhere in Metro's log, no Fish request attempted —
  because React Native's own "Open debugger to view warnings." banner (raised
  earlier by the stale-harness JavaScript exception two bullets below) sits
  over the floating player, and its rectangle (`{{10.0, 786.7}, {382.0, 67.3}}`
  in points) overlaps the Play button's (`{{166.0, 793.7}, {56.0, 52.0}}`).
  XCUITest's `.tap()` dispatches a physical touch at the resolved element's
  screen point; whatever the OS hit-tests there receives it, accessibility
  match notwithstanding. Do not assert only that `Play` reappears afterwards
  — that also holds if Play never started. Assert the transition to `Pause`
  (`app.buttons["Pause"].waitForExistence(...)`) as the proof playback began,
  and dismiss or clear the warning banner (a clean relaunch is the reliable
  way) before trusting a Play tap near it. The same banner swallowed a tap on
  the playback speed (the number at the right end of the player row) on
  2026-09-23, after a fixture reader was opened; the relaunch cleared it, and
  state restoration reopened the same reader.
- **`offline-fix.sh`'s `-only-testing` argument is the bare method name; the
  script prepends the class itself.** Passing
  `-only-testing:OfflineFixProbe/testConfigureFishProvider` (reasonable by
  analogy with `reader.sh`'s own `-only-testing:LockScreenProbe/…/testX`
  examples elsewhere in this file) doubles the class —
  `LockScreenProbe/OfflineFixProbe/OfflineFixProbe/testConfigureFishProvider`
  — which matches no test. Measured 2026-09-22: `xcodebuild` still exited 0,
  in under a tenth of a second, having run nothing. Exit 0 is not evidence of
  a pass here; use the README's own documented shape,
  `-only-testing:testConfigureFishProvider`, and confirm a real duration
  (seconds, not milliseconds) and an assertion count in `test.log`.

- **`download-ring.sh` has the same bare-method `-only-testing` contract.**
  Passing `-only-testing:DownloadRingProbe/testReopenDownloadDrawer` makes the
  runner prepend the class a second time, yielding
  `LockScreenProbe/DownloadRingProbe/DownloadRingProbe/testReopenDownloadDrawer`;
  Xcode exits 0 after reporting zero executed tests. Measured 2026-09-22 while
  restoring the final simulator screen. Use the documented
  `-only-testing:testReopenDownloadDrawer` form, then confirm the test log shows
  the method running and not only `Executed 0 tests`.

- **Calling `xcodebuild` directly, not through one of the wrapper scripts,
  needs the full `TARGET/CLASS/METHOD` path.** The wrapper scripts' own bare
  method name (above) works only because each one prepends `LockScreenProbe/`
  itself — `project.rb` always names the generated target `LockScreenProbe`,
  whatever probe source file is added to it. Passing
  `-only-testing:PausedTransportProbe/testPlayAfterIdlePause` straight to
  `xcodebuild` (no wrapper script) failed at once (exit 70): `Tests in the
  target "PausedTransportProbe" can't be run because "PausedTransportProbe"
  isn't a member of the specified test plan or scheme.` Measured 2026-09-23.
  Fix: `-only-testing:LockScreenProbe/PausedTransportProbe/testPlayAfterIdlePause`.
- **`-resultBundlePath` refuses a path a previous attempt already created,**
  including a failed one — exit 64, `Existing file at -resultBundlePath …` —
  the same "use a new artifact directory" rule the wrapper scripts enforce for
  their own output directories, but it applies to a bare `xcodebuild` call
  reusing one fixed path across retries too. `rm -rf` the stale
  `.xcresult` (or pick a new path) before retrying.

- **A Settings-stack screen can be more than one level away, even when it
  looks like one.** Reaching Fish Audio's provider form is Library → Settings
  → Providers → Fish Audio, three pushes. Until #48 each back button was named
  after the screen behind it (`Library`, `Settings`, `Providers`); since #48
  every one shows the arrow alone and is labelled `Back`, like the reader's
  (measured 2026-09-23, `DesignShotsProbe.testBackButtonLabels`), so the label
  says nothing about how deep the stack is. Tapping `app.navigationBars.buttons.element(boundBy:
  0)` exactly twice after enabling Fish Audio (assuming Settings → Providers →
  Fish Audio, two levels) landed on **Settings**, not Library (measured
  2026-09-22, `DownloadRingProbe.testDownloadRingLifecycle`): the next line
  then failed with "No matches found for … 'A Short Test of Reading Aloud,'".
  Fix: walk back with a bounded loop against something only the Library has
  (`label BEGINSWITH 'Actions for '`, the same marker `SyncProbe.openBook`
  uses), not a fixed tap count.
- **A successful Settings version probe leaves the app on Settings.** On
  2026-09-22 `settings-version.sh` passed, then a Library-based download probe
  could not find `More actions` because the accessibility tree still showed
  Settings. Relaunch OpenReader before the next Library-based probe, or tap
  Settings' `Library` navigation button explicitly.
- **A manual probe can retain an old beta literal.** On 2026-09-22
  `DownloadRingProbe` still required `Version 0.0.2-beta4` while the working
  tree and Settings screen were at beta8, which would fail after the download
  assertions had already passed. Update the probe's explicit version assertion
  whenever `app-version.ts` receives the next beta; a simulator XCTest must not
  read the host checkout at runtime to infer it.
- **The provider-order probe can inherit an enabled provider from app data.** On
  2026-09-22 the replacement run read `Fish Audio, enabled` after a previous
  session had configured Fish, while the probe expected every provider to be
  disabled and stopped before its Azure screen assertions. Use a fresh simulator
  or disable the retained provider through the app before treating that mismatch
  as a product failure.
- **A completed-fixture probe can start with only part of the fixture saved.**
  On 2026-09-22 the download simulator showed `1 chapters downloaded` and the
  catalog held 10 of 17 clips, so a probe requiring `2 chapters downloaded`
  failed before exercising its target control. Inspect the drawer first, then
  complete the missing chapter with `offline.sh ... download` or use a probe
  whose expected count matches the fixture; back up and restore the offline
  directory when the run must preserve the starting state.
- **A failed XCTest can remain in `simctl diagnose` long after its assertions
  finish.** The failed partial-fixture run left `xcodebuild` in the diagnostic
  phase with `--timeout=600`, blocking the wrapper for several minutes. Once
  the failure and its artifacts are captured, stop that exact `xcodebuild` and
  diagnostic process rather than treating the delay as an app hang.
- **A probe assertion can encode the very behavior a feature intentionally
  changes.** `OfflineProbe.swift`'s `management` mode deleted "The First
  Chapter"'s saved audio and then asserted `label == 'The First Chapter'`
  still existed — true under the old Manage downloads (list every chapter,
  issue #37's own problem statement) and false once Manage lists only
  chapters with saved audio: the row is unlisted outright, not left
  undecorated. Measured 2026-09-22: `XCTAssertTrue` failed on exactly that
  line, immediately after the same run's delete and its "saved" wait both
  passed, so the delete itself worked. Fixed by asserting the opposite (the
  row's plain and `, downloaded` labels both gone; its sibling's `,
  downloaded` label the only one left) rather than reading the failure as a
  regression in the new code — the same staleness question as
  `GeneralFontsProbe`/`READING_FONTS` above, this time in a probe rather than
  in the app.

- **A dynamic note's `BEGINSWITH` query can match the screen's own nav-bar
  title instead of the note.** `provider-screen.tsx`'s connection note and the
  pushed screen's title are both plain `StaticText`s, and `app.staticTexts` is
  unscoped: on 2026-09-22, `NSPredicate(format: "label BEGINSWITH 'Azure'")`
  against `app.staticTexts` matched the nav bar's title ("Azure") every time,
  so `AzureProviderProbe`'s wording assertions all read back the single word
  "Azure" instead of the real sentence below the Test connection button.
  Scope the query to the screen's own container instead, e.g.
  `app.scrollViews.staticTexts`, which excludes the navigation bar.
- **`.exists` right after a navigation tap can read `false` on a state that
  is actually `true`.** A helper checked `app.staticTexts["Enabled"].exists`
  immediately after tapping a Providers row and, on 2026-09-22, read `false`
  for a provider that actually was enabled — the screen had not finished
  settling from the tap. The helper then skipped disabling it, and every
  following `typeText` into the still-locked API key field failed with
  "Neither element nor any descendant has keyboard focus." Read the control's
  own state instead, with a wait: a `Switch`'s `.value` (`"0"`/`"1"`) via
  `XCTNSPredicateExpectation`, not an unretried `.exists` on a label whose
  appearance depends on a screen transition.
- **Since #48 a provider's switch label is always `Enabled`, so waiting for it
  proves nothing.** Before #48 the label read `Disabled`, `Testing…` or
  `Enabled`, and probes waited for `app.staticTexts["Enabled"]` after tapping
  the switch. With the label fixed, that query matches at once, before the
  connection check has even started. Wait for `Turn off to edit.` instead,
  which is drawn only once the check has passed and the provider is enabled,
  then read the switch's `.value`. Likewise `Test connection` keeps its label
  while the check runs, and is disabled instead: wait for its `isEnabled`, not
  for its label to leave `Testing…`.
- **`continueAfterFailure` defaults to `true`, so one wrong assertion
  cascades silently through the rest of the method.** Combined with the note
  above misreading every wording as "Azure", `AzureProviderProbe`'s first run
  logged five failures and kept going regardless, including tapping Enable at
  the end — which is why the run still ended in a real `Enabled` state
  despite failing every assertion along the way. For a probe with several
  sequential, state-dependent steps, set `continueAfterFailure = false` in
  `setUpWithError()` so a genuine failure is reported where it happened
  rather than many steps later, with everything after it unproven.
- **A masked field can screenshot as completely blank right after an
  Enable/Disable transition, even though it holds the saved value.**
  `XCUIScreen.main.screenshot()` taken in the same instant as a `Switch`
  toggling captured Azure's API key `SecureTextField` with no dots and no
  `Not set` placeholder — on two separate runs, 2026-09-22. A plain
  `xcrun simctl io … screenshot` taken moments later, nothing else changed,
  showed the correct masked dots. Before treating a blank masked field as a
  lost or uncleared value, take a second, plain screenshot outside the XCTest
  capture to rule out this rendering race.

- **`xcodebuild … test` can stay alive long after its test has finished.**
  Measured 2026-09-23: `design-shots.sh`'s dark run wrote "Executed 1 test, with
  1 failure" to `test.log` at 17:50:36, and its `xcodebuild` was still running
  more than ten minutes later with nothing more written. Killing it ends the log
  with `** BUILD INTERRUPTED **`, and the result bundle then yields no
  attachments: the outcome survives in `test.log`, the screenshots do not. The
  cause is not established; the light run just before it, on the same
  simulator, failed the same assertion and exited at once. Watch `test.log` for
  the `Executed` line, and if `xcodebuild` is still alive a minute after it,
  kill that process and rerun rather than wait.

- **A disabled React Native `Switch`'s XCUITest `.isEnabled` can read `true`
  even though a tap on it does nothing.** Verifying #48's "the whole Voice
  sources card must freeze with the rest once enabled"
  (`ProviderFreezeProbe.testFishVoicesFieldAndEnableDisableCycle`), asserting
  `XCTAssertFalse(manualVoices.isEnabled, …)` right after a real Fish Audio
  enable failed — `isEnabled` read `true` — which looks exactly like the
  freeze not working. It is not: a follow-up method
  (`testVoiceSourcesLockIsFunctionalThenCleanUp`) started from that same live
  state (Fish already enabled, read from the device, not assumed) and tapped
  `Manual voices` for real — its value stayed `0` before and after the tap,
  printed as evidence. `disabled={locked}` (`provider-screen.tsx`) does
  correctly stop the switch from responding; the accessibility `enabled` trait
  XCUITest reads from an RN `Switch` just does not reflect it on this runtime.
  Test a `Switch`'s lock functionally — tap it and compare the value before
  and after — never with `.isEnabled`, the same way a `TextField`'s lock is
  already tested by tapping and checking for a keyboard rather than reading
  its own `.isEnabled` (`GeneralFontsProbe`'s bracket-field check, `isLocked`
  above).
- **`XCTNSPredicateExpectation` created right after `.tap()` can already match
  the state from *before* the tap.** The general form of the pitfall above
  "`.exists` right after a navigation tap can read `false` on a state that is
  actually `true`": here it ran the other way, reading a not-yet-changed
  value as already settled. Measured 2026-09-23: `ProviderFreezeProbe`'s first
  version tapped Sync's switch, then immediately built
  `XCTNSPredicateExpectation(format: "isEnabled == 1", object: syncSwitch)`
  and waited on it — since `.tap()` returns once the touch is delivered, not
  once React has re-rendered `disabled={checking}` to `true`, the expectation
  can observe the *pre-tap* `isEnabled == 1` and fulfil immediately, before
  the check has done anything. The method then read the switch's `value`
  (still `"0"`, true either way for a check that has not — or has — failed)
  and the footer text (found none yet, so it fell through to "Folder", the
  next card's own title, misread as the refusal) as if the check had already
  settled. Fix: wait for the busy state to *begin* first
  (`isEnabled == 0`) before waiting for it to end, or wait on a second,
  independent control the same operation disables (`AzureProviderProbe`
  and `ProviderFreezeProbe`'s provider checks wait on `Test connection`, a
  separate row, for exactly this reason — Sync's switch has no such second
  control, which is why it needs the extra step).
  `ProviderFreezeProbe.testSyncRefusalPathAlone` does both fixes and is the
  one to reuse.
- **A Sync refusal in a probe can come from mistyped text, not the network.**
  Measured 2026-09-23: `ProviderFreezeProbe.testSyncRefusalPathAlone` typed
  `https://openreader-test-unreachable.invalid/dav` into Sync's Address and got
  `The WebDAV URL must start with http:// or https://.` after 34 s. Its
  screenshot shows the field holding `h://openreader-test-unreacha…`: the first
  ten-character chunk, typed straight after the field was emptied with its clear
  button, lost `ttps`, the controlled-field typing race described above. So that
  refusal never reached the network. An earlier run of
  `testFailurePathsNoCredentials` with the same address took 2350 s end to end,
  during an outage that also cut off the testing agent's own connection
  (`ENOTFOUND`); its cause was not isolated. The app's check itself is bounded:
  `use-sync.ts`'s `check()` is one PROPFIND through `createWebDAVClient`'s
  `request()`, which wraps every fetch in `withTimeout` at `WEBDAV_TIMEOUT_MS`,
  15 s. Read the Address back, from a screenshot or `settings.json`, before
  believing a Sync refusal.

### Measuring inside the reader's WebView

- **`performance.now()` is coarsened to 1 ms.** Time N repetitions and divide.
- **Computed sizes include text-size-adjust on an iPhone, and not on an iPad in the desktop content mode.** Divide by the percentage in effect only where it applies (ADR 0030).
- **A probe's own root-only text-size-adjust rule loses to the app's.** The app declares text-size-adjust on every element in `#openreader-highlight`. Take those lines out for the probe and put them back afterwards.
- **`rendition.on('rendered', …)` never fires for a probe either.** The library's template registers its own `rendered` listener first, it throws on every section, and epub.js's emitter stops there (#34, ADR 0036). A probe that counts `rendered` reads 0 however much renders. Use `rendition.hooks.content.register`, which runs for every displayed section, or read the views (`rendition.manager.views.all()`).
- **A regex inside a probe's template literal loses its backslashes.** In a `.cjs` script the WebView code is a template literal, where `\d` cooks to `d`: `/^(\d+)/` reached the WebView as `/^(d+)/`, matched nothing, and an event history came back empty rather than failing. Write `\\d` in the script's source.
- **`scrollTop = 0` does not take the page away from the reading.** It goes to the top of the first view. epub.js answers by prepending the section above, scrolling down by its height so the text stays where it was, and trimming the new sections again about 350 ms later. Measured 2026-09-23 at 19:48: twelve of them left the views at `[5, 6, 7]`. Scroll in relative steps (`scrollTop -= 1500`), as `follow-probe.cjs` does. Five `scrollTop = 0`s did walk the page up at 19:26, from a different starting place, so do not rely on either result.
- **A display's promise resolves as the section's iframe starts loading, not when the section is on the page.** For every load request that is not its main document, `@epubjs-react-native/core`'s `onShouldStartLoadWithRequest` calls `goToLocation(url)`. A section's `srcdoc` iframe is one, so the library itself runs `rendition.display('about:srcdoc')`, and epub.js's `Rendition.display` resolves the display in flight whenever another is asked for (measured 2026-09-23, 19:53, by recording a stack for it). A probe that waits on `rendition.display(…).then` reads the page before the section is there. Wait for the content hook, or for the queue to empty, instead.
- **Resetting the page with `rendition.display()` while epub.js's queue is still busy left the queue stuck for good.** Measured 2026-09-22 at 12:30: after four back-to-back flings the manager's queue held 17 tasks with `running` true, nothing it held ever ran, and every later fling moved nothing (`scrollTop` 0, one view), which reads as the page refusing to scroll rather than as a stuck queue. Wait for `!rendition.manager.q._q.length && !rendition.manager.q.running` before a reset, and treat a queue that does not empty as its own finding; `scroll-theme.cjs` does both.
- **A screenshot taken right after a reader remounts can be blank even though
  the DOM underneath is already styled and has its text.** Measured
  2026-09-22 verifying #34: after leaving the reader and tapping a Library row
  to reopen it (a fresh `WKWebView`, not the same one Appearance/Font Size
  reflow), `waitForLayout`'s signal — React Native's "Laying the document
  out…" placeholder gone — had already cleared, yet two screenshots taken
  right after came back page-coloured with no glyphs at all, in both themes.
  A same-second harness `js` audit of the WebView found the section's
  `#openreader-highlight` style installed and its text present
  (`bodyRect=[27,7112]`, `text="Chapter 26: …"`), and a screenshot taken about
  two seconds later than the first pair showed that same text correctly
  painted. React Native's placeholder tracks the app's own readiness, not
  whether WebKit has actually composited a frame after a brand-new
  `WKWebView` is inserted; the two are not the same signal. Add a second or
  two of settle time after reopening a reader (not needed for
  Appearance/Font Size changes to an already-visible WebView, which repaint
  promptly) before trusting a screenshot of it.

### Typing, environment and silence

- **`typeText` with a long value kills a settings screen.**
  - Symptom: a red box, `Render Error — Maximum update depth exceeded`, and the
    next query answers `No matches found for Descendants matching type
    TextField`. The value typed so far is in `settings.json`, truncated.
  - Cause: every keystroke calls `setSettings`, which writes `settings.json` and
    re-renders the controlled `Field`; one `typeText` delivers a hundred
    characters with no gap between them, far faster than a person types, and
    React ends the nested-update chain. **Not specific to any one screen**: the
    same 107 characters kill `main`'s provider Address the same way
    (`SyncProbe.testTypeLongIntoProviderAddress` is the control).
  - Fix: type in chunks of ten (`SyncProbe.clearAndType`). Chunking is a
    workaround for a machine typing faster than a person, not a fix.
- **Backspaces do not reliably clear a controlled `Field`, and a half-cleared
  address is invisible.** Measured 2026-09-21: `clearAndType` typed the same
  88-character address over the 88-character one already there and left **155**
  characters in the field; a second attempt with 300 backspaces left **221**,
  with the path doubled (`…/sync/zotero-tts/xujialiu.top/…/sync/zotero-tts//`).
  The keystrokes race the re-render the pitfall above describes, so the caret is
  not where the backspaces think it is. What makes this expensive is that the
  app then syncs against a folder that does not exist, and **that looks exactly
  like a folder with nothing in it**: the switch's check accepts a missing folder
  by design, the status line says `Synced at …`, nothing is adopted and nothing
  is uploaded. An hour was spent reading `use-library.ts` for a bug that was in
  the typing. After any run that types an address, read it back —
  `python3 -c "import json;print(json.load(open(D+'/Documents/settings.json'))['settings']['sync']['url'])"`
  — and compare it with the value you meant to type before believing any sync
  result. The probe now asserts the field is empty before it types.
  Measured again 2026-09-23 on #48's field rows: a tap on the middle of a
  62-character address followed by 100 backspaces left its tail, from
  `.com/remote.php/…` on. The caret lands where the tap does, and a backspace
  deletes only what is before it, so no count of backspaces is enough on its
  own, and tapping the field's far end first does not help either: a value
  longer than the field scrolls, and the far end of the field is not the end of
  the text (four such passes left 49 of a doubled address). Since #48 every
  settings field has the phone's own clear button while it is being edited, and
  `SyncProbe.clearAndType` and `DesignShotsProbe.clearAndType` tap
  `field.buttons["Clear text"]` instead, then assert the field is empty.
- **`xcodebuild … test` does not pass the caller's environment to the test
  process.** `PLAY_SECONDS=12 bash sync.sh …` silently uses the probe's default,
  and a run "of twelve seconds" is really five. Pass parameters in a file the
  probe reads instead (`/tmp/openreader-sync-params.txt`, `SyncProbe.param`).
- **The walkthrough harness re-runs its last command on every launch.**
  `seenRef` starts at `-1`, so the first poll after a launch runs whatever
  `Documents/harness.json` still holds. A `settings` patch sent half an hour
  earlier silently rewrote the Sync settings of an app that XCTest had just
  relaunched, and the run that followed measured the wrong thing. `rm
  Documents/harness.json` before every relaunch, and treat a leftover harness
  file as device state.
- **Muting the Mac is not silencing the simulator, and the Mac's mute comes back
  on its own.** After a `simctl shutdown`/`boot` cycle and a series of XCTest
  runs, `osascript -e 'get volume settings'` reported `output volume:56, output
  muted:false` although it had been muted earlier in the session — and the next
  Play was audible. The machine's volume is the owner's, not the test's: it is
  restored by things outside the run, and muting it takes the owner's sound away
  for as long as the run lasts and after it. Silence the device instead, with
  `bash test/manual-test/silence.sh set SIMULATOR_UDID` (above); never
  `set volume output volume 0`.
- **`sim_volume` can go back to 60 without a boot.** Measured 2026-09-21:
  `silence.sh set` read `0` back at 22:43, the device was never shut down or
  rebooted, and at 22:45:36 `audiosettings.plist` was rewritten — 437 bytes
  where the silenced one was 432 — with `sim_volume` at 60 again. A `check`
  half an hour later failed, and the next Play would have been audible. What
  rewrote it was not established; an XCTest run had just finished on that
  device. Again on 2026-09-22 with no XCTest at all: `set` read `0` at 12:02 on
  a device that was never rebooted, and a `check` at about 12:59 found it at
  60; only the app had been terminated and relaunched in between, several
  times. So a boot is not the only thing to `set` after: run
  `silence.sh check SIMULATOR_UDID` **before every Play** and `set` again when
  it refuses, which is what the kit's scripts do and why they do it. Seen again
  on 2026-09-22 on the iPhone 16: `set` read `0` after a boot, and after a
  `simctl terminate` and a `simctl install` over the app, `check` read 60.
  Twice more on 2026-09-23 on a dedicated iPhone 17: `set` read `0` at 20:17
  and the file was rewritten (433 bytes, 60) at 20:21:40 with no boot, no
  XCTest run and no relaunch in between — the app sat idle on a settings page
  while a file it had loaded was edited under a watching Metro; then again
  somewhere in twelve minutes of XCTest runs, appearance switches and another
  edit. Measured one at a time afterwards, an XCTest run and two `simctl ui
  appearance` switches each left the file untouched.
- **A `set` made as soon as the boot finished was undone about 20 s later.**
  On 2026-09-22 `xcrun simctl boot` and `bootstatus -b` returned, `silence.sh
  set` read `0` back, and `audiosettings.plist` was then rewritten at 12:30:51
  (433 bytes, `sim_volume` 60). The `check` before the launch refused two
  minutes later, and the app was not launched. After a boot, give the device
  half a minute before `set`, and `check` right before `simctl launch`, as the
  scripts do.
- **A boot puts the simulator back to 60.** `sim_volume` survives a
  `simctl shutdown` in the file, but the next `boot` rewrites
  `audiosettings.plist` with the CoreSimulator defaults, measured as `0` before
  the shutdown and `60` after the boot. Run `silence.sh set` again after every
  boot, and `check` before every Play; that is what the scripts do.
- **Lowering the volume while the app is playing changes nothing.** With the
  probe already playing, flipping `sim_volume` from `60` to `0` left the audio
  it delivered to the host at peak `0.090000`; the next launch measured
  `0.000000`. The value is taken when an app activates its audio session, so set
  it **before** `simctl launch`, not during a reading.
- **A shut-down device has no audio settings at all.**
  `data/var/run/simulatoraudio/audiosettings.plist` appears at boot, so
  `silence.sh` refuses a device that is not booted rather than silently doing
  nothing.
- **There is no per-app mute on the Mac to reach for instead.** macOS does list
  each simulator app as its own host audio process
  (`kAudioHardwarePropertyProcessObjectList` shows `top.xujialiu.openreader`
  with the device's own path), but `AudioObjectIsPropertySettable` answers no
  for volume and mute on those objects in every scope. They can only be read.
- **DeviceHub's own audio switch cannot be scripted.** Xcode 27's DeviceHub has
  "Enable audio output from devices" in its settings, but it is one switch for
  every simulator, its preferences live in a sandboxed container
  (`defaults write com.apple.dt.Devices …` fails with "Could not write domain"),
  and the process exposes no menu bar to AppleScript: `System Events` answers
  "Can't get menu bar 1 of process DeviceHub. Invalid index." Do not plan a run
  around it.
- **`simctl` has no audio command.** `xcrun simctl io UDID enumerate` prints the
  device's `com.apple.CoreSimulator.Audio.HostRoute` port, its guest-to-host
  routes and the host devices it could use, but `simctl io` can only change
  screens. The route setter (`routeGuestDeviceScope:toHostDeviceUID:…`) is
  private CoreSimulator API, and it only picks which host device receives the
  audio, so it would still need a silent device to point at.
- **`simctl spawn` answered `LaunchdSimError 111` for every runtime binary** on
  the iOS 27.0 device created for this probe — `/usr/bin/uname`, `/bin/ls`,
  both after `bootstatus` reported the boot finished — while `simctl install`
  and `simctl launch` worked on the same device. Treat a 111 as that device's
  problem and reach for `simctl launch` instead of spending time on it.
- **A throwaway iOS app that has no scene manifest dies at launch.** A minimal
  `UIApplicationMain` bundle crashed with `EXC_BREAKPOINT` in
  `__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke`
  on iOS 27.0. Give its `Info.plist` a `UIApplicationSceneManifest` with a
  `UISceneDelegateClassName`, and give the Swift class `@objc(SceneDelegate)` so
  the name in the plist resolves.

### Fish Audio from the simulator

- **The first Fish request after a minute or so of quiet fails with "The
  network connection was lost", and the reading stops.** The reader's note is
  `Fish Audio s2.1-pro-free: cannot reach api.fish.audio (Error: fetch failed:
  UnexpectedException: The network connection was lost. (at
  ExpoModulesCore/Promise.swift:56))`, the same words `breakfetch` imitates, and
  here nothing had broken anything. Measured 2026-09-22 on the iPhone 17: a
  reading's first synthesis failed this way 206 s and again 80 s after the last
  request to the host, and succeeded 45 s and 10 s after one. Through the app's
  own `fetch` with `cdp.cjs`, no key and no playback: a GET answered 200 in
  2.9 s; after 104 s of quiet a POST failed this way about 6 s after it was
  sent; the next POST answered 401 in 0.6 s; after another 102 s a GET answered
  200, but in about 9 s.
  - Cause, established on 2026-09-22 (notes/NOTES_2026-09-22.md, 02:29, and
    #26): Fish's API is reached over HTTP/3, which is UDP, and this Mac's
    Clash Verge Rev (mihomo, TUN mode; `api.fish.audio` resolves to the fake
    address `198.18.0.126`) drops a UDP mapping about 60 s after its last
    packet. A connection reused after that stalls for about 7 s and fails with
    -1005. The system retries a GET on a new connection, so a GET only takes
    longer, and does not retry a POST, which every synthesis is. It happens
    with no key and with nothing else using the account. Whether a phone on
    another network does the same was not established.
  - Fix for a measurement: Play again. A failed Utterance is retried when Play
    is pressed on it, over a new connection. A run that met this is not a
    result about the change under test. Start a timed play within about 45 s of
    the app's last request to the host (a cold launch makes one: the start-up
    voice listing) if the first attempt must count.

### Talking to the owner's WebDAV host from the Mac

- **Every request answers `403` with the body `error code: 1010`, including a
  `PROPFIND` on a folder that is certainly there.** It is not the credentials
  and not the path: Cloudflare is refusing the client by its `User-Agent`, and
  `Python-urllib/3.x` is on its list. An hour can go into re-checking a
  percent-encoded address that was right all along.
  - Fix: send a browser `User-Agent` on every host-side request. With that one
    header the same `PROPFIND` answered `207`. The app itself is never affected
    — `fetch` on iOS sends its own agent.
- **A raw non-ASCII path segment in the URL raises before the request is even
  sent.** The owner's real Sync Folder has a Chinese path component; a bare
  `urllib.request.Request(url, …)` built from it fails with
  `UnicodeEncodeError: 'ascii' codec can't encode characters …` inside
  `http.client.putrequest`, for every method, before any network call is
  attempted. `fetch` on iOS encodes this for the app; a host-side script must
  do it itself: `urllib.parse.quote` the URL's path component (leaving the
  scheme and host alone) before building the request. Met 2026-09-24 crafting
  a #54/#55 desktop item into `<test folder>/openreader-54/…json` — the test
  subfolder segment is plain ASCII, but the owner's own folder segment above
  it in the same address is not.
- **`urllib`'s `MKCOL` with no body raises instead of answering.** `Request(url,
  method='MKCOL')` with `data=None` sends no `Content-Length`, and the helper
  reported status `0` (its exception branch) for a folder that was never
  created; the next `PROPFIND` then said `404` and the run looked like a folder
  the server would not make. Pass `data=b''`.
- **Deleting the positions file mid-run brings it straight back.** With a book
  still on the shelf, the next sync moment finds a `404`, treats it as the
  ordinary first run, re-creates the folder and uploads the phone's items —
  measured 2026-09-21: the file was gone at 22:50:55 and back, byte-identical,
  by 22:51:10. Empty the shelf first, or point the app elsewhere, before
  clearing the file for a fresh baseline.
- **A helper that deletes the folder as well as the file needs the folder put
  back.** `MKCOL` on an existing folder answers `405`, which is the "already
  there" answer and not a failure.
- **A host-side poller that dies quietly reads as "the phone never uploaded".**
  On 2026-09-22 the two-second `GET` poller on the owner's file stopped
  logging at 11:00:27, the pause at 11:01:41 then appeared to upload nothing,
  and only a `kill` that answered "no such process" gave it away: one `GET`
  had raised `URLError` (`[SSL: UNEXPECTED_EOF_WHILE_READING]` from
  Cloudflare), which `urlopen` does not wrap as `HTTPError`, and the loop had
  no `except` for it. Catch `URLError`/`OSError` per poll and log the failure
  as a line, and before trusting an "unchanged" tail check that the poller is
  still alive — a fresh `GET` afterwards showed the upload had happened; the
  file's `Last-Modified` header gives the time a dead poller missed.
- **A shelf that has to stay populated still uploads every position it holds,
  including the version-1 ones nothing can beat.** Switching sync on against
  the owner's real folder uploads an item for every entry with a position; a
  position read out of a version-1 Library file goes out as `stamp.at` 0 under
  this device's name, no merge ever beats or removes it, and a desktop that
  holds the same EPUB and has never read it adopts it. On 2026-09-22 仙逆 and
  the short fixture carried such positions (`{"at":0,"device":""}` in
  `library.json`) and the owner's file held neither id. When the shelf cannot
  be emptied (`testRemoveEveryBook`), terminate the app, back up
  `library.json`, set those entries' `position` to `null`, and check that the
  file's baseline hash is unchanged after the switch-on sync — it was.

### Crafting a cross-device item for #54/#55

Verifying that Play adopts a place a desktop just wrote needs a real,
document-matching item on the server, written host-side and timed against a
real running app — not a stub. Four things went wrong doing that on
2026-09-24, all against the real WebDAV host (the `openreader-54` test
subfolder), none of them the app being wrong.

- **A host-side script cannot `Process`/`NSTask` its way out of an
  XCUITest method.** The obvious way to keep the gap between crafting an item
  and pressing Play short — call the crafting script from inside the Swift
  method, right before the tap — fails to compile: `cannot find 'Process' in
  scope`. This probe target builds for `iphonesimulator` (an iOS binary), and
  iOS has no process-spawning API at all; this is not a missing import.
  - Fix: a file both sides poll. The XCTest method writes a JSON request
    (`{"seq", "doc_id", "template", "device", "delta_ms"}`) to a fixed host
    path and polls a second path for a matching `seq`; a plain Python script
    already running on the host (`craft_watcher.py`, started once before the
    run and left running) polls the request path, runs the craft the moment a
    new `seq` appears, and writes the answer atomically (`os.replace`, so the
    Swift side never reads a half-written file). Measured round trip: ~0.2–0.5 s,
    against 20–40 s for the alternative below.
- **Crafting from the caller's shell, then launching a new `xcodebuild`, puts
  20–40 s between the craft and the Play tap — long enough for an unrelated
  poke to adopt it first, or for the phone to have moved on since.** Four
  consecutive attempts this way misbehaved in two different directions, both
  explained once measured:
  - Sometimes the item was already adopted **before the method's first
    line ran**: the new test process's own attach/`app.activate()` fires an
    ordinary `foreground` poke (unbounded, not the 2 s one `play()` waits on),
    which had 20–40 s of build-and-attach time to download, merge and adopt
    the already-crafted item in the background. What looked like "Play
    adopted it" was that poke's landing, observed only because Play happened
    to be pressed afterward — not evidence about `sync.wait('play')` at all.
  - Other times the item was **never** adopted, with the sync outcome (see
    the `synclast` harness command below) showing `remote:1, adopted:[],
    uploaded:true` — the download succeeded, but the merge kept the phone's
    own item as newer and re-uploaded it verbatim. Cause: `reading.play()`
    always runs after the sync's `.then`, adoption or not, so a Play that
    fails to adopt still plays on locally — and while it does, the periodic
    position-write effect (`POSITION_INTERVAL_MS`) keeps stamping the phone's
    *local* entry with the real wall clock. A next craft computed as
    "phone's last known stamp + a fixed delta" is stale the moment that local
    play has run past it, which it always had by the next attempt.
  - Fix: craft from inside the running method (the file handshake above),
    which keeps the craft-to-tap gap to what the method's own next few lines
    take, on the far side of the attach window rather than racing it.
- **A craft finishing under roughly a second before the Play tap can miss
  adoption even though the upload itself succeeded (`204`) and the merge logic
  is correct.** Measured 2026-09-24: two runs whose craft finished only ~0.2 s
  before the tap saw `adopted:[]` on the very next sync; every run whose craft
  finished 1–2 s before the tap adopted normally. The app's own download is
  already cache-busted (`whatwg-fetch`'s `?_=` query on every request), so this
  is not a caching bug in the app. Host-side, 16 PUT-then-GET pairs spaced
  0–1000 ms apart, with and without a warming read first, all read back the
  content just written — so it is not a caching bug in front of the host
  either. The cause was not isolated further; it sits somewhere in the
  sub-second window between one client's PUT finishing and another client's
  next GET starting, outside this app's own logic, and it does not matter to a
  real desktop client (which uploads roughly 10 s after its own pause, not
  milliseconds before another device's Play). Craft at least 2 s before the tap
  in any test that depends on adoption succeeding.
- **A crafted item's stamp must be anchored on the device's own current
  local stamp, read from its own `library.json`, not the server's copy of the
  phone's item.** The server lags whenever a local write has not yet been
  uploaded — normal while paused between sync moments — so "newer than what
  the server last said the phone had" is not the same question as "newer than
  what the phone actually holds right now," and the gap silently loses the
  merge with no error anywhere (see `synclast` above for how that was even
  visible). Read both the server's answer and the device's `Documents/
  library.json` directly (the container path from `simctl get_app_container`)
  and use whichever stamp is largest as the floor, plus the current wall
  clock, plus a margin.
  - A temporary harness command was added and removed to see this at all:
    `shell.tsx`, `{"do":"synclast"}` → `hlog(JSON.stringify(syncLast))`, the
    transport's own last outcome (`result`, `remote`, `adopted`, `uploaded`).
    Nothing else distinguishes "the run never happened," "it errored" and "it
    ran and found nothing new" from outside. Removed before finishing, in
    keeping with the walkthrough harness being pre-release tooling, but worth
    knowing it existed if the same question comes up again — it is a four-line
    addition in the same shape as `saysettings` right above it.
- **Harvesting a template by visiting the section leaves the device's own
  local position sitting at that section.** A section jump plus a real
  Play/Pause (`settleAt`, needed to get a real, document-matching
  locator/anchor rather than a hand-written CFI) is itself a real navigation:
  the phone is now *at* the section just harvested. Reusing that same section
  immediately afterward as another device's "newer, unrendered" target tests
  nothing — it is already rendered, and a run against it will look like a
  clean adoption while not exercising the wait at all. Harvest ahead of
  where the run will actually look, or explicitly move the device back to a
  different, already-rendered section (another `settleAt`) before crafting
  the target.
  - **The scope this actually holds at is the `ReadingView` mount, not the
    method call, and not the app process either** — `reportedSectionsRef`
    (`use-reading.ts`) is a plain `useRef` created inside `useReading`, so it
    resets on a fresh mount (a relaunch, or leaving and reopening the same
    book) but is shared by *every* harness/XCTest call that reuses the
    already-open reader (`app.activate()`, never `app.terminate()`) in
    between. Measured 2026-09-24 verifying #54 scenario A/B/C the first time:
    `testHarvestOneTemplate` (which itself does a section jump, to harvest
    that section's real locator/anchor) and the scenario method that then
    crafted and played *that same section* both ran via `app.activate()`
    against one continuous mount that had never been torn down since the
    reader was first opened. The craft-to-play gap was genuinely short (the
    file-handshake fix above), but the target had already been displayed
    minutes earlier by its own harvest, in the same mount — so the "adopted
    and landed" observed was an ordinary already-known-Blocks resume, not the
    pending-place wait #54 adds. One run's timing (0.98 s tap-to-word-level
    audio while still backgrounded) was the tell in hindsight: real cross-
    device layout+synthesis measured elsewhere took several seconds. The safe
    protocol: harvest in one process, `app.terminate()`/`app.launch()` so the
    process under test starts with a genuinely empty `reportedSectionsRef`,
    open at a place far from the target and let it settle, *then* craft the
    target and test. `testHarvestOneTemplate` and the scenario methods now
    always relaunch for this reason, at the cost of the relaunch's own time.
- **A `goToSection` jump jump across a large gap (~1000+ spine indices) can
  silently fail to move the cursor, even in a freshly relaunched process.**
  Measured 2026-09-24: jumping 500 → 1600 (harvesting a template) left
  `status.section` at `500` indefinitely — confirmed by polling a harness
  `"say"` for over 100 s with nothing else sent in between — while
  `status.rendered.index` reached `1601` (the render-ahead-of-target pattern
  every other jump also shows), meaning the section *did* report, just
  without the cursor ever moving to it. Not fully root-caused (a `handleBlocks`
  report for an intermediate section somehow consuming or missing the
  `pendingSectionRef` match is suspected, not proven), and not reproduced at
  every large gap — several ~500–700-index jumps elsewhere in the same session
  worked normally. Avoid gaps close to or above 1000 when choosing a harvest
  or craft target relative to wherever the device currently is; every gap
  used successfully in the end was 700 or under. `settleAt` now confirms the
  jump via a harness `"say"` read back from Metro's own log (`library.json`'s
  write is throttled and can lag a jump that did work, so it is not what to
  check) and retries up to three times rather than trusting a fixed sleep —
  which caught this failure instead of silently harvesting the wrong section
  under the requested one's name.
- **The Notification Centre swipe measured flaky, independent of the mount
  issue above.** Three separate, freshly-relaunched runs in one session found
  no `UIA.MediaControls.NowPlaying.CenterButton` after the documented
  top-left-edge swipe, including with three retries and a longer settle each
  time (nine total attempts, zero successes, after the one run earlier the
  same day that *had* worked with a single attempt). The accessibility tree
  captured on failure showed only an empty `Application` root for
  `com.apple.springboard`, which did not explain why. No alternative surfaced:
  there is no `simctl` command to simulate a hardware remote-command press,
  and this environment had no native desktop Computer Use tool to fall back to
  (only a browser-scoped one, which cannot reach the Simulator window) — the
  AGENTS.md-sanctioned fallback for when `xcrun`/XCTest cannot perform an
  action. A run that needs the actual remote surface should budget for this
  being unreliable and check for it early, since discovering it only after
  crafting a target item leaves that item adopted through the ordinary
  foreground-while-paused path instead (harmless, but not what was being
  measured, and it consumes the target section).
- **`XCUIApplication.state` is not trustworthy evidence of backgrounding by
  itself.** Measured 2026-09-24: right after `XCUIDevice.shared.press(.home)`,
  and again a full 7 s later, `app.state.rawValue` read `4` (`.runningForeground`)
  — on a run where a whole-screen `XCUIScreen.main.screenshot()` taken at both
  moments showed the Home Screen, wallpaper and app icons, not the app. Only a
  third check, at 15 s, read `3` (`.runningBackground`). The screenshots are the
  ground truth; `app.state` lagged by at least 7 s on this iOS 27 simulator
  runtime and should be logged, not asserted on, until that lag is understood.
  A background check that only reads `.state` right after `press(.home)` and
  asserts on it can fail a genuinely-backgrounded run, or pass a run that never
  backgrounded at all — take a screenshot instead, or alongside.
- **Backgrounding right after a real screen tap stands in for a remote Play,
  but only with the craft at least 2 s before the tap, and it did not reach
  the layout question.** A remote Play and the screen's own end in the same
  `play()`, so `testScreenPlayThenHomeImmediately` avoids the unreliable
  Notification Centre swipe. It opens at a local place, plays briefly and
  pauses, so the engine, audio session and Now Playing registration exist as
  they would before a real lock-screen Play. It then crafts a target never
  displayed in this process, taps the screen's Play, and presses Home about
  half a second later.
  - Symptom: two runs adopted nothing and played the local place, and it
    looked like backgrounding's doing. Cause: the craft-to-tap gap in the
    pitfall above. Both crafts finished about 0.2 s before the tap, and a
    foreground control with the same gap failed the same way.
  - Measured 2026-09-24 with a 2 s gap, host-stamped `hlog` lines (added for
    the run and removed after). The Play sync adopted the item, and the
    target section reported with the place landed 0.45 s after the tap. That
    was before the app went inactive at 0.56 s, so the layout happened in the
    foreground. Clips then started at 1.9, 5.9 and 13.4 s, inside the 15 s
    background window: the JS thread and the audio go on in the background.
  - Not established: whether a section that has **not** laid out yet lays
    out while the app is in the background, which is what a lock-screen Play
    of a phone in a pocket needs. To reach it, Home has to land before the
    layout does, or the section has to take longer to lay out. A physical
    iPhone's suspension policy may differ from the simulator's anyway.
- **There is no `simctl` command to lock the simulator's screen** — checked
  (`xcrun simctl help`, `xcrun simctl` with no arguments): no such
  subcommand exists. A background-and-remote-Play check can go as far as a
  real Home press plus Notification Centre's swipe (the same
  `UIA.MediaControls.NowPlaying.CenterButton` surface `LockScreenProbe`/
  `lock-screen.sh` read), reached from the Home Screen the same way
  `testLockScreen` reaches it from inside the app. That establishes
  backgrounded behaviour; it does not establish behaviour under an actually
  locked screen, and a report that turns on this distinction should say which
  one was tested.

### The shell

- **A loop over `"a b c"` strings passes each as one argument.** zsh does not split an unquoted `$var`. Run such scripts with `bash`, or use arrays.
- **`$?` after a pipe is the pipe's last command.** `bash sync.sh … | tail -5;
  echo $?` printed `0` for a test run that had failed. Redirect the script's
  output to a file and test its own status, or read `PIPESTATUS`.
- **`lsof -p PID -d 1,2` lists other processes' files too.** `lsof` ORs its
  selectors, so that command prints every process's descriptors 1 and 2 as
  well as PID's, and a `tail` shows some other process. Met 2026-09-22 looking
  for where Metro writes its log, which is the only place the app's console
  lines are. `-a` ANDs them: `lsof -a -p PID -d 1,2`.
- **macOS's `wc -l` pads its count with spaces**, so reading Metro's log on
  from a remembered line with `tail -n +$(cat saved-count)` failed with
  `tail: illegal offset -- +    1097` (2026-09-23). Save the count as
  `wc -l < FILE | tr -d ' '`.
- **zsh runs nothing when an unquoted glob matches no file.** `grep -rn X src
  --include=*.ts` answers `no matches found: --include=*.ts` and the command
  never runs. Quote the pattern: `--include='*.ts'`.
- **macOS's bash 3.2 cannot parse a quoted heredoc inside `$(…)` whose text
  holds an unbalanced quote.** `CODE=$(cat <<'EOF' … EOF)` around a JavaScript
  program containing `/[.,!?"]+$/` failed with `unexpected EOF while looking
  for matching '"'` at the end of the script, although `'EOF'` quotes the body.
  Keep such text in a file of its own and `cat` it, as
  `leading-strip-probe.js` is.
- **`PIPESTATUS` is bash's, and an agent's commands here run in zsh 5.9.**
  `… | tee run.out; echo "exit ${PIPESTATUS[0]}"` printed `exit ` with nothing
  after it (2026-09-22): zsh has no `PIPESTATUS`, and an unset name expands to
  nothing. zsh's array is `pipestatus`, counted from 1: `${pipestatus[1]}`.
- **`xcodebuild` can outlive the test it ran.** A `-only-testing` run whose test
  was already reported as finished in `test.log` kept its `xcodebuild` alive
  past a ten-minute timeout. Watch `test.log` for `Test Suite … at <time>`, then
  kill that exact `xcodebuild -project <your artifact dir>` process; the result
  bundle is already complete. It happens after a **failed** test too (measured
  2026-09-21: the failure was written at 21:06 and the process was still there at
  21:16), so a run that has gone quiet is worth checking against `test.log`
  rather than waited out.
- **After a failed test, the result bundle is not complete, and killing
  `xcodebuild` loses the attachments.** Measured 2026-09-22: `library-actions.sh`
  ran both of its methods, one failed on a missing fixture at 01:21, and
  `xcodebuild` was still collecting simulator diagnostics
  (`result.xcresult/Staging/1_Test/Diagnostics/simctl_diagnostics`) at 01:30.
  Killed then, it left `result.xcresult` with no `Info.plist`, and `xcresulttool
  export attachments` refused it: "Failed to create a new result bundle reader".
  - The screenshots are still there, as raw files: `file
    result.xcresult/Data/data.*` says `PNG image data` for each, and the element
    trees are the `Zstandard compressed data` ones (`zstd -dc`). Their names are
    lost; tell them apart by the labels in the trees.
  - Better, do not run a method that is going to fail: every runner now takes
    `-only-testing:METHOD`, `library-actions.sh` included.
- **A runner called with no `-only-testing` died at once with `only_testing[@]:
  unbound variable`.** macOS's `/bin/bash` is 3.2, where `set -u` treats an empty
  array as unset, so "omit the arguments to run the whole class" never worked.
  The runners now expand `${only_testing[@]+"${only_testing[@]}"}`.
- **A Library entry's file is named with a dash, not a colon.**
  `Documents/library/sha256-<hex>.epub`, while the Document Id is
  `sha256:<hex>`. A `cp "$D/Documents/library/$id.epub" …` fails, and in a
  `cp || ls` chain it fails quietly.
- **`app.staticTexts["Folder"]` matches twice.** React Native nests a duplicate
  static text inside every `Text`, so an exact-identifier tap raises `Multiple
  matching elements found`. Use `.matching(identifier:).firstMatch`. Group
  headers are set as written since #48 (`Folder`, not `FOLDER`), so a probe
  that still names the capitals finds nothing.

### Evaluating in the app through `cdp.cjs`

- **A loop's closures all see its last value.** What `--eval` sends is compiled
  by Hermes as written, with no Babel pass, and a `for (const x of list)` loop
  does not give each turn its own `x`. Measured 2026-09-23: three wrappers made
  in such a loop over `['a', 'b', 'c']` all called the third method, and three
  arrow functions over `[1, 2, 3]` all returned 3. Four counting wrappers put on
  the offline repository that way all ran `readClip`, the runtime stored its
  answer as a document's inventory, and `hasSavedVoice` said false for a book
  with 72 saved clips until the app was restarted. Loop with `list.forEach(x =>
  …)`, which gives each item a function of its own, and restart the app after
  any probe that replaced a method, before measuring anything else.
- **Each of the harness's `fetch` commands replaces whatever `fetch` was there.**
  `breakFetch`, `watchFetch` and `unbreakFetch` in `walkthrough-harness.ts` each
  set `globalThis.fetch` to a new wrapper around the `fetch` captured when the
  module loaded, never around the one installed now. So `breakfetch` after
  `watchfetch` drops the request log, and `unbreakfetch` leaves no wrapper at
  all: neither `watchfetch`'s nor one a probe installed through `--eval`.
  Measured 2026-09-23, twice, verifying #45: after a `breakfetch`/Play/
  `unbreakfetch` cycle, the retried Play's requests produced no `HX fetch …`
  line, and a probe's own request log went empty. Send `watchfetch`, or
  reinstall the probe's wrapper, straight after `unbreakfetch`.
- **A request `breakfetch` refuses still counts as contact for #26's warm-up.**
  `warm-connections.ts` counts any settled request as having reached its
  origin, a refusal included, because a real refusal did go over the
  connection. `breakfetch`'s refusals never touch the network, so after
  `unbreakfetch` the next request within 30 s is sent without a warm-up, over
  a connection that may have idled for minutes. On 2026-09-23 that retry
  failed for real, with the production wording `Error: fetch failed: … The
  network connection was lost …` rather than the harness's `TypeError: …`, and
  a second Play a minute later, preceded by a warm-up GET, went through. Wait
  30 s after `unbreakfetch`, or expect that one real failure.
- **zsh's `echo` turns a `\n` inside a probe into a real newline.** A probe
  written with `echo '(() => … join("\n") …)()' > probe.js` held a line break
  inside its string, and `cdp.cjs --eval probe.js` answered `Compiling JS
  failed: 1:86:non-terminated string`. Write probes with a quoted heredoc
  (`cat <<'EOF' … EOF`) or in an editor.

## Lock-screen screenshot and button inspection

Prerequisites: macOS, Xcode selected by `xcode-select`, a booted iOS simulator,
Ruby with the `xcodeproj` gem (also used by CocoaPods), and the latest app installed.
Get the device ID with `xcrun simctl list devices booted`.

Open a Document, briefly play, then pause before running this inspection. It
captures the existing card and does not start an OpenReader reading. Use a fresh
output directory for each run:

```sh
bash test/manual-test/lock-screen.sh SIMULATOR_UDID /tmp/openreader-lock-screen-01
```

The script generates a disposable XCTest project, activates OpenReader, swipes
from the **top left** to open Notification Centre's lock-screen surface, records
its accessibility tree, center-button geometry and screenshot, then returns to
the app. Right-side swipes open Control Centre instead. This verifies the card
surface; it does not establish behaviour under actual device locking.

A missing center button fails the default XCTest assertion. **An accessible button
can still be invisible**: review the attached screenshot as well. Enabled state,
a screenshot and an actual press establish different facts; none substitutes for
the others. Artifacts live in `result.xcresult`, `attachments/` and `test.log`.
The script exits nonzero when the build or XCTest fails. To capture a surface
where no player is expected, pass the bundle ID and `NO` as arguments 3 and 4.

The owner reported normal lock-screen display on a physical iPhone after the
simulator's invisible-icon reproduction. Treat that reproduction as a simulator
display issue unless new device evidence contradicts it; the existing app
integration remains unchanged. See the dated engineering log for measurements
and the limits of the owner-reported device check.

## Read runtime warnings or evaluate a targeted expression

Prerequisites: the current repository's Metro server and one connected OpenReader
Debug target. The script uses Metro's installed `ws` dependency.

```sh
node test/manual-test/cdp.cjs --warnings
node test/manual-test/cdp.cjs --eval /tmp/targeted-expression.js
```

Set `OPENREADER_DEVICE` (e.g. `OPENREADER_DEVICE="iPhone 16"`) when two
simulators share one Metro — two worktree sessions on the same repository,
each with their own device — so the "expected one OpenReader debug target"
check narrows to the named `deviceName` instead of failing on two. Unset,
behaviour is exactly as before. `offline-playback.cjs` picks this up for free
by inheriting the environment into its own `cdp.cjs` calls; it separately
reads `OPENREADER_DOCUMENT_ID` to target a Document other than the short
fixture's historical id, for a Library seeded with a differently-built copy
of it (same title and chapters, different manifest digest). `OPENREADER_DEVICE`
is the Metro target's name; the silence check is a different question about the
same device and takes its UDID.

Warning capture includes buffered warnings and errors, without verbose stack
traces or ordinary playback logs. No output means no warnings were received in
that capture, not that all interactions have been tested. Restart the app against
a stable Metro before comparing runs: an old `Disconnected from Metro (1001)`
warning remains in the buffer. Keep Metro running for Debug delivery.

Evaluation prints the expression result and fails on a protocol/JavaScript error.
Use synchronous expressions: Hermes can return a Promise object before its work
finishes. Invoking a React handler through this tool is not a physical touch test.
Inspect only task-related state and avoid expressions that return credentials.
The optional final argument selects a different Metro URL.

### Capturing an async event (a WebSocket's `error`/`close`) across two `--eval` calls

Each `--eval` opens its own CDP connection and evaluates one synchronous
expression, so an event that arrives later — a refused WebSocket upgrade's
`close`, for instance — is not in that call's result. Split it into two calls
against the same running app, since Hermes's globals persist between separate
CDP connections: the first arms a listener that pushes each event into a
`globalThis` array and returns at once; after a pause for the network round
trip, the second reads the array back.

```sh
node test/manual-test/cdp.cjs --eval arm.js http://127.0.0.1:PORT   # registers ws.onerror/onclose, returns 'armed'
sleep 3
node test/manual-test/cdp.cjs --eval read.js http://127.0.0.1:PORT  # JSON.stringify(globalThis.__probe.events)
```

Used this way on 2026-09-22 against `wss://eastasia.tts.speech.microsoft.com/…`
with a wrong key, `new WebSocket(url, undefined, { headers: {…} })` produced
exactly the sequence ADR 0037 inferred from source but had not measured on a
device: a bare `error` event, then `close` with `code: 1006` and
`reason: "Received bad response code from server: 401."`. Restart the app
afterwards (or let the next `app.launch()` in a probe do it) to discard the
armed global.

## Inspect the simulator's playback icon resource

```sh
bash test/manual-test/check-media-resources.sh SIMULATOR_UDID /tmp/openreader-media-resources
```

This read-only diagnostic resolves the selected simulator's runtime root, checks
the `PlayPauseStop.ca` index references, then asks that simulator's Core Animation
to load the package. It also queries MediaControls' actual asset factory when
available, to distinguish its lookup from the direct package probe. Exit 0 means
the direct probe loaded a root layer; exit 1 means it did not;
exit 2 means the private inspection API is unavailable. It does not modify the
runtime. Private API usage stays in this external diagnostic, never in the app.
A missing root layer does not by itself test app transport; pair it with the
lock-screen screenshot and enabled-button observation.

### Tap the actual lock-screen transport

After `silence.sh set SIMULATOR_UDID`, with the reading already paused:

```sh
bash test/manual-test/lock-screen.sh SIMULATOR_UDID /tmp/openreader-transport-01 top.xujialiu.openreader YES tap
```

This takes the paused screenshot, taps the system's Play button, waits up to
three seconds for its label to become Pause, then immediately taps Pause and
checks for Play again. Failure paths also attempt to pause in the app. It refuses
a simulator whose own volume is not zero. Read the test log to
report the actual interval between the two taps. This exercises real simulator
touches; it still needs screenshot inspection to establish icon visibility.

For the dark lock-screen card's invisible-icon reproduction, the exported
`center-button` JSON carries the actual button rectangle. Run:

```sh
swift test/manual-test/center-icon.swift SCREENSHOT_PNG CENTER_BUTTON_JSON
```

The check requires more than ten pixels in that rectangle whose minimum RGB
component exceeds `195/255`. It failed with **zero** on the original screenshot.
This is deliberately a narrow dark-card regression signal, not an icon detector:
a light wallpaper can cause a false positive. Use the attachment manifest to pair
the screenshot and geometry, and visually confirm any pass.

## Inspect, stop or briefly exercise the reading handler

```sh
node test/manual-test/reading.cjs state
node test/manual-test/reading.cjs pause
node test/manual-test/reading.cjs play-for 5 SIMULATOR_UDID
```

Open a Document first. `play-for` requires an explicitly chosen duration up to
10 seconds and a simulator whose own volume is zero; it names the device so it
can check that, and takes `SIMULATOR_UDID` from the environment instead when the
argument is left out. Five seconds
was used here to establish an active Now Playing session before a paused-card
inspection. The script pauses via both a host cleanup path and an app watchdog.
If either reports an unconfirmed pause, stop in the app and verify its state.
The duration includes synthesis/buffering and does not guarantee that audio
actually started. These handler calls are not touch tests; use the `tap` mode
above for that. Run `state` afterwards to verify the final paused state.

## Reader drawers and voice loading

### Cold Library opening

With the latest installed Debug app connected to Metro and the named Document
already in Library:

```sh
bash test/manual-test/library-open.sh SIMULATOR_UDID /tmp/openreader-library-open-01 '仙逆'
```

This restarts the app to discard debugger overrides and in-memory caches,
physically taps the named Library row, and requires the reading player within
15 seconds. It captures the resulting UI and returns nonzero on failure. The
threshold detects issue #7's blocked opening; passing does not prove that every
chapter rendered. It never starts playback, modifies downloads, or supplies
credentials. Normal opening may update the Library's last-opened timestamp.
For comparison, run it with `A Short Test of Reading Aloud`. After a failed
opening that leaves the app unresponsive, restart it with `xcrun simctl` to
return to Library. Issue #7's original JSON plan was discarded with the owner's
explicit approval. Verify this path with fresh SQLite data as well as a large
prepared SQLite plan; a fresh empty store alone does not establish the absence
of per-text work. The catalog tests also cover 131,686 prepared texts.

### Offline narration and reader actions

Current offline data lives in `Documents/offline-narration-v2`, including
`catalog.sqlite` and any SQLite WAL/SHM files. The unreleased JSON store was
discarded with the owner's approval; do not restore pre-SQLite backups. Create
fresh fixture downloads before testing persisted playback or management.
Terminate the app before taking or restoring a complete offline-directory
backup so an open database connection cannot keep writing to replaced files.
After restoration, launch the app again before testing.

With the current Debug app connected to Metro and the fixture Document `A Short Test of Reading Aloud` in the Library:

```sh
bash test/manual-test/offline.sh SIMULATOR_UDID /tmp/openreader-offline-inspect inspect
```

This uses real XCTest touches to check the three-action drawer, font-size stepper, keyboard-visible rename/save and restoration of the fixture's original display name. It then checks persisted download completion, or selects chapters if the fixture has not yet been downloaded. It never presses Play. Review the exported screenshots as well as the assertions.

To exercise management and deletion against an already completed fixture, use `management` instead of `inspect` after making a complete backup of the stopped app's `Documents/offline-narration-v2` directory. The mode uses real XCTest touches to enter Manage downloads, select the first chapter, confirm Delete downloaded audio, and assert that only the second chapter remains with its measured saved size. Stop the app before restoring that same SQLite-format backup, then relaunch it before handing the simulator back; this mode does not prove deletion of a document from the library or playback of the remaining chapter.

To verify display-name persistence across a cold app restart, use `alias` instead of `inspect`. The mode uses real Rename touches, terminates and relaunches OpenReader, checks the alias in Library and Reader, then restores the fixture's original name. It does not prove persistence across an OS reboot or a library file migration.

To exercise real synthesis and persistence, configure a provider in the app and use `download` instead of `inspect`. This selects and downloads the entire short fixture and may spend provider quota; it never downloads the owner's other documents. The fixture has 17 speakable utterances in two chapters. Already completed audio is reused; start this mode with an incomplete fixture if testing the actual Download selected button.

To verify indexed progress for a second voice without provider quota, stop the app's current work first and run the disposable synthetic-fixture mode:

```sh
bash test/manual-test/second-voice-progress.sh SIMULATOR_UDID /tmp/openreader-second-voice-progress-01
```

The wrapper backs up and restores the complete v2 offline directory, Library and settings, then adds one known shared clip for a synthetic second voice to the short fixture. The XCTest uses real touches to open Download, choose that saved voice and require `0 chapters downloaded` plus `1 / 7` for the second chapter. The synthetic row and copied audio are removed by restoring the backup even when the test fails. This checks indexed SQLite progress and the omitted-text `textCount` display; it does not test provider synthesis or playback.

After the fixture is downloaded, silence the device with `silence.sh set SIMULATOR_UDID`, terminate and relaunch the app with `xcrun simctl` to empty the memory cache, then run:

```sh
node test/manual-test/offline-playback.cjs SIMULATOR_UDID
```

This reuses `cdp.cjs` to reject all fetches, temporarily disable the fixture's Fish provider, and route every newly created native audio source through a zero-gain node before Play. It checks actual saved-audio decoding, an active native playback queue and word-timing state, then immediately pauses. A five-second app watchdog and host cleanup also pause on failure. It prints the measured duration and network request count, restores settings/fetch, and keeps generated debugger expressions in a temporary directory. The zero-gain route is additional silence protection for the iOS 27 simulator, whose Control Centre had no volume slider; the `0.6` its `outputVolume` reported is the device's own `sim_volume`, which `silence.sh` now sets to zero. This is a handler probe, not a real Play touch, a physical connectivity test or a drift measurement. Restart the app afterwards to remove debugger instrumentation and verify it remains paused.

The `background` mode of `offline.sh` presses Home, waits 40 seconds to cover the bounded UIKit background-task window, then returns to the app without playback. Use it with a controlled queued task and observe the persisted task state from the host; the UI test alone proves only that the app can be left and reopened, not that synthesis continued or resumed.

With the latest Debug app connected to Metro and the existing fixture Document
`A Short Test of Reading Aloud` in the Library:

```sh
bash test/manual-test/reader.sh SIMULATOR_UDID /tmp/openreader-reader-01
```

This reuses the disposable XCTest project builder. It opens the Document if
needed, drags all four handles/title regions, checks that Voice and Speed have
no Done button, and checks a paused voice choice stays open when the fixture's
Sarah/Adrian rows are present. It never presses Play. Inspect exported screenshots
as well as assertions. It leaves the reader paused. The optional voice choice
check restores Sarah; use this on the fixture document, not the owner's reading.

For deterministic transport/handover checks, first silence the simulator with
`silence.sh set`, open the fixture Document, and open Voice once so its Fish list is loaded. Fish
must already be enabled with its key in the app. No credential is read by or
printed from the test script. The first eight list entries supply distinct
choices; an English fixture supplies the test text.

```sh
node test/manual-test/voice-playback.cjs SIMULATOR_UDID /tmp/openreader-reader-01
node test/manual-test/voice-playback.cjs SIMULATOR_UDID /tmp/openreader-touch-01 touch
```

The first command requires an existing screenshot directory. It replaces only
Fish synthesis responses in the running process with delayed silent WAVs and
word timestamps. The actual provider parser, native audio graph, reader clock,
React handlers and persistence callbacks run. Assertions cover initial loading,
pause before receipt without abort, same-Utterance word handover, latest choice
wins, failure rollback, next-Utterance fallback without timings, and pausing a
pending handover until the next Play. Each playback interval stops on its checked
transition, with an eight-second watchdog. It reports durations in milliseconds.
This is a handler probe, not a touch test or a test of live provider audio quality.

The `touch` command uses a **new** artifact directory. It installs a five-second
reply delay and calls `reader.sh` in loading mode to press Play, inspect the
spinner, and physically tap it to pause before any reply arrives. It then checks
that audio still arrives and the app remains paused. Do not run loading mode by
itself: it depends on the fixture and watchdog installed by the outer script.

Both modes restore fetch, the original voice and speed, close the sheet and
pause in `finally`. They use Metro's existing CDP inspection approach; they add
no test hooks to production app code. Do not edit app code while a probe runs:
Fast Refresh can replace the state being inspected. Restart the app afterwards
to remove all temporary debugger globals and verify final delivery separately.

### The download ring and Manage downloads' listed-chapters rule (#37, #38)

With a fresh Library (no provider configured, no saved audio) holding only `A
Short Test of Reading Aloud`, and the Fish key staged at
`/tmp/openreader-fish-key.txt` (`chmod 600`, never printed) as in **Issues
#13/#14** above:

```sh
bash test/manual-test/download-ring.sh SIMULATOR_UDID /tmp/openreader-download-ring-01 \
  -only-testing:testDownloadRingLifecycle
```

Real XCTest touches throughout, spending the fixture's 17 Fish utterances for
real: configures Fish Audio and chooses its first-sorting voice exactly as
`OfflineFixProbe` does, opens Download and requires `0 chapters downloaded`
with no `Manage downloads` link, selects both chapters and taps `Download
selected (2)`, then screenshots every ~0.6 s for ~10 s (attachments
`02-burst-0` … `N`, each paired with an accessibility-tree `-tree` attachment)
to catch the ring: a spinning arc plus `Preparing selected chapter…` on the
chapter being counted, an empty ring on the one waiting its turn, then a
filling arc under `Downloading…`. It taps the running ring itself
(`app.buttons["Pause download"]`, real touch, not a text link), requires the
task line to read `Paused` and every ring's label to become `Continue
download`, opens Manage downloads while paused and screenshots it (only the
chapter with partial audio is listed, with its `n / total` line), goes back,
taps the ring again to continue, opportunistically screenshots Manage while
the download is still running, then waits up to 90 s for `2 chapters
downloaded` and checks Manage lists both chapters as checkboxes. It leaves the
Download drawer open on the plain (non-Manage) view. A second method,
`testReopenDownloadDrawer`, just reopens that same drawer on an
already-downloaded fixture and leaves it open — used to restore the final
state after a separate run (such as `offline.sh management`) has left the app
elsewhere.

Measured 2026-09-22: the full lifecycle passed in 73.6 s including the Fish
provider setup and voice choice; the spinning-arc "preparing" phase was
caught in the burst (`Preparing selected chapter…` visible in at least one
frame) but is not guaranteed to be — the short fixture's per-chapter text is
small enough to count in well under one screenshot interval, so treat its
absence in a given run as inconclusive, not a defect, and say in the report
whether that run happened to catch it. The ring's accessibility tree entries
are `Button` elements 24×24pt with label `Pause download` or `Continue
download` (matching `SIZE` in `download-ring.tsx`); a plain chapter checkbox
row is an `Other` with `value: checkbox`, not a `Button`, so query it with
`app.descendants(matching: .any)` as the existing offline probes do, never
`app.buttons`. This establishes the ring's states, labels and the Manage
listing rule through real touches and screenshots; it does not measure
highlight timing, drift, or anything about playback, and it does not by
itself prove the ring is legible against the sheet background in Dark (a
ring only renders during an incomplete download, so checking Dark without a
second real download needs either a fresh, unfinished task or visual
inspection of the saved light-mode screenshots' contrast against the app's
dark palette).

### Paused sentence seeking after background receipt

With the same silenced simulator, fixture Document and loaded Fish list as above:

```sh
mkdir -p /tmp/openreader-paused-seek-01
node test/manual-test/voice-playback.cjs SIMULATOR_UDID /tmp/openreader-paused-seek-01 paused-seek
```

This mode pauses before the delayed silent audio arrives, waits for the native
queue, then sends text-tap messages for the current and next sentences through
the real reader bridge. It samples the actual WebView CSS highlights across two
300 ms fixture-word intervals: the sentence must remain highlighted with no word
range. Each Play must then highlight the selected sentence's first word, and
playback stops immediately after that observation, with the existing watchdog
and cleanup paths as backup. Screenshots are saved for both paused selections.

The temporary diagnostic receiver survives React updates and consumes only the
probe's responses; other renderer errors keep their normal reporting path.
Restart the app afterwards to discard all debugger state. This is a bridge-message
probe, not a physical touch test, live-provider audio test or long-term drift test.


### Fish regional picker, actual simulator touch

With Fish enabled and the fixture Document open, this opens Voice, physically
taps `en-IN` and asserts that `Aarav — Male Indian multilingual (EN)` appears:

```sh
bash test/manual-test/reader.sh SIMULATOR_UDID /tmp/openreader-fish-picker-01 fish
```

It uses the live voice list, so it needs the configured app key and network.
It does not select a voice or start playback. It leaves the picker open and
captures the list for visual review. The source-toggle combinations are covered
by the provider tests; this mode verifies regional navigation and visibility.

### Library and reader actions drawer (long press, '...', Delete)

With the current Debug app connected to Metro and both `A Short Test of Reading
Aloud` and `仙逆` in the Library:

```sh
bash test/manual-test/library-actions.sh SIMULATOR_UDID /tmp/openreader-library-actions-01 \
  -only-testing:testLibraryAndReaderActions
```

Without `-only-testing` it runs both methods, and the Contents one below fails
at once when `仙逆` is not on the shelf, which costs a long `xcodebuild` hang
(see Pitfalls). This uses real XCTest touches, entirely on the short English
fixture. It long-presses the Library row and taps its `...`, checking both raise
the same drawer, Rename/Download/Delete and **no Appearance** (#22: nothing
behind the Library shows a font change), with no system alert on the `...` tap.
It taps Delete, checks the `Delete this book?` confirmation, and **cancels** —
this mode never removes the fixture. It renames the fixture to a long title to
photograph the `...` button centred against a two-line row, then renames it
back and confirms the restoration survives a relaunch. It then opens the reader
itself and checks the Appearance/Rename/Download menu (no Delete row there) and
that all three still open from that entry point, including the persisted
Download view. In Appearance it takes Font Size from 16 to 20 and back,
capturing the page at 16 and at 20 (`reader-appearance-16`/`-20`): a pixel
comparison of the page above the sheet is what shows Appearance still changes
the page (measured 2026-09-22: 14.8% of that region changed, 14 lines of text
became 11). It never presses Play. It does **not** check the Contents note:
this fixture's nav hrefs do not match its spine (a pre-existing, unrelated
fact — see `core/document/contents.ts`), so every row is permanently
unreachable and `here` is always null here, regardless of position.

The Contents note is checked separately, read-only, against `仙逆`, whose nav
entries do resolve to real spine items:

```sh
xcodebuild -project /tmp/openreader-library-actions-01/ManualTests.xcodeproj \
  -scheme LockScreenProbe -destination 'id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/openreader-library-actions-01/build \
  -resultBundlePath /tmp/openreader-library-actions-02/result.xcresult \
  -only-testing:LockScreenProbe/LibraryActionsProbe/testContentsExactPrecision test
```

(Reuses the project the first command generated; point `-resultBundlePath` at a
fresh path.) It opens 仙逆, opens Contents, and requires a row to be marked
current before asserting that neither of the two approximate-precision
sentences appears. **Opening Contents immediately after the reader's "Choose a
Voice" button appears is too early**: `status.rendered` (what marks the row
when nothing has been actively read) arrives asynchronously after the WebView's
first render message, separately from the player footer mounting, and the
first measured run landed at the top of the 2,076-row list with nothing marked.
The probe now waits, then retries once after closing and reopening Contents.
Neither mode touches downloads, rename, or deletion.

### General, Theme, brackets, Manage-downloads delete-all, and Fonts

With the current Debug app connected to Metro and both `A Short Test of
Reading Aloud` and `仙逆` in the Library, `A Short Test of Reading Aloud`
already having some saved audio:

```sh
bash test/manual-test/general-fonts.sh SIMULATOR_UDID /tmp/openreader-general-fonts-01 \
  -only-testing:testFontFamiliesAvailableOnSystem \
  -only-testing:testGeneralThemeAndBrackets \
  -only-testing:testManageDownloadsDeleteAll \
  -only-testing:testFontsPageListAndBackButton \
  -only-testing:testFontSelectionChangesReadingPage \
  -only-testing:testLatinFontChangesEnglishReadingPage
```

Omit the `-only-testing` arguments to run the whole class, **except**
`testMigratedFontShowsGeorgia` (see below), which depends on state the other
methods do not set up and will fail if it runs alongside them.

`testFontFamiliesAvailableOnSystem` touches no UI: it asks `UIFont` whether
each of `READING_FONTS`' nine named `preview` faces actually resolves on this
system (family name or exact PostScript name), which is the same resolution
path React Native's own font lookup uses. A missing face is not a probe
failure to fix — it is the fact the test exists to surface, and the failure
message names the font. On the iOS 27.0 simulator runtime measured here, the
five Latin faces and `PingFang SC` resolve; `Songti SC`, `Kaiti SC` and
`Yuanti SC` do not (`UIFont.familyNames` on that runtime contains no CJK
family beyond the four PingFang variants). Confirm with real touches whenever
the reported set changes, since a missing face falls back to the system font
silently rather than erroring, and a screenshot is the only way to see that.

`testGeneralThemeAndBrackets` opens Settings → General with real touches,
photographs it, opens the Theme menu (#33) and requires Light, Dark and Match
Device in that order with the system symbols `sun.max`, `moon` and
`circle.lefthalf.filled`, photographs it, picks Light, requires the row to read
`Theme, Light`, then restores whatever theme the device had before the run,
Match Device included (photographed at each step, so both themes are covered
regardless of which one the device started in). It then drives the full bracket interlock in `general-screen.tsx`: the
field cannot be typed into while the switch is on (no keyboard appears),
typing `abc` and `() ()` with the switch off and turning it back on is
refused with the switch staying off, an inline note naming the offending
entry, the `Use <> [] instead` recovery link, and zero `app.alerts` — never a
modal — and a valid non-default list is accepted silently. It ends by
restoring the default list. It never touches Providers or downloads.

`testManageDownloadsDeleteAll` opens the English fixture's Download drawer,
enters Manage downloads, and requires `Delete all saved audio` next to `Back
to downloads` and a confirmation titled `Delete all saved audio?` naming a
size. It always cancels — this mode never deletes saved audio — and a saved
SQLite byte count taken before and after confirms nothing was removed.

`testFontsPageListAndBackButton` opens 仙逆's actions drawer, Appearance, then
Font, and requires all eleven rows (`Original Book Font` through `圆体`),
exactly one checked, and that the back button returns to Appearance rather
than closing the drawer. It photographs the list at the top and scrolled.
Whether the four Chinese rows are actually visually distinct is not something
XCTest can assert; read the attached screenshot against
`testFontFamiliesAvailableOnSystem`'s log.

`testFontSelectionChangesReadingPage` (仙逆) and
`testLatinFontChangesEnglishReadingPage` (the English fixture) each pick a
sequence of fonts through the same drawer and photograph the reading page
after every pick, ending back at `Original Book Font`. Neither asserts a
visual difference — that is also a screenshot-reading task — but a same-sized
crop diffed across screenshots (`ImageChops.difference` on the exported PNGs)
is a decisive way to tell a real font change from a coincidence of line
wrapping: on the measured run, `Times New Roman` and `Original Book Font`
were pixel-identical on the English fixture (that fixture's EPUB carries no
CSS of its own, so "follow the document" is WebKit's bare default, which
happened to already be Times), while `Georgia` differed from both by a wide
margin. The same diff against 仙逆's `楷体` and `Original Book Font` crops was
small and, on inspection, explained by sub-pixel/scroll noise rather than a
font change — consistent with `Kaiti SC` being absent from this runtime.

To verify the `serif`/`sans` id migration, terminate the app, edit the
on-device `settings.json` (`Paths.document`, reachable on the simulator via
`xcrun simctl get_app_container UDID top.xujialiu.openreader data`) to set
`"font": "serif"`, then run the one method that depends on it:

```sh
bash test/manual-test/general-fonts.sh SIMULATOR_UDID /tmp/openreader-general-fonts-migration \
  -only-testing:testMigratedFontShowsGeorgia
```

It launches (picking up the edited file), opens the English fixture's
Appearance, and requires the Font row to read `Font, Georgia`. Restore the
backed-up `settings.json` and relaunch afterward; this mode does not restore
it for you, since it is meant to be run against a deliberately prepared file.

None of these modes ever presses Play.

### The Settings version line, rows above it, and both themes (issue #30, `SettingsVersionProbe.swift`)

With the current Debug app connected to Metro:

```sh
bash test/manual-test/settings-version.sh SIMULATOR_UDID /tmp/openreader-settings-version-01
```

This relaunches the app (so a JavaScript-only change, such as `app-version.ts`,
is proven current rather than assumed), opens Settings, and requires an
element labelled exactly `Version <APP_VERSION>` under the Sync row, reading
`APP_VERSION` from the working tree's `app-version.ts` at run time — the
accessibility label a screen reader announces, which is not the same thing as
the line's visible text, since `accessibilityLabel` replaces what iOS exposes
rather than adding to it (a screenshot is what proves the visible text has no
"Version" word). It taps General, Providers and Sync in turn, requires each
one's own nav bar to appear, and returns to Settings each time to confirm the
version line and the three rows above it are unmoved. It then opens General →
Theme, picks Light, returns to Settings and photographs it, then Dark and
photographs it, then restores whichever of Light/Dark/Match Device the device
had before the run. It never presses Play. Add the probe's filename to
`ios/project.rb`'s allow-list before first use, the same as any new probe
source here.

### Issues #13/#14: a fresh Library, Fish from empty settings, and the two
### destructive confirmations the other probes always cancel

`OfflineFixProbe.swift`, run through `offline-fix.sh` (same shape as
`general-fonts.sh`), covers what none of the probes above do: a device that has
never had a provider configured or a document downloaded, and actually
confirming (not cancelling) "Delete all saved audio" and "Delete this book".
It expects two fixtures already in the Library: `A Short Test of Reading
Aloud` and a second, single-utterance document titled `OpenReader Deletion
Fixture` (one paragraph, one chapter named `Only Chapter`), used so the
destructive checks below have a document to spend rather than the shared
short fixture. Neither fixture's Library entry is written by this probe; both
were added directly (`library.json` plus `Documents/library/<id>.epub`) using
the project's own `identifyDocument`/`serializeLibrary` via `tsx`, which is
the reliable way to seed a fixture Document without reconstructing the
picker flow — a script that does this is not checked in here since it is a
one-time setup step, not a repeated verification.

```sh
printf '%s' "$FISH_API_KEY" > /tmp/openreader-fish-key.txt && chmod 600 /tmp/openreader-fish-key.txt
bash test/manual-test/offline-fix.sh SIMULATOR_UDID /tmp/openreader-offline-fix-01 \
  -only-testing:testConfigureFishProvider
```

Real touches: Settings → Providers → Fish Audio, types the key read from
`/tmp/openreader-fish-key.txt` (never printed, logged or checked in — write
it there from `~/.secrets/openreader/` per AGENTS.md before this method runs, `chmod 600`
it, and remove it afterward) into the still-masked field, taps Enable, and
waits for "Connection successful". `Show API key` is never tapped, so no
capture here can show it. Skips the enable step if a previous run already
left the provider enabled.

`testChooseVoiceForShortFixture` opens the short fixture and taps whichever
Fish voice sorts first (this is a download/playback mechanics check, not a
locale-picker test — `reader.sh fish` already covers real navigation to a
specific locale). Choosing while paused leaves the sheet open by design
(`ReaderProbe.testReaderSheets`); dismissal is `Close Voice`, the same
full-bleed backdrop button as `Close Download`/`Close Appearance`, not the
drag gesture `ReaderProbe` uses for the same result. Because a Voice choice
also becomes the settings default, this is the only document that needs it:
the mini fixture's first open inherits the same voice.

`testDownloadShortFixture` and `testDownloadMiniFixture` select all and
download for real (real Fish Audio spend: 17 utterances, then 1). Expected:
the task completes on its first attempt, including its very first write into
a brand-new voice directory. Before #15 both failed once there, in this order,
with "Needs attention · The saved audio could not be verified." and recovered
on `testRetryBlockedShortFixture` (taps `Continue`): `saveClip` read the
payload's size without awaiting expo-file-system's asynchronous `move`, so the
sidecar recorded `size: null` and no payload survived (ADR 0027). A pass here
is one sample of a timing, not proof of the order; the faithful `move` in
`test/offline/storage.test.ts` is what holds it. To check a run, compare the
sidecar's `size` with the payload's bytes on disk. For a fresh directory
without spending on the short fixture, run `testDeleteAllSavedAudioReal`
against the mini fixture first: it removes that document's directory, so the
next `testDownloadMiniFixture` writes into a new one.

`testDeleteAllSavedAudioReal` and `testDeleteThisBookReal` are the
actually-confirm versions of `GeneralFontsProbe.testManageDownloadsDeleteAll`
and `LibraryActionsProbe`'s Delete-row check, which both cancel by design.
Run against the mini fixture only — never the short fixture, which stays
intact for the other checks. `testDeleteThisBookReal` removes the Library
entry; **the underlying `Documents/library/<id>.epub` file is not deleted**
(`use-library.ts`'s `remove` only filters the entries array), which is a
separate, minor, pre-existing orphaned-file observation, unrelated to #13/#14,
and incidentally why restoring the entry afterward needs only a `library.json`
edit.

`testReaderRespondsPromptlyAfterInterrupt` and `testSeekToSecondChapter`
support the interrupted-removal check: confirming Play responds in about a
second when launched right after a hand-applied `removals` marking transaction
for a *different* document, and moving the reading position into the short
fixture's second chapter (whose audio survives a chapter-deletion check)
without using Contents — this fixture's nav/spine mismatch (documented above,
`LibraryActionsProbe`) makes every Contents row inert here too, so the
position is moved with ten `Player.onSkip('next-sentence')` handler calls
instead of a tap.

`testDownloadDrawerShowsUpgradeMessage` and `testNetworkReadingHighlightMoves`
cover the store-failure fallback: with the stopped app's `catalog.sqlite` at
`PRAGMA user_version = 2`, the Download drawer shows "Update the app to read
this offline database." (twice — once as the chapter-list load error, once as
`downloads.downloadError()`) with `Download selected` disabled, and Play still
reads the current chapter over the network, with the same message repeated
inline as a reader notice ("Saved audio could not be checked: Error: …").
Two screenshots 2.5 seconds apart are the evidence the word highlight actually
advances rather than just appearing once; neither mode presses Play for
longer than establishing that.

None of these methods restore anything themselves (no in-place undo of a
delete, no PRAGMA restore, no backup/restore of the offline directory or
`library.json`) — every destructive one expects the caller to have backed up
first and to restore afterward, the same division of labour as `management`
mode above.

## Settings against the phone's own Settings (#48, design 0042)

Design 0042 draws the settings pages the phone's way, measured from the phone
rather than remembered, and `SETTINGS` in `src/app/controls.tsx` holds the
numbers. Two runners make the comparison cheap to repeat when the phone's look
changes; each runs its probe once in the light appearance and once in the dark,
then gives the simulator back the appearance it had:

```bash
bash test/manual-test/native-reference.sh SIMULATOR_UDID /tmp/openreader-native-01
bash test/manual-test/design-shots.sh SIMULATOR_UDID /tmp/openreader-design-01
```

- `native-reference.sh` (`NativeReferenceProbe.swift`) opens only the phone's
  own Settings: its front page, General, General › About, and General ›
  Keyboard at the top and scrolled down, which is where a section header over a
  card and a footer under one can be measured.
- `design-shots.sh` (`DesignShotsProbe.swift`) walks OpenReader's Settings,
  General, Providers, Fish Audio, OpenAI Compatible, Sync empty and filled with
  sample values (never switched on, and emptied again afterwards), a reader's
  player and its speed bubble. It never presses Play. The same probe's
  `testSpeedBubble` checks the bubble (one tap is 0.05 each way, a hold
  repeats, the speed is put back, and a tap on Contents while it is open only
  closes it), and `testBackButtonLabels` that every back arrow is labelled
  `Back`; run either with `-only-testing:LockScreenProbe/DesignShotsProbe/<name>`
  as `design-shots.sh` runs its own.

Screenshots land in `<dir>/<appearance>/attachments/`, named by
`manifest.json`. Measure with PIL at the screenshot's own scale (3 pixels to
the point on an iPhone 17): sample a colour in the middle of a surface, and
take a card's edges at its vertical middle, since its rounded top cuts in.

- **The simulator's Settings has no page of labelled text fields.** iOS 27.0's
  simulator has no VPN configuration and no Mail, the two places the phone sets
  up an account in rows of `Label  value` fields, so `NativeReferenceProbe`
  captures neither, and the field rows' value column is the one thing on these
  pages not checked against a measurement.

A third runner covers what the two above do not — real touches on the freeze
rule itself, not just its resting screenshots:

```bash
bash test/manual-test/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-01 -only-testing:testFailurePathsNoCredentials
bash test/manual-test/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-02 -only-testing:testSyncRefusalPathAlone
bash test/manual-test/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-03 -only-testing:testFishVoicesFieldAndEnableDisableCycle
bash test/manual-test/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-04 -only-testing:testPressedRowHighlightsEdgeToEdge
bash test/manual-test/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-05 -only-testing:testDynamicTypeSpotCheck
```

`ProviderFreezeProbe.swift` (independent #48 verification, 2026-09-23):

- `testFailurePathsNoCredentials` — a bogus OpenAI key and an unreachable
  OpenAI Compatible address (in practice both are refused by a client-side
  "needs a model" check before either would reach the network — see
  Pitfalls, Sync's own timeout gap), then Sync against an address that cannot
  resolve. Each must end its switch off with a reason under the first card
  and its fields still editable; leaves every provider disabled and Sync
  empty. Prefer `testSyncRefusalPathAlone` for Sync alone — it waits for the
  check to *begin* before waiting for it to end (see Pitfalls) and is faster.
- `testFishVoicesFieldAndEnableDisableCycle` — needs the real key in
  `/tmp/openreader-fish-key.txt` (skips itself otherwise). The Voices field
  revealed by Manual voices, while unlocked: its placeholder, that it raises
  the keyboard, and that it stays reachable above it. Then the real
  enable/disable cycle: `Testing…` best-effort caught live, `Turn off to
  edit.`, `Connection successful`, the fields and the whole Voice sources
  card locked, the eye toggle's existence (never tapped — no capture here can
  then show the key), the Providers/Settings counts, and disabling again.
  Ends with Fish disabled and no stored key. If it fails partway (it did
  once, on an unrelated assertion — see Pitfalls), Fish may be left enabled
  with a real key stored: `testVoiceSourcesLockIsFunctionalThenCleanUp`
  reads the live state rather than assuming it, and disables/clears either way.
- `testPressedRowHighlightsEdgeToEdge` — a mid-hold screenshot taken from a
  background queue during `press(forDuration:)`, rather than a video
  recording, to catch a pressed `NavigationRow`'s highlight.
- `testDynamicTypeSpotCheck` — captures only, judged by eye; run with
  `xcrun simctl ui UDID content_size extra-extra-large` set first and
  restored after (the caller's job, not the probe's).
- `testReturnToLibrary` — walks back to the Library from wherever the app was
  left, for ending a session cleanly.

## Font Size against Documents that set their own sizes (#17)

Font Size is the size of every Document's body text (ADR 0030). The short fixture and 仙逆 set no body text size of their own, so they cannot show the difference between that and the old root percentage. `sized-fixtures.ts` writes two Documents that can, each with a first chapter of more than 2,000 non-space characters, so it is decided on its first page (`CHARACTERS_TO_DECIDE`):

```sh
npx tsx test/manual-test/sized-fixtures.ts /tmp/openreader-sized-fixtures
```

- `Sized Fixture Rem`: `html { font-size: 62.5% }` with the paragraphs at `1.6rem`, so the body text is 16px, and its own `body { -webkit-text-size-adjust: 100% }`.
- `Sized Fixture Small`: `body { font-size: 12px }`.

Both have an `x-small` badge in each heading and a `12px` note.

To put them on a simulator without the picker, copy them into the app's `Documents/Inbox/` (`xcrun simctl get_app_container SIMULATOR_UDID top.xujialiu.openreader data`) and write the walkthrough harness's `{"seq":N,"do":"add","file":"Sized Fixture Rem.epub"}` to `Documents/harness.json`, with a new `seq` for every command. The Library entry is named after the file. `{"do":"shut"}` and then `{"do":"open","id":"sha256:…"}` open one. A `{"do":"js","code":"return …"}` answer arrives in the Metro log as `note="The highlight could not be drawn: PROBE …"`.

Read these in each section document: `getComputedStyle(…).fontSize` of `p`, `h1`, `.badge` and `.note`, and `getPropertyValue('-webkit-text-size-adjust')` of the root. `{"do":"settings","patch":{"appearance":{"font":null,"size":20}}}` changes the size through the same `setSettings` the sheet calls. The expected values are in `notes/NOTES_2026-09-21.md` (11:31). The Rem fixture's body text lands on the chosen size, with its heading, badge and note in proportion. The Small fixture's is 12px, and it reads 133.33% at 16. The first open of Small is shown at 12px until its first chapter has been counted, then redrawn once at 16. Each Document's decided size is in `Documents/body-text-sizes.json` (`{"version":1,"sizes":{…}}`). Delete an entry to have it counted again on the next open. The short fixture has 883 characters in all, so it is never decided and is counted again on every open.

The same measurement on an iPad simulator needs the patched library. `postinstall` applies `patches/@epubjs-react-native+core+1.4.8.patch`, which asks the reader's WebView for its mobile content mode. Without it, an iPad reports the percentage and draws every size unchanged (ADR 0030).

What this does not establish: the stepper's own touches, the number between − and +, the highlight still painting after a change, and the spoken Utterance staying centred. Those need real touches and screenshots.

### The stepper, the highlight and the iPad with real touches (`FontSizeProbe.swift`)

`font-size.sh` runs `ios/FontSizeProbe.swift`. It has the same shape as `general-fonts.sh`: a new output directory generates the project, and an existing one reuses it.

```sh
bash test/manual-test/font-size.sh SIMULATOR_UDID /tmp/openreader-font-size-01 -only-testing:testStepperLadderDisabledEndsAndFontPage
```

- `testStepperLadderDisabledEndsAndFontPage` opens the short fixture with a real tap and walks the ladder 16 → 12 → 32 → 16, asserting every number between − and +. It also asserts that − is disabled at 12 and + at 32, that the "Use document appearance" line is gone, and the round trip through the Fonts page. It leaves the sheet open at 16 so the theme can be switched with the harness for light and dark screenshots of the same sheet. `testCloseAppearanceSheet` then closes it.
- `testHighlightPersistsAndRecentersAfterFontSizeChange` sets a highlight with a coordinate tap on the short fixture's body text, never pressing Play. It then takes the size to 24 in eight taps, screenshots before and after, and restores 16. Judge the re-centring from the two screenshots.
- `testStepFontSizeUpTo32` takes a reader that is already open, at 16, to 32 in sixteen taps. It is for comparing the page across Documents opened with the harness.
- `testFontSizeAndReaderBehaviourOnIPad` runs on the iPad. From a reader the harness opened, it opens and closes Contents, taps a word, swipes, and goes 16 → 24 → 16.

Prerequisites: the latest Debug app on this worktree's Metro, Font Size 16, and the short fixture in the Library. The two tests that start from an open reader need a Document opened first with the harness's `shut` and `open`. The coordinate taps were chosen from this fixture's own screenshots; a tap that lands between two lines silently does nothing, by design.

What it cannot establish:

- The first open of `Sized Fixture Small`, shown at 12px and then redrawn once at 16. That happens faster than `simctl io … screenshot` can catch.
- Whether a swipe scrolls epub.js's page. The iPad's synthetic swipe produced no visible scroll, which was not pursued.

## Text Alignment and the menu it opens (#32, #33)

Text Alignment reaches body text and passes over what a Document placed itself
(ADR 0034). `alignment-fixture.ts` writes a Document with one element for each
way a book aligns a line, each with an id; its header lists them and what each
should compute under Left and Justify:

```sh
npx tsx test/manual-test/alignment-fixture.ts /tmp/openreader-alignment-fixture
```

Copy `Alignment Fixture.epub` into the app's `Documents/Inbox/` and `add` it
with the harness, as for the sized fixtures above. With it open (`shut`, then
`open` by its Document Id), this harness `js` probe answers with every id's
computed `text-align`, a `*` where the program marked it as the Document's own,
and the section's height:

```js
var ids=['h-plain','h-centred','h-block','h-left','p-plain','p-left','p-justify','break','verse','verse-1','verse-2','signature','end','inline','legacy','li','td-word','td-num'];
var c=rendition.getContents()[0]; var d=c.document; var w=c.window;
return ids.map(function(id){var e=d.getElementById(id); if(!e) return id+'=?'; return id+'='+w.getComputedStyle(e).textAlign+(e.hasAttribute('data-openreader-own-alignment')?'*':'');}).join(' ')+' h='+d.body.scrollHeight;
```

Switch with `{"do":"settings","patch":{"appearance":{"font":null,"size":16,"textAlignment":"left"}}}`
and probe again. The answers of 2026-09-22 are in `notes/NOTES_2026-09-22.md`
(12:46): marked elements unchanged, body text `justify` or `start`, and the same
height under both. The page program is baked in when the reader opens, so after
changing `highlighter.ts` shut and reopen the reader before probing. A
program that opened before the change has none of it.

`alignment.sh` runs `ios/AlignmentProbe.swift`, the same shape as
`font-size.sh`. None of its methods presses Play.

```sh
bash test/manual-test/alignment.sh SIMULATOR_UDID /tmp/openreader-alignment-01
```

- `testChooseFromMenuInsideDrawer` opens the short fixture's Appearance drawer
  with real taps. It opens the Alignment menu and requires both items. It
  chooses the one not in force and requires the menu gone, the drawer still open
  and the row saying the new value, then chooses back.
- `testDismissWithoutChoosing` opens the menu and taps the drawer's title, then
  opens it again and taps the page above the drawer, where the backdrop that
  closes the drawer is. It requires the first to close only the menu, and
  records whether the drawer survived the second (`backdrop-tap-result`). On
  2026-09-22 it did.
- `testHighlightSurvivesASwitch` needs `Alignment Fixture` in the Library, open
  at the top of its chapter. It taps its first paragraph at normalized
  (0.5, 0.36), which sets the highlight without playback, then switches Left and
  back through the menu, photographing each. The judgement is the screenshots:
  the same words highlighted at the same height.

What it cannot establish: whether VoiceOver reads the row as a button (XCTest
sees the trait, not speech), and anything about a right-to-left Document,
since none is here.

Two more methods, added during independent #32/#33 verification (2026-09-22),
not part of the issue's own plan:

- `testXianniChapterOneBothAlignments` swipes forward from 仙逆's cover (four
  `app.swipeUp()`s, screenshotting every step, since a synthetic swipe's
  distance on this content was not known in advance — the first two can still
  read "Laying the document out…", and the fourth is what lands with `第1章
  离乡` at the top of the screen) and photographs chapter 1 under Justify,
  then Left through the menu, then restored. A pixel diff of the Justify and
  Left screenshots (2026-09-22) found no difference above y=1880 (the cover,
  the decorative pages and the centred chapter title/number) and 71,205
  differing pixels of 3,162,132 (2.3%) below it, confined to the paragraph
  text; the restored-Justify screenshot was byte-identical to the original.
  CJK justification is a small, real effect — inter-character spacing on a
  non-final line, not the ragged-versus-flush difference an English fixture
  shows — so judge it by a diff, not by eye alone.
- `testAppearanceAndAlignmentMenuInLightTheme` switches the app to Light
  through General's Theme menu, opens the short fixture's Appearance drawer
  and the Alignment menu there, dismisses without choosing, and restores
  whichever theme the device had. Confirms the drawer and the native menu are
  both drawn light, not only dark.

Independent verification also found `GeneralFontsProbe.testFontsPageListAndBackButton`
failing for a reason unrelated to #32/#33: see **Pitfalls**, XCTest.

## Sync: the Sync screen, the switch, and places crossing devices (#20)

Real touches on Settings → Sync, and on the reader's transport, against a
WebDAV folder. Prerequisites: the latest Debug app connected to Metro, both
`A Short Test of Reading Aloud` and `仙逆` in the Library, and four credential
files written by the caller with mode 600 and **removed afterwards** — never
printed, never in a screenshot, never committed:

```sh
: > /tmp/openreader-sync-url.txt        # the folder, percent-encoded and ASCII
: > /tmp/openreader-sync-user.txt
: > /tmp/openreader-sync-pass.txt
: > /tmp/openreader-sync-wrongpass.txt  # the same password with a character added
chmod 600 /tmp/openreader-sync-*.txt
bash test/manual-test/sync.sh SIMULATOR_UDID /tmp/openreader-sync-01 \
  -only-testing:testSyncSwitchOutcomes
```

**Use a test subfolder of the owner's sync folder, never the folder itself.**
The real one holds the desktop plugin's live files, and `Address` is
photographed by every capture. A subfolder that does not exist yet also
exercises the 404 path the switch is supposed to accept. Delete the subfolder
and its file when the run ends. The WebDAV folder in `~/.secrets/openreader/`
is already such a test folder (the owner, 2026-09-23): use it directly, and a
place written there costs nothing. The owner's real folder is not in that
directory, and **Against the owner's real folder** below is about that one.

Run parameters go in `/tmp/openreader-sync-params.txt` as `KEY=VALUE` lines
(`PLAY_SECONDS`, `SKIPS`, `PARAGRAPH_STEPS`, `SETTLE`, `BOOK_TITLE`), because
`xcodebuild` does not pass the environment through.

The methods, in the order a full run uses them:

- `testSyncSwitchOutcomes` — types the folder, the username and a **wrong**
  password, turns the switch on and requires it back off with the reason on the
  status line and the fields still editable; retypes the right password and
  requires the switch on, all three fields frozen, and the missing-folder line;
  turns it off and requires the fields editable with their values kept; turns it
  back on and leaves it there. The only method that types.
- `testTypeAddressInChunks` / `testTypeLongIntoProviderAddress` — the pair that
  separates "typing at all" from "one long `typeText`" (see **Pitfalls**). The
  second is the control on a screen that exists on `main`; run it only to
  re-establish that the crash is not this screen's.
- `testSwitchOnAndWait` — turns the switch on with nothing else happening: no
  launch, no book, no backgrounding. Whether the first sync runs is then decided
  by the switch alone, and the caller reads the answer off the server.
- `testPlayPauseUploadsPlace` — opens `BOOK_TITLE` with a real touch, presses
  Play, prints **tap-to-playing** (the bound `use-sync.ts` puts on the pre-Play
  sync), plays for `PLAY_SECONDS` and presses Pause. Check the server from the
  host afterwards: the item's `stamp.device`, `locator` and `anchor.exact`.
- `testMoveOnParagraphs` — `PARAGRAPH_STEPS` taps on Next/Previous paragraph in
  the already-open reader, then a short Play and Pause, which is what writes the
  place and starts the sync: the reader writes on its own only every ten
  seconds.
- `testForegroundAdoption` — Home, wait, activate: the `foreground` sync moment,
  photographed before and after.
- `testBackgroundForegroundFromLibrary` (#59) — walks back to the Library
  first, so it never captures the Sync screen, then Home, wait, activate with
  no reader opened: a `background`/`foreground` sync moment for confirming
  nothing uploads when nothing changed, without touching any book's own
  position the way opening a reader could.
- `testReadSyncScreen` — reads the screen without touching the switch; used
  after a relaunch to show that sync came back on, frozen, without a new check.
- `testOpenBookOnly` — opens `BOOK_TITLE` with a real touch and leaves it paused:
  the `open` sync moment and nothing else, which is what an idle measurement
  needs to start from.
- `testSeekAwayAndBack` — the clear-on-seek path: a real tap on a word of the
  next sentence (`WORD_X`, `WORD_Y`, in points, taken from a screenshot of the
  middle of a line), one tap on Previous sentence to come back, then a short
  Play and Pause. The pause must write **this** device's Stamp on the sentence a
  resume landed on, because the cursor has been pointed somewhere in between.
- `testClaimBeforeRender` — the claim rule: Home, activate, then one real tap on
  a word of chapter 1 at `CLAIM_DELAY` seconds after the **Home press** (see
  **Pitfalls**), with the stalling stub deciding when the adopted place lands.
  Prints the Home, activation and tap times so a run that tapped too early is
  reported rather than counted.
- `testLeaveUnmovedWritesNothing` — defect 4, in three printed steps: play into
  the next sentence and pause, wait and leave with Back without playing, then
  re-open, play on and leave. The host's poller is read against `STEP-A/B/C`.
  `PLAY_SECONDS` must cross a sentence boundary (10 s in the three-chapter
  fixture); a pause on the sentence the reading was already on correctly writes
  nothing, which cannot be told from the defect.
- `testSwipeForward` — six swipes up the open reader, to find out whether a place
  adopted while the book is open is waiting for the section it names to render.
- `testRemoveEveryBook` — long press, Delete, confirm, for every row there is.
  Run it before any run against the owner's **real** folder, so that nothing of
  this simulator's can be uploaded into it.
- `testEnterFolderAndSwitchOn` / `testSwitchOffAndLeave` / `testReadSyncStatusOnly`
  — the three that are safe to point at the owner's real folder, because they
  **capture nothing**: no screenshot, no element-tree dump. Both a capture and a
  full-screen `xcrun simctl io … screenshot` taken while the Sync screen is up
  carry the address and the username, so take neither while that screen is on.

### Against the owner's real folder

A cross-product test needs the real folder, and then the subfolder rule above
cannot be followed. What replaces it:

- Empty the shelf first (`testRemoveEveryBook`). A place of this simulator's in
  the owner's file is the thing that cannot be undone.
- Use only the three capture-free methods on the Sync screen, and read the status
  line from their `print`, which does not carry the address.
- Keep a baseline: `curl` the file before the run and `shasum -a 256` it. With an
  empty shelf the phone must leave it **byte-identical** — the desktop plugin's
  file is already in the canonical spelling this build writes, so an upload is a
  finding, not a formality.
- Watch it while the run goes on, rather than only afterwards: a poller that
  `GET`s every two seconds and prints the hash and one item's `stamp` is how the
  upload was timed to within a second of the pause.
- A fixture the app must add: `xcrun simctl openurl UDID "file:///host/path.epub"`
  hands a host path straight to the app's document handler — the reader opens on
  it, and no `Inbox` copy or harness `add` is needed.

What none of it proves: nothing here is a physical-device test, a drift
measurement, or a test of the desktop plugin's own writer. The screenshots, not
the assertions, are what show the highlight moved; `statusLines` cannot see
inside the reader's WebView, so an empty "sentences added" list means only that
the chrome did not change.

A folder that answers the check and then stalls the download — for the two-second
Play bound, and for a place arriving while a reading is playing — is a stub the
caller runs on the host and points `sync.url` at:

```python
# PROPFIND -> 207 at once, GET -> sleep N then serve reply.json, PUT -> 201
```

A stub is the only way found to measure the bound: a wrong address cannot be
typed while the switch is on, and a simulator has no way to lose its network.

## Voice lists at start (#24)

`voice-list.sh` runs `ios/VoiceListProbe.swift`: a cold launch, about five
seconds, a real tap on `Stat Line Fixture` (below), a tap on `Choose a Voice`,
and at once a locale chip (`en-US`) must be there and `Asking Fish Audio for
its Voices…` must not. It then chooses Dax from en-US with a touch, which while
paused is a preference and sends nothing, and closes the sheet.

```sh
bash test/manual-test/voice-list.sh SIMULATOR_UDID /tmp/openreader-voice-list-01
```

Measured 2026-09-22 (iPhone 17, iOS 27.0, Fish only enabled): Library row at
6.2–6.4 s after launch, sheet opened at 9.5–9.7 s, listed, no "Asking…". With
`watchfetch` in `harness.json` before the launch, the only Fish requests of the
run were the start-up listing's (pages 2–4 of the official list are what the
log can show; see Pitfalls).

What it cannot tell: whether the list came from the start-up request or from
one the sheet sent itself, only that the sheet waited for none. The other half,
a sheet opened while the start-up listing is still out, is a harness sequence
rather than a touch, because a person cannot reach the sheet that fast: put
`{"seq":N,"do":"open","id":"sha256:…"}` in `harness.json`, launch, and as soon
as the reader's first `HX playing=` line appears send `{"do":"voicesheet","on":true}`
and then `{"do":"voicelist","provider":"fish","n":1}`. Measured 2026-09-22: the
sheet asked 4.3 s after launch, `voicelist fish n=null asking=true`, the sheet
said "Asking Fish Audio for its Voices…", and 5 s later `n=338 asking=false`
with no note. Fish's own session cache also shares an official listing that is
in flight, so a request count cannot show which layer joined; the unit tests in
`test/app/voice-lists.test.ts` are what hold the loader's joining.

### The sheet while it is still asking (`voice-sheet-loading.cjs`)

The harness sequence above as a script, so its timing does not depend on
someone watching the log:

```sh
VIDEO=1 node test/manual-test/voice-sheet-loading.cjs SIMULATOR_UDID METRO_LOG DOCUMENT_ID /tmp/openreader-sheet-loading-01 [SHOTS]
```

It cold-launches the app with `open` already in `harness.json`, sends
`voicesheet` as soon as the reader's first `HX playing=` line reaches METRO_LOG,
takes SHOTS screenshots (`loading-NN.png`, default 10), sends `voicelist` once
the sheet command has been read, waits for the listing to finish, photographs
the loaded sheet (`loaded.png`), closes the sheet and removes `harness.json`.
`VIDEO=1` also records `sheet.mp4`, from before the launch to the loaded sheet.
Needs this worktree's Metro writing to METRO_LOG, Fish enabled with its key and
the Document in the Library. Never plays.

Measured 2026-09-22 for #28 with `Stat Line Fixture`, in frames at rest (the
sheet's top edge at y = 1311 px): the title's first ink at x = 50 px, the Fish
Audio chip's edge at 48 px (16 pt), and "Asking Fish Audio for its Voices…" at
49 px, where the old build put it at 1 px against the screen edge. The extra
pixel is the A's own side bearing. Measure each row band by its leftmost pixel
that differs from the sheet's colour, `#1c1c21`, by more than 30 in any channel.

The contents sheet's note is on the short fixture: `shut`, `open` it, send `say`
until `spine=` is above 0, then `{"do":"contents","on":true}` shows "None of
these rows names a file in this book…". Measured the same day, its three lines
start at x = 51 px like the title (the old build: 3, 2 and 1 px) and end by
1135 px, inside the right inset at 1158. The 2026-09-20 `Contents-open`
attachment of a `reader.sh` run is the same sheet before #28. None of the
fixtures has no contents, or a marked row that is only approximate, so the
sheet's other two notes were not seen.

What it cannot show: a touch (the harness opens the sheet), or a loading state
the network did not give. Check the `voicelist` answers and the frames rather
than assuming the burst caught it.

## Short lines, brackets and the Fish language hint (#23, #25)

`stat-line-fixture.ts` writes `Stat Line Fixture.epub`: one chapter, no
heading, six paragraphs that are six Utterances — `100 exp`, `2/50 HP`,
`You gained 100 exp.`, `He cast [Fireball] at the wolf.`, `[Level Up]`,
`If x < 5 and y > 3, stop.` Put it in `Documents/Inbox/` and send the harness's
`add`, as for the sized fixtures above.

```sh
npx tsx test/manual-test/stat-line-fixture.ts /tmp/openreader-stat-lines
```

### What was sent, and where the highlight fell (`stop-on-word.cjs`)

With the fixture open and paused, the simulator silenced, and this worktree's
Metro writing to a file:

```sh
SHOTS_DIR=/tmp/openreader-shots-01 OPENREADER_METRO=http://127.0.0.1:PORT \
  node test/manual-test/stop-on-word.cjs SIMULATOR_UDID METRO_LOG Fireball 20
```

It sends the harness's `watchfetch` for `api.fish.audio`, installs a recorder
in the reader's WebView through the harness's `js` (every change of the
`openreader-utterance` and `openreader-word` highlights, every 40 ms), presses
Play through the debugger with an in-app watchdog at MAX_SECONDS, pauses as
soon as the chosen word is the word highlighted, and prints the highlight
changes and the request bodies (never headers). `SHOTS_DIR` also takes
screenshots while it plays. It checks the simulator's own volume first. A
handler probe for Play and Pause, not a touch test; the recorder reads what the
WebView painted.

Measured 2026-09-22 with Dax (`en/9fa4b7a1b67446b48208f2f5d4bcd8da`) and the
default bracket list, 7.12 s from Play to Pause: the request texts were
`[Speak in American English] 2/50 HP`, `[Speak in American English] 100 exp`
(the first two are in flight together, so their order in the log is not the
reading order), `You gained 100 exp.`, `He cast Fireball at the wolf.`,
`[Speak in American English] Level Up`, `If x < 5 and y > 3, stop.`; no
`GET /model/9fa4b7a1…` lookup, because the start-up listing held Dax. Word
highlights: `100`, `exp`; `2`, `50`, `HP`; `You`, `gained`, `100`, `exp`;
`He`, `cast`, `Fireball`, `at`, `the`, `wolf` — each the document's own word,
`Fireball` without its brackets, nothing for the hint. Read-ahead is three
Utterances, so the sixth request goes out while the third line is read. A
download (`BracketsProbe` below) sent the same six texts, in reading order.

If the first line fails with "cannot reach api.fish.audio … The network
connection was lost", see Pitfalls: play again, and do not count that run. The
script does not notice a reading that stopped by itself; it waits out
MAX_SECONDS with nothing playing (the first measured run waited 20 s after
the failure at about 8 s), so keep the cap near what the stop word needs.

### The bracket switch over an open reader, and the download it names (`BracketsProbe.swift`)

```sh
bash test/manual-test/brackets.sh SIMULATOR_UDID /tmp/openreader-brackets-01 -only-testing:testDownloadStatLines
```

- `testDownloadStatLines`: a cold launch, the Library's `...`, Download, Select
  all, Download selected, and `1 chapters downloaded` within 90 s. Real Fish
  requests on the free model; no playback.
- `testFlipBracketSwitch`: attaches to the running app, which must already be
  on General. The UI never puts General over an open reader, so push it with
  the harness: `{"do":"go","route":"General"}` while the reader is open. It
  flips "Remove enclosing brackets when reading" once and goes back to the
  paused reader.
- `testReadDownloadCount`: attaches to an open reader and prints the Download
  drawer's count.

Check the offline store between them, read-only, from the host:
`sqlite3 "file:$D/Documents/offline-narration-v2/catalog.sqlite?mode=ro"`
with `SELECT * FROM state` (the `speech` row is the setting the keys answer
to), `SELECT ordinal, clip_key FROM memberships WHERE document=…` and
`SELECT key FROM clips WHERE document=…`. A key is the SHA-256 of the Speech
Text (`offline/catalog-keys.ts`), so it can be computed on the host with
`prepareSpeechText`.

Measured 2026-09-22: the download saved six clips under the Speech Text keys
(`He cast Fireball at the wolf.` as `8773e8c3…`, `Level Up` as `46cc8f36…`).
Switched off by touch: `speech` became `[false]` at once, those two
memberships became `57438442…` and `655001ea…` (the bracketed texts), the other
four stayed, and the drawer said `0 chapters downloaded` with the chapter at
`4 / 6`. Line 4 then went to Fish as `He cast [Fireball] at the wolf.` and the
highlight went `He`, `cast`, `at`, `the`, `wolf`, with nothing for the
swallowed word. Switched back on: `[true,"<> []"]`, the keys back, `1 chapters
downloaded`, and line 4 played from the saved audio with no request, `Fireball`
highlighted.

## A moved highlight leaves a strip behind (#35, `leading-strip.sh`)

Whether a highlight that has moved on left a strip of its colour along the top
of the words it left. Only a screenshot can say: the registry holds the right
Range the whole time, so nothing in the DOM is wrong.

```sh
npx tsx test/manual-test/leading-strip-fixture.ts /tmp/openreader-leading-strip
bash test/manual-test/leading-strip.sh SIMULATOR_UDID /tmp/openreader-leading-strip-01 app METRO_LOG DOCUMENT_ID [LINE_HEIGHT]
bash test/manual-test/leading-strip.sh SIMULATOR_UDID /tmp/openreader-leading-strip-02 page [fix=1|lh=1.6|delay=600]
```

- `app` drives the reader's own highlighter from inside its WebView
  (`leading-strip-probe.js`, through the harness's `js`): a fresh display of the
  fixture's chapter, one `speak` with `reveal` so that the centring scrolls as it
  does when a Clip starts, a word every 250 ms, and a `hold` on the first word of
  the sentence's second line. First put `Leading Strip Fixture.epub` in
  `Documents/Inbox/` and send the harness's `add`; its answer carries the
  Document Id. It needs this worktree's Metro writing to METRO_LOG. It sets the
  dark theme and Font Size 28 for the run and restores both afterwards. It never
  plays, so nothing is synthesized, nothing is heard and no reading position is
  written: it is safe on a simulator whose sync points at the owner's real folder.
  LINE_HEIGHT (for example `1.6`) is set on the chapter's `<p>` for the run.
- `page` opens `leading-strip.html` in Safari, from a server the script starts.
  That is WebKit alone: one `<p>` whose lines are set apart by `<br />`, one word
  highlight, and a scroll right before the first word. `fix=1` repaints the
  word's Block the way the reader does, `lh=1.6` makes the line box taller, and
  `delay=600` lets the scroll paint before the first word.

The fixture is laid out the way the owner's web-novel books are: a heading and
one `<p>` whose sentences are set apart by `<br /><br />`. The strip only
appears on a line that starts a text node but not its paragraph.

`leading-strip.py SCREENSHOT [LINE_PX]` is the detector for both modes. It finds
every region of the dark theme's word colour: a region nearly a line box tall is
a word, and a shorter one outside every word is a stale strip. Exit 1 is RED, 0
GREEN, and 2 INVALID, meaning there was no word on the screen or no answer from
the reader, so nothing was measured.

Measured 2026-09-22 on the iPhone 16, iOS 27.0. Before the fix, `app` was RED
with a 6 px strip above "She" (y 930..935); after it, GREEN, also at
line-height 1.6. `page` is RED with a 6 px strip (37 px at `lh=1.6`) and GREEN
with `fix=1` or `delay=600`, which says that runtime's WebKit still has the bug.
`page` with no query going GREEN on a later runtime would mean WebKit's own fix
(319154@main) has shipped there.

What it cannot show: a real voice, since the words move on a synthetic clock;
whether a finger scroll or a resize leaves a strip, since only the centring
scroll is driven; and a physical device's tiling, which may paint the
scrolled-in tiles a frame later. The owner's phone left its strip above the
Utterance's second word, where the simulator leaves it above the first.

## A chapter left unstyled by a fast fling (#34)

`scroll-fixture.ts` writes `Scroll Fixture.epub`, shaped like a serialised web
novel: a title page, a contents page that is one long list of chapter links,
then 60 chapters of 24 paragraphs, several screens each. The text comes from a
fixed seed, so every run writes the same bytes and the Document Id is always
`sha256:9acbcbe4480c15ba1319ecf56bad78e13a478470d2107f89791ba0f5b74f1606`.

```sh
npx tsx test/manual-test/scroll-fixture.ts /tmp/openreader-scroll-fixture
```

Put it in `Documents/Inbox/` and send the harness's `add`, as for the sized
fixtures above; set the theme with `{"do":"settings","patch":{"theme":"dark"}}`
and open it with `open`. Then, with this worktree's Metro writing to METRO_LOG:

```sh
START=30 SHOTS_DIR=/tmp/openreader-scroll-01 \
  node test/manual-test/scroll-theme.cjs SIMULATOR_UDID METRO_LOG 15 up 300 150
```

Each run waits for epub.js's queue to empty, displays section START, flings
the page 150 frames of 300 px towards the start of the book by setting the
container's `scrollTop` from inside the WebView, waits for the queue again, and
reads every view twice, two seconds apart: `INDEX:D` for a section holding the
program's dark stylesheet, `INDEX:L[sameN epN]` for a displayed one holding none
(the defect), `x` for a destroyed view, `*` for one on screen. The script's own
header has the rest, including the exit codes; `down` flings towards the end.

Measured 2026-09-22 on a dedicated iPhone 17 simulator (iOS 27.0): red on 6 of
15 and, with the final script, 3 of 15 runs before #34's change; 0 of 15, twice,
after it, and 0 of 6 `down` and 0 of 6 at 150 px. The rate varies from run to
run, so fifteen runs is the least that says anything; a red run's screenshot is
one chapter white on the dark page.

What it cannot show: a finger's momentum scroll (it is `scrollTop` from
JavaScript, which reaches epub.js's `scroll` listener the same way but is not a
touch), the owner's own books, or anything while reading aloud. It never plays.

### Real touches against the fixture (`ScrollThemeReaderProbe.swift`)

Independent #34 verification, 2026-09-22, against a dedicated simulator kept on
a non-default Metro port (see **Metro and the bundle** above): real XCTest
touches `scroll-theme.cjs` cannot give — a finger's fling, a tap on a word
reached only by one, Theme/Appearance applied live to the page, the
content-hook change's re-centre risk, and a chapter boundary crossed during
real Fish playback. `scroll-theme-reader.sh` has the same shape as
`alignment.sh` — a new output directory generates the project, an existing one
reuses it, and `-only-testing:` takes the bare method name — and it checks the
simulator's own volume before anything runs, because two methods press Play:

```sh
bash test/manual-test/scroll-theme-reader.sh SIMULATOR_UDID /tmp/openreader-scroll-reader-01 \
  -only-testing:testFastFlingBothDirections
```

Run the methods one at a time, in this order — several depend on where the
previous one left the reading, and none of them `.terminate()`s or
`.launch()`es the app (see the Metro Pitfall this section starts from):

- `testVersionAndThemeLiveOnPage` — real touches: Settings shows `Version
  <APP_VERSION>`; General → Theme → Light, back into the reader (screenshot);
  Theme → Dark, restored (screenshot). Confirms the page itself, not only the
  Settings row, repaints live.
- `testFastFlingBothDirections` — five `app.swipeUp(velocity: .fast)` (later
  chapters), twice, then the same with `swipeDown` (earlier chapters), each
  batch settling 1.5 s before a screenshot. All four came back fully dark,
  Font Size 20, no white chapter, 2026-09-22.
- `testTapWordAfterFling` — ten fast swipes, then a real tap on a word.
  Decisive because `status.section`/`status.utterance` (`use-reading.ts`'s
  `seekTo`) only change on a tap or Play, never on a scroll: the Metro log's
  last `HX` lines before and after the tap read `utterance=null section=27`
  → `utterance=219 section=14`, matching the chapter the tap landed in, and
  the screenshot shows that sentence highlighted.
- `testConfigureFishProviderNoRelaunch` — the same real touches as
  `OfflineFixProbe.testConfigureFishProvider` (masked key from
  `/tmp/openreader-fish-key.txt`, Enable, wait for "Enabled"), without its
  `app.terminate(); app.launch()`.
- `testFontSizeLiveOnPage` — the stepper 20 → 16 → 20 from the reader's own
  Appearance drawer, screenshotting the page (not just the sheet) at each
  size.
- `testHighlightRecenterRisk` — selects a sentence by tapping while paused,
  flings twenty sections away, then back in four batches, screenshotting
  throughout. `attach()`/`centreOnce()` in `highlighter.ts` do fire from a
  destroyed-and-rebuilt section that covers the current `state`, exactly as
  the code comment there says ("the manager destroyed this section's view
  and rebuilt it … both want centring now") — `show()` (a tap) sets
  `state.follow` true by default (`reader-bridge.ts`), so this path is not
  playback-only. In the measured run the app's own out-of-order-render safety
  net (the "Utterances were renumbered" note, already in `use-reading.ts`
  before #34) cleared the stale reading position first, so no disruptive jump
  was seen; a smaller round trip that rebuilds the section without also
  triggering that renumbering was not tried. Never presses Play.
- `testShortPlaybackCrossesChapterBoundary` /
  `testRetryPlaybackAfterNetworkFailure` — a real Play/Pause at a chapter's
  last sentence (reached with `{"do":"section","section":N}` and a small real
  swipe back — see the harness Pitfall above for why Contents cannot do this
  on this fixture), asserting the transition to `Pause` as proof playback
  actually started (see the XCTest Pitfall on a tap landing on the debug
  banner). Both measured attempts, 2026-09-22, hit the already-documented
  first-Fish-request network failure below before crossing into the next
  chapter; `playing=true` was confirmed in the Metro log both times, so the
  content-hook sweep and highlight painting are exercised, but the chapter
  crossing itself was not established. A third attempt was not made: AGENTS.md
  derives playback duration from what is being measured, and a network retry
  loop is not that.
- `testDownloadDrawerListsChapters` — opens Download with a real touch and
  requires the `* chapters downloaded` count line; never selects or
  downloads.

`ScrollThemeReaderProbe.swift` is in `test/manual-test/ios/project.rb`'s
allow-list.

## Azure Speech: configuration, the voice sheet, and word-level highlighting (#39)

`azure-provider.sh` runs `ios/AzureProviderProbe.swift`, the same disposable-project
shape as `general-fonts.sh` and `offline-fix.sh` (its target scheme is still
`LockScreenProbe`; only the source file differs):

```sh
bash test/manual-test/azure-provider.sh SIMULATOR_UDID /tmp/openreader-azure-provider-01 \
  -only-testing:testProvidersOrderAndAzureScreenControls
```

Prerequisites: the latest Debug app connected to Metro, the owner's Azure key
and region in two host-only files (never printed, logged, or checked in —
`chmod 600` them, one credential per line, and remove them when done):

```sh
printf '%s' "$AZURE_API_KEY" > /tmp/openreader-azure-key.txt
printf '%s' "$AZURE_REGION" > /tmp/openreader-azure-region.txt
chmod 600 /tmp/openreader-azure-key.txt /tmp/openreader-azure-region.txt
```

The methods, each its own `-only-testing` invocation and meant to run in this
order because later ones depend on state earlier ones leave (Azure enabled, a
voice chosen), the same division `OfflineFixProbe`'s methods use:

- `testProvidersOrderAndAzureScreenControls` — no credentials, free: the
  Providers list order (Azure between OpenAI Compatible and Speechify), the
  Settings version line, and the Azure screen's controls (Enable switch,
  masked API key field with Show/Hide, Region field, Test connection).
- `testAzureConnectionWordingsAndEnable` — free (voice-list checks or
  client-side format checks, no synthesis): a wrong key, a wrong region, an
  invalid region id, and an unreachable region each produce their own wording,
  then the real key and region succeed and Azure is left Enabled. Idempotent:
  `ensureAzureDisabled` unlocks the fields first regardless of what state the
  screen starts in.
- `testVoiceSheetShowsAzureAndChoosesEnglishVoice` — needs the English fixture
  in the Library. Opens the voice sheet, measures the time from tapping the
  Azure chip to the locale row appearing, dumps the full accessibility tree
  (for a host-side count of locale chips — grep it for
  `label: '[a-z]{2}(-[A-Za-z0-9]+)*'`, about 154 expected), checks zh-CN's
  `晓晓` and the `multilingual` group's `Ava Multilingual`/`晓晓 多语言`, swipes
  the locale row, and confirms a MAI voice sits under its own locale (en-US)
  next to a Neural one — then chooses Andrew and leaves the sheet.
- `testPlayEnglishAzureVoiceHighlightsWord` / `testChineseAzureVoiceHighlightsWord`
  — a real Play touch, three screenshots roughly 2.5 s apart (about 5 s of
  playback, enough to see the mark move), then a real Pause touch. Needs the
  Chinese fixture for the second one, with zh-CN → 晓晓 chosen first.
- `testMAIVoiceHighlightsWholeUtterance` — same shape, with `Ethan MAI-Voice-2`
  chosen first; the mark should cover a whole sentence, never a single word.
- `testBackgroundDuringAzureReading` — waits past the initial buffering (the
  `Pause` label exists, and is `busy`, before the first clip arrives — see
  the playback methods' own first screenshot) so the "before" capture shows
  real progress, then backgrounds the app for 30 s and returns. Measured
  2026-09-22: "before" had the heading of Chapter 1 marked (`Ethan
  MAI-Voice-2` highlights a whole Utterance); "after" had a sentence from the
  *start of Chapter 2* marked — several Utterances further, across a chapter
  boundary, entirely while backgrounded, with no red box and the transport
  still coherent.

None of these methods spends more than a handful of free voice-list requests;
the playback methods are real synthesis (Azure's free tier) and are the only
ones that cost characters — a few short sentences each.

What it does not establish: the exact RN facts in ADR 0037 that are not
visible from a touch or a screenshot — the WebSocket close reason's exact
text and code, and binary frames arriving as `ArrayBuffer`. The close reason
is measured with the two-`cdp.cjs`-call technique above; a successful,
audible play with a moving highlight is what stands for the `ArrayBuffer`
fact, since `azure-ws.ts`'s `parseBinaryFrame` throws on anything else and no
audio would have played at all.

## Reading across the end of a downloaded chapter, and a place kept across a renumbering (#26, #45, #46)

`boundary-fixture.ts` writes `Boundary Fixture.epub`: two chapters in two spine
files, a heading and four sentences each, all different, so Utterances 0–4 are
chapter one and 5–9 chapter two.

```sh
npx tsx test/manual-test/boundary-fixture.ts OUTPUT_DIRECTORY
```

Load it like any fixture (**Real books** above). Download chapter one alone,
without the sheet, through the app's own runtime; it synthesizes that chapter's
five sentences for real, and nothing plays:

```sh
node test/manual-test/download-chapter.cjs DOCUMENT_ID "Boundary Fixture" fish VOICE_ID --list
node test/manual-test/download-chapter.cjs DOCUMENT_ID "Boundary Fixture" fish VOICE_ID nav.0
```

`VOICE_ID` is the app's own id, locale first (`en/<model id>` for Fish): a bare
model id is refused as an unknown voice. The same script downloads a chapter of a
real book, which is how the #46 runs below had Chapter 2003 of `Cultivation
Online 2001-2044` saved and Chapter 2004 not.

**#26 at the boundary.** The failure needs a connection that has idled for more
than about 60 s but that iOS has not yet closed: measured 2026-09-23, it failed
107 s and about 70 s after the last request to `api.fish.audio` and not about
3 min after (`notes/NOTES_2026-09-23.md`). So restart the app (its launch asks
Fish for voices, which is the last request), wait 90–100 s with the reader open,
seek to Utterance 3 and play: chapter one's last two sentences come from disk in
about 0.1 s each, and the requests for 5 and 6 are what is being tested. Before
the fix both failed after about 6.4 s and the reading stopped on chapter two's
heading. Stop as soon as Utterance 6 has started or the reading has stopped.

**#45.** With a reading paused mid-chapter, the harness's `breakfetch` on
`api.fish.audio` refuses every request from the one named, and `unbreakfetch`
lifts it (`src/app/walkthrough-harness.ts`). Play until the reading stops on a
refused sentence with at least two refused, lift the refusal, press Play once:
the reading must go past all of them.

**#46.** On a real book, choose a chapter in Contents whose predecessor has not
rendered, or leave a book with its place in a middle chapter and open it again.
Before the fix the status line became `utterance=null` with "The document
rendered its sections out of reading order…", and Play read the book's first
page. The Library's stored place is in `Documents/library.json`, or in the
harness's `{"do":"shelf"}` answer.

What none of it proves: whether the owner's phone meets #26 at all, which
depends on its own network path, or anything about real touches.

## Play with the page scrolled away, and a place on a chapter heading (#50, #51)

**#50.** `follow-probe.cjs` measures the page from the moment Play is pressed:
every scroll, every display, every section adopted, every problem the program
posts, and then where the two highlights are:

```sh
node test/manual-test/follow-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [SECONDS]
```

Prerequisites: a reader open, the reading **paused on a sentence of spine item
SECTION after its Clip has started**, the simulator silenced, and METRO_LOG, the
file this tree's Metro writes to. On `Cultivation Online 2001-2044`, go to that
place with `{"do":"section","section":6}` followed by thirteen
`{"do":"skip","target":"next-paragraph"}`, which lands on "Suddenly, a golden
energy surged…" (Block 6.13). Then play until the status line reads
`level=word`, and pause. The script scrolls up 1,500 px at a time until SECTION
is off the page, checks the silence, plays for SECONDS (default 2.5), reads, and
pauses.

GREEN (exit 0) means no problem was posted and the Utterance's highlight lies
between 0 and the container's height. Measured with the fix on 2026-09-23: the
section's content hook at +17 ms, epub.js's `moveTo` +958 px at +20, the
centring −281 px at +29, and the Utterance at 283..342 of 758. Before the fix
the same run read the Utterance at −724..−665 and the problem "Block 6.13 is in
section 6, which is not on the page". For the variant after a renumbering
(#46), reopen the book on that sentence instead of jumping there: the scroll up
reports sections 5, 4 and 3 above the paused reading, and the result must be
the same.

**#51.** On the same book: `{"do":"section","section":20}`, then `shut`.
`Documents/library.json` now holds `epubcfi(/6/42!/4/2/2/2)`, "Chapter 2018:
Entering the Starry Sky", with no prefix or suffix. Open the book again. With
the fix, the status line reads `section=20` and "Resumed at the sentence the
reading stopped on.", and the heading is highlighted on Chapter 2018. Before
the fix it read `section=2`, the contents page's line, and "The paragraph this
book was left in is not where it was…".

What neither proves: a real touch on the Player or on the page, since both go
through the harness; or a section that is slow to load. In the runs with the
fix, every section arrived within 20 ms of its display. The first run, before
the fix, took 585 ms, and nothing since has repeated that.

