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

### Metro and the bundle

- **The app runs code you have already changed.**
  - Cause: Metro started with `CI=1` does not watch files. It serves what it read at start, and its log says so once: "Metro is running in CI mode, reloads are disabled".
  - Fix: start it as `npx expo start --port PORT < /dev/null`. It will not prompt, because stdin is not a terminal.
  - To confirm the change is in what Metro serves: `curl -s "http://localhost:PORT/index.bundle?platform=ios&dev=true&minify=false" | grep -c <identifier from your change>`.
- **The bundle is stale or broken after `npm ci` or a new patch.** `node_modules` was replaced under a running Metro. Restart it with `--clear` and check the bundle as above.
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
- **`watchfetch` misses the first request the app makes as it starts.** The
  shell asks every enabled Provider for its Voices on mount (#24), and the
  harness's first poll is 250 ms later, so with `watchfetch` already in
  `harness.json` at launch the log shows Fish's listing pages 2–4 and never
  page 1. Page 1 was sent; its absence from the log proves nothing.

### Simulators and installs

- **Several sessions share this Mac's simulators.** Use the one the owner or the task names, and check `xcrun simctl list devices booted` first. Leave alone any simulator another session is booting, driving or reinstalling.
- **`xcrun simctl get_app_container` refuses a shut-down device.** Boot it first.
- **Another simulator needs the same Debug app.** `xcrun simctl install DEST "$(xcrun simctl get_app_container SOURCE top.xujialiu.openreader app)"` copies it without a build, to any device family the app supports, iPad included.
- **An iPad behaves differently from an iPhone.** An iPad-sized WKWebView defaults to the desktop content mode, where WebKit ignores `text-size-adjust` (ADR 0030). The reader asks for the mobile mode through `patches/`. Anything that depends on WebKit is worth checking on an iPad simulator too.
- **The app's console is not in the simulator's log.** `log show` has no `console.log` or `HX` lines; they are only in Metro's output. Note the time with `date` when you take a measurement, because it cannot be recovered afterwards.

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

### XCTest

- **A relaunch lands in the last reader instead of the Library.** That is state restoration. Tap `Back`, if it exists, before looking for Library rows.
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

### Measuring inside the reader's WebView

- **`performance.now()` is coarsened to 1 ms.** Time N repetitions and divide.
- **Computed sizes include text-size-adjust on an iPhone, and not on an iPad in the desktop content mode.** Divide by the percentage in effect only where it applies (ADR 0030).
- **A probe's own root-only text-size-adjust rule loses to the app's.** The app declares text-size-adjust on every element in `#openreader-highlight`. Take those lines out for the probe and put them back afterwards.

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
  device. So a boot is not the only thing to `set` after: run
  `silence.sh check SIMULATOR_UDID` **before every Play** and `set` again when
  it refuses, which is what the kit's scripts do and why they do it.
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
  - Cause, as far as it was established: this Mac reaches `api.fish.audio`
    through a TUN-mode proxy (it resolves to `198.18.0.126`, the fake-IP range),
    an idle connection is dead by then, and the POST that reuses it is not
    retried, while a GET apparently is, which is why it only took longer. Every
    synthesis is a POST. Whether a phone on another network does the same was
    not established.
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

### The shell

- **A loop over `"a b c"` strings passes each as one argument.** zsh does not split an unquoted `$var`. Run such scripts with `bash`, or use arrays.
- **`$?` after a pipe is the pipe's last command.** `bash sync.sh … | tail -5;
  echo $?` printed `0` for a test run that had failed. Redirect the script's
  output to a file and test its own status, or read `PIPESTATUS`.
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
photographs it, opens the Theme sheet, photographs it, picks Light, then
restores whatever theme the device had before the run (photographed at each
step, so both themes are covered regardless of which one the device started
in). It then drives the full bracket interlock in `general-screen.tsx`: the
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
