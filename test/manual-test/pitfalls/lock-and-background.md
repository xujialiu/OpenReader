# Locking the device, and the app away from the screen

## Locking the device, and the app away from the screen

- **`download-away.cjs lock`'s `away (locked)` mark is about 4.5 s after the
  lock, not a second or two.** Measured 2026-09-28 03:53 (#76): `lock.log` put
  `Pressing lock button` at 03:53:59.33 and the script marked `away (locked)`
  at 03:54:03.82, because `lock-device.sh` returns only after the probe's
  screenshot, tear-down and `xcodebuild`'s own ending. The press itself comes
  about 20 s after the call. Read the real moment from the log: `Start Test
  at …` plus the `t =` of `Pressing lock button`; or use `lock-device.sh
  UDID lock-on FILE`, which presses within about 0.05 s of FILE appearing
  and prints `LOCKPROBE pressing at` in Unix seconds.
- **A lock at whatever moment the probe's launch ends rarely crosses a chapter
  boundary.** Two `download-away.cjs lock … 120` runs (2026-09-28 03:53 and
  03:59, fresh chapters of *My Vampire System*, Fish `s2.1-pro-free`) locked 40
  and 27 s after the enqueue, the simulator's background time then ran out 27
  to 31 s after the lock (`interrupted`), and neither first chapter (90 texts;
  about 55) had finished: no chapter boundary was crossed while locked, so
  neither run tested it. The clip rate while locked was about half the
  foreground rate. Fix: `download-lock-at.cjs … left:5 …`, which locks when
  the chapter being written has five texts left; on 2026-09-28 04:08 the next
  chapter began 3.8 s after the lock and saved 20 clips while locked.
- **`lock-on`'s log from an earlier run still says `LOCKPROBE waiting`.** The
  first `download-lock-at.cjs … preparing` run (2026-09-28 04:16) read the
  previous run's `/tmp/openreader-lock-device/lock-on.log` before the new
  `xcodebuild` had truncated it, enqueued at once and wrote the signal file 12 s
  before the new probe was polling; the probe then pressed as soon as it
  started, 12 s late, after every preparation had finished, and the run
  measured nothing it was meant to. The script now waits for the line naming
  its own signal file, and fails when it finds no `LOCKPROBE pressing at`.
- **`XCUIDevice.perform(pressLockButton)` returns about 2 s after the press.**
  XCTest waits for the device to settle after it. A time printed after the call
  is 2.2 s late (measured 04:04: file created at .93, `Pressing lock button`
  at .95, the call returned at 7.16); print before it, as `testLockOnSignal`
  does.
- **The simulator's lock is not one AppState change.** Recorded in the app on
  2026-09-28 (a CDP-installed `AppState` listener): `inactive` 0.54 to 0.77 s
  after the press, `active` again about 2 s later for a moment, then `inactive`
  and `background` together. The download runtime treats that `active` as a
  return: an interrupted download read `downloading` for about 1.5 s, three
  seconds into the lock, then `interrupted` again. A single sample of
  `downloading` just after a lock is this flicker, not the app ignoring the
  lock. `simctl launch com.apple.Preferences` (download-away's `home`) leaves the
  app `inactive` for 7.7 s before `background`.
- **The app answers the debugger long after its download stopped away from the
  screen.** Locked with nothing playing, CDP answered for the whole 120 s,
  while the download was `interrupted` 27–40 s after the lock (the native
  background task's expiry). That the app still runs does not mean the
  download may.
- **`axe button home`, and a swipe up from the bottom edge through `axe
  swipe`, do nothing on iOS 27.0; `lock-device.sh home` does.** Measured
  2026-09-28 (#75–#77 final run, `iPhone 17 download`): both returned 0 and an
  in-app `AppState` listener recorded no change. `axe` itself works: `axe
  swipe --start-x 385 --start-y 3 --end-x 385 --end-y 450` opens Control
  Center (`inactive`, no `background`). `lock-device.sh UDID home` presses
  Home through XCTest (`testHome`): `inactive` 1.9 s after the probe's
  `LOCKPROBE home at` line, `background` 1.7 s later. `home-on FILE` waits
  like `lock-on`.
- **The Home Screen's own controls do not answer `mobilebuildmcp` taps on
  iOS 27.0, and the system's dark appearance does not darken its icons.**
  Measured 2026-09-29 (#83, `iPhone 17 download`): a `long_press` on the
  "Home screen icons" scroll area does enter edit mode, but `tap` and `touch`
  (0.3 s) on its `Edit` button, at (69, 33), left edit mode instead of opening
  the menu that holds Customize, twice. `simctl ui UDID appearance dark` darkens
  the wallpaper and dock and leaves every icon light, because the icon style is
  set in Edit → Customize. To see an app's dark or tinted icon, choose it there
  by hand, or drive `com.apple.springboard` through XCTest as
  `DeviceLockProbe` does; the AXe route does not reach it.
  - Measured again 2026-10-01 (#116, `iPhone 17 icon`, iOS 27.0): the route
    gets one step further and then stops at the same place. `long_press` on the
    icon's **own elementRef** (1.2 s) opens the icon's context menu
    (Edit Home Screen / Remove App) — but a `mobilebuildmcp tap` on Edit Home
    Screen does nothing (menu stays). An axe touch pair **does** open it:
    `axe touch -x 340 -y 233 --down --up --delay 0.9` on the icon long-presses
    it (0.2 s pairs act as a tap and launch the app), and the same pair on the
    menu's Edit Home Screen row enters edit mode. The Edit pill still does not
    answer: a 0.2 s pair on (69, 33) left edit mode — #83's symptom a third
    time, now through axe as well — and a 0.9 s pair did nothing, edit mode
    stayed, no menu. The Customize menu (the dark and tinted icon styles)
    remains out of automation's reach.
- **A swipe that closes Control Center can fail and leave it open, and the
  next Home press then closes Control Center instead of going Home.**
  Measured 2026-09-28 09:49 (final run, check 4 part F): `axe swipe` from
  (200, 860) to (200, 300), 4 s after opening, left Control Center up for
  39 s; the next `lock-device.sh home` returned the app to `active` (the bounded
  task ended, a submission went out) instead of leaving it, so that "Home and
  back" measured nothing. The same swipe worked in six other tries. Fix: read
  `AppState.currentState` through `cdp.cjs` after the swipe and retry until it
  reads `active` (`/tmp/openreader-final-sim/check4b.sh`, `cc()`).
- **`download-lock-at.cjs … left:5` rarely crosses the boundary with the app
  away, because the simulated lock takes 4–9.5 s to reach `background`.**
  Measured 2026-09-28 (final run, four runs): press to `inactive` 1.4–4.3 s, the
  flicker `active` for 14 ms to 1.0 s, `background` 4.0–9.5 s after the press.
  With `left:5` on a fast connection the next chapter began 68 ms before
  `inactive`; with `left:15` it began during the 1.0 s flicker; with `left:5`
  and a slow provider the chapter's last two texts took 25 s and no boundary was
  crossed before the background time ran out. `left:30` put the boundary 17.5 s
  after `background` and before the end of the background time (27 s). Read the
  crossing from the task's own `current` against the app's `background` event
  (`download-ahead.cjs` or `download-sampler.cjs`), not from the script's mark.

## `lock-device.sh home` can hang for minutes after the probe has errored (#128, 2026-10-04)

- **Symptom**: on a session-made iPhone 17 Pro Max (iOS 27.0), `bash lock-device.sh UDID home` printed nothing and a 90 s caller timeout killed the wrapper; the probe's own log (`home.log`) ended in an xcodebuild error naming a result-bundle staging path, and an orphaned `simctl diagnose -l -b --timeout=600 …` (PID kept in the run report) went on staging logs.
- **Cause**: the `testHome` run failed and xcodebuild's post-run diagnostics staging (`simctl diagnose`, up to 600 s) outlived every reasonable wait; lock and unlock in the same script passed in 3.6 s each moments before.
- **Fix**: run `home` with a bounded caller timeout and treat a hang as a failed attempt, not a silent pass: check for the orphaned `simctl diagnose` child, keep its log and the `xcresult`, then kill that PID (it serves a dead run you own). Background-state coverage that needs only the app's lifecycle, not the Home gesture itself, can ride the lock cycle instead: a simulated lock is measured (#75, above) to pass `inactive` → brief `active` → `background`, so "survives background" evidence from a lock/unlock round trip covers the same app-level events the Home press produces.

## The #148 run: a shared lock-probe build, and a Play the app refused (2026-10-09, iOS 27.0)

- **`lock-device.sh` deletes and rebuilds `/tmp/openreader-lock-device` whenever this checkout's `DeviceLockProbe.swift` is newer than that build, and every session shares the directory.** Symptom: in a fresh worktree the file's modification time is the checkout's (13:27) and the shared build was from 00:00, so the first call would `rm -rf` a build another session may be running from. Fix: `OPENREADER_LOCK_DEVICE_WORK=DIR` (new, the default is unchanged) names a directory of your own; the first `lock` then built and ran in 25 s. Its logs are `DIR/ACTION.log`.
- **The kit's `lock-device.sh play` passes when the app refuses the Play, and the centre button then stays on Pause.** Symptom (#148, beta11): with the Trial over, `play` exits 0 (`Executed 1 test, with 0 failures`, its `centre.label` turned from Play to Pause within 3 s), yet the Debug Log has `[reading] play while read-aloud is locked: asking`, `[purchase] locked, and not asked away from the screen`, `[reading] read-aloud still locked: nothing plays`, `[hx] playing=false app=background` and the fake server saw nothing. Ten seconds later the kit's own `pause` test, which asserts the label reads Pause before it taps, also passed; 85 s later `LockScreenProbe` read the label as `Pause` (`center-button` JSON) with the app in front and `playing=false`. After a real Play and Pause in the app the same probe read `Play`. Cause: the system turns the button at the tap and only the app's next Now Playing update turns it back, and a refused press changes no state, so none comes. Fix for the test: never read a lock-screen Play's exit status as "it played"; read `[reading] play at …` and `playing=true app=background` in the Debug Log, and the fake server's request count. A control run with the Unlock owned shows the gesture works (`play at utterance 4`, `playing=true app=background`, 2.1 s before a host `pause`).

## The #148 round 2: a refusal that republishes the same state moves nothing (beta12, 2026-10-09)

- **Writing the paused state again after a refused Lock Screen Play does not put the button back to Play; only a state change does.** Symptom: on 1.0.0 (7)-beta12, whose `play()` calls `restateNowPlaying()` on every refusal, three refused Plays with the Trial over (17:19:17.118, 17:28:36.864, 17:30:00.476) left the centre button on `Pause` — `LockScreenProbe` read it 42 s and 36 s later, and the kit's `pause` test (which passes only while the button reads Pause) passed 24 s later; after a real Play and Pause in the app the same probe reads `Play`. Cause: the app did write again (`Setting nowPlayingInfo … PlaybackRate = 0` from OpenReader at 17:19:17.116, 2 ms after the command's success reply), but the simulator's `mediaremoted` logged no `PlaybackState changed` or `isPlaying changed` in that minute, and MediaRemoteUI's waveform controller said `playing=1` for the app at 17:19:56: the system UI turned the button at the tap and a write that leaves the model Paused does not turn it back. Fix for the test: judge the button by `LockScreenProbe` (the NC card, read with the app in front) or the kit's `pause` test, never by the app's own log; to see what the system's model did, `xcrun simctl spawn UDID log show --start 'YYYY-MM-DD HH:MM:SS' --end '…' --predicate 'process == "mediaremoted"' --style compact | grep -E 'PlaybackState changed|isPlaying changed'` (whole seconds only: `--start '17:19:17.09'` answered nothing). A diagnostic through `globalThis.expo.modules.OpenReaderNowPlaying` (`cdp.cjs --eval FILE http://127.0.0.1:8082`: `show({…, playing:true})`, then `show({…, playing:false})` 400 ms later) put the button back to `Play`, so a Playing-then-Paused republish is a candidate for the app's fix; it was not tried inside the refusal itself.

## The #148 round 3: the kit's `play` fails once the app puts the button back, and hangs (beta13, 2026-10-09)

- **`lock-device.sh UDID play` fails against an app that refuses the Play and puts the button back, and the failed run leaves xcodebuild in `simctl diagnose` for minutes.** Symptom (1.0.0 (7)-beta13, Trial ended): `play.log` ended `error: … DeviceLockProbe.swift:89 … XCTAssertEqual failed: ("XCTWaiterResult(rawValue: 2)") is not equal to ("XCTWaiterResult(rawValue: 1)")` and `Executed 1 test, with 1 failure` after 4.9 s, then nothing: `ps` showed `xcodebuild` with a child `simctl diagnose -l -b` and the wrapper still waiting 5 minutes later, and a caller timeout of 300 s did not stop them (the Bash tool moved the command to the background and left the processes running). Cause: the test waits for the centre button to turn to Pause and expects it to stay, but beta13 shows the reading playing for about 400 ms and then paused again (`mediaremoted`: `Paused to Playing` at 17:43:52.957, `Playing to Paused` at 17:43:53.365), and XCUITest's tap returns 1.5 s after the touch, so its first look finds Play; the failure then starts xcodebuild's diagnostics staging, the #128 `home` bullet above. It is the fix working, not a flaky gesture: the Debug Log has the refusal (`read-aloud still locked: nothing plays`), `mediaremoted` has the pair, and `LockScreenProbe` reads Play. Fix: `lock-device.sh UDID play-refused` (new) asserts only that the button reads Play before the tap and prints `LOCKPROBE label when the tap returned: …` and `… 2 s later: …`, so it passes (`Executed 1 test, with 0 failures`) and caught the transient (`Pause` 0.4 s after the tap started, `Play` 2 s later, twice). Wrap any XCTest call that can fail in a runner that kills the whole process group after a limit (`kill` the `xcodebuild`, its `simctl diagnose` and the `lock-device.sh` wrapper by PID otherwise). Keep the failing run's `play.log` and quote its `Executed … with 1 failure` line.
