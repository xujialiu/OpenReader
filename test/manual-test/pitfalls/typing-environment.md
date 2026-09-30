# Typing, environment and silence

## Typing, environment and silence

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
- **`XCUIElement.typeText`'s own activity log can print a secret, even into a
  masked field.** `OfflineFixProbe.testConfigureFishProvider` types the Fish
  key into a `SecureTextField` and only ever screenshots it (masked dots, as
  intended), but `xcodebuild`'s own activity trace records the string handed
  to `typeText` as `Type '<value>' into "Not set" SecureTextField`, truncated
  to a preview, in the xcresult's activity log and in whatever file `test.log`
  is redirected to — a `cat`/`tail`/`grep`-without-`-v` of that file after
  such a run prints part of the real key. Measured 2026-09-24: the field
  itself correctly masks (the attached screenshot the probe names
  `fish-key-entered-masked` is dots, not text), so the leak is textual only,
  in the log, never in a screenshot. Treat `test.log` from any run that types
  a secret as sensitive; read it with `grep` for the lines you need (`Test
  Case`, `Test Suite`, `error:`) rather than printing it whole, and never
  paste it into a report.
- **`xcodebuild … test` does not pass the caller's environment to the test
  process.** `PLAY_SECONDS=12 bash sync.sh …` (now `kit/run-probe.sh SyncProbe`) silently uses the probe's default,
  and a run "of twelve seconds" is really five. Pass parameters in a file the
  probe reads instead (`/tmp/openreader-sync-params.txt`, `SyncProbe.param`).
- **The walkthrough harness re-runs its last command on every launch.**
  `seenRef` starts at `-1`, so the first poll after a launch runs whatever
  `Documents/harness.json` still holds. A `settings` patch sent half an hour
  earlier silently rewrote the Sync settings of an app that XCTest had just
  relaunched, and the run that followed measured the wrong thing. `rm
  Documents/harness.json` before every relaunch, and treat a leftover harness
  file as device state.
- **Two harness commands written back to back run only the second.**
  - Symptom (2026-09-26 01:25, #71): a probe printed "then paused", and the
    status line then read `playing=true utterance=204`; the reading went on
    through the probe's analysis and its next step.
  - Cause: the harness polls `Documents/harness.json` every 250 ms and runs the
    command it finds there. `line-follow.cjs` wrote `pause` and, in the same
    breath, the `js` command that reads the page, so `pause` was overwritten
    before it was ever read.
  - Fix: wait at least 300 ms after a command before writing the next —
    `line-follow.cjs`'s `pause()` waits 700 ms — and read `playing=false` in a
    `say` answer before trusting a pause.
- **The simulator's volume can be back at 60 after an app launch, before
  anything plays.**
  - Symptom (2026-09-26 01:41, #71): `silence.sh check` read 0, `xcrun simctl
    launch` ran, and about 2 s later the device's `audiosettings.plist` was
    rewritten with `sim_volume` 60. The next probe refused to play. Seen three
    times that night: after a first `install`, and twice across a `terminate`
    that followed playback. A launch→terminate with nothing played between left
    it at 0.
  - Cause: not isolated.
  - Fix: `silence.sh set` **after** launching as well as before, and let every
    script `check` immediately before its `play`, as the kit's scripts do.
- **Muting the Mac is not silencing the simulator, and the Mac's mute comes back
  on its own.** After a `simctl shutdown`/`boot` cycle and a series of XCTest
  runs, `osascript -e 'get volume settings'` reported `output volume:56, output
  muted:false` although it had been muted earlier in the session — and the next
  Play was audible. The machine's volume is the owner's, not the test's: it is
  restored by things outside the run, and muting it takes the owner's sound away
  for as long as the run lasts and after it. Silence the device instead, with
  `bash test/manual-test/kit/silence.sh set SIMULATOR_UDID` ([README](../README.md)); never
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

- **A bare `tail`/`grep` snapshot of the Metro log cannot prove a state was
  sustained across a `sleep`.** Symptom (2026-09-26, #71): sending `play`,
  `sleep 4`, then `pause`, and only then reading the log's last lines, showed
  a single `playing=true` line sandwiched between many `playing=false` ones —
  which reads exactly like playback stopping almost at once. Cause: the
  harness's `HX` status line is written when a command is processed, not on a
  free-running timer, and nothing else was asked of the app during the 4 s
  wait, so nothing else logged; the single `true` line was genuine, just the
  only sample taken. A parallel run that sent `{"do":"say"}` every 500 ms
  during the same wait read `playing=true` at every one of eight checks across
  the full 4 s. Fix: poll with an explicit `say` (or other command) at the
  cadence the evidence needs, the way `line-follow.cjs`'s own `ask()` does; a
  `sleep` alone proves nothing about what happened during it.

- **`xcrun simctl pbcopy` answers 0 and the device pasteboard stays empty.**
  Measured 2026-09-30 (#105, iPhone 17 issue105b, iOS 27.0): `printf hello |
  simctl pbcopy UDID` exited 0 and `simctl pbpaste UDID` answered 0 with no
  output — a round trip that loses everything, so the paste-into-a-field
  path for a credential is closed (this before any long-press Paste could be
  tried). Fix used instead: an XCTest probe reads the staged file itself
  (the simulator process shares the host filesystem,
  `ProviderHeaders105Probe.swift`) and types into the masked field. Record
  the pbcopy failure before assuming a paste-based plan works.
