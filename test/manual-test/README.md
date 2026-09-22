# Device and manual tests

Before writing a script, inspect this directory and reuse or extend the relevant
one. Save useful new reproduction, inspection and verification scripts here as
soon as they work. Document the invocation, prerequisites, expected result and
what the script cannot prove. One-off probes may stay temporary; a working tool
needed for the next run belongs here.

Keep generated Xcode projects, builds, logs and screenshots outside the
repository. Accept device IDs and artifact destinations as arguments. Load only
needed credentials from `.secrets/`; never print or commit their values.
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
- **The bundle is stale or broken after `npm ci` or a new patch.** `node_modules` was replaced under a running Metro. Restart it with `--clear` and check the bundle as above.
- **`npm ci` in a new worktree stops with `ERESOLVE could not resolve`.** A new worktree has no `node_modules`, so `npm run typecheck` answers `sh: tsc: command not found` until it is installed, and plain `npm ci` then refused on 2026-09-22: `react-dom@19.3.0`, which `@expo/ui` brings in for its web side as an optional peer, wants `react@^19.3.0`, and the root pins `react@19.2.3`. Fix: `npm ci --legacy-peer-deps`, which installs the lockfile as it stands and runs `patch-package` (`@epubjs-react-native/core@1.4.8 ✔`). `react-dom` does not reach the iOS bundle (engineering log, 2026-09-22 13:02).
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
- **A `js` answer reads as empty or cut off.**
  - Cause: it arrives in Metro's log as `note="The highlight could not be drawn: PROBE …"`, JSON-escaped and cut at 500 characters.
  - Fix: parse the quoted string after `note=` as JSON instead of grepping up to the next `"`, and keep answers short.
- **Two readers answer.** `open` pushes a reader on top of any reader already open, and every mounted reader answers `js`. Send `shut` first.
- **The Library shows two Documents with one title.** `add` names the entry after its file in `Documents/Inbox/`. Give each copy its own file name, and open by Document Id when titles collide.
- **An old probe looks like a new error.** A `js` answer stays in the reader's notice as "The highlight could not be drawn: PROBE …" until the reader is opened again.
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
  way) before trusting a Play tap near it.
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

- **A Settings-stack screen can be more than one level away, even when it
  looks like one.** Reaching Fish Audio's provider form is Library → Settings
  → Providers → Fish Audio, three pushes, and each back button is named after
  the screen behind it (`Library`, `Settings`, `Providers`), never literally
  "Back" — the same fact `SyncProbe.openBook`'s comment already records for
  the reader's own stack. Tapping `app.navigationBars.buttons.element(boundBy:
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

### Measuring inside the reader's WebView

- **`performance.now()` is coarsened to 1 ms.** Time N repetitions and divide.
- **Computed sizes include text-size-adjust on an iPhone, and not on an iPad in the desktop content mode.** Divide by the percentage in effect only where it applies (ADR 0030).
- **A probe's own root-only text-size-adjust rule loses to the app's.** The app declares text-size-adjust on every element in `#openreader-highlight`. Take those lines out for the probe and put them back afterwards.
- **`rendition.on('rendered', …)` never fires for a probe either.** The library's template registers its own `rendered` listener first, it throws on every section, and epub.js's emitter stops there (#34, ADR 0036). A probe that counts `rendered` reads 0 however much renders. Use `rendition.hooks.content.register`, which runs for every displayed section, or read the views (`rendition.manager.views.all()`).
- **A regex inside a probe's template literal loses its backslashes.** In a `.cjs` script the WebView code is a template literal, where `\d` cooks to `d`: `/^(\d+)/` reached the WebView as `/^(d+)/`, matched nothing, and an event history came back empty rather than failing. Write `\\d` in the script's source.
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
- **`app.staticTexts["FOLDER"]` matches twice.** React Native nests a duplicate
  static text inside every `Text`, so an exact-identifier tap raises `Multiple
  matching elements found`. Use `.matching(identifier:).firstMatch`.

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
it there from `.secrets/` per AGENTS.md before this method runs, `chmod 600`
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
and its file when the run ends.

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
