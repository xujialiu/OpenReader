# The lock screen and the playback icon

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

## The lock screen's playing state on a physical iPhone

```sh
PYMOBILEDEVICE3=DIR/bin/pymobiledevice3 bash test/manual-test/lock-screen-state.sh IPHONE_UDID SEQ [SECONDS_AFTER_PAUSE]
```

Prerequisites: the iPhone connected and unlocked, OpenReader in front with a
Document open whose Voice is ready (saved offline narration costs nothing), and
`pymobiledevice3` (see **Physical iPhone logs and the lock screen's state** under
Pitfalls). `SEQ` is the first of two new harness sequence numbers.

It streams `mediaremoted`, sends Play through the harness, waits for
`isPlaying changed to true`, lets two seconds play, sends Pause, and waits for
`isPlaying changed to false`. Exit 0 is GREEN, 1 RED (still playing after the
pause), 2 when Play was never seen. About 15 s, two of them audible on the
phone. It prints the state, rate and `inferred playback state` lines, which are
what the lock screen's centre button follows on the device.

Measured 2026-09-25 (#66), iPhone 16 Pro, iOS 27.0: the `0.0.1` build went RED
on every run (the state stayed Playing at least 50 s after a pause); `0.0.2-beta29`
went GREEN four times in a row, the last three on one engine without a relaunch.
It establishes what the system believes, not the drawn icon, and it does not
press the lock screen. Whether the lock screen's own Play resumes a paused app
iOS has since suspended needs a person, or an XCUITest run on the device: on
beta29 the owner paused, locked the phone, waited over a minute and pressed the
lock screen's Play, and the reading went on (2026-09-25).

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

### The in-app Play/Pause button through a suspend and resume (#66)

With the fixture Document open and a Provider configured, silenced:

```sh
bash test/manual-test/pause-suspend.sh SIMULATOR_UDID /tmp/openreader-pause-suspend-01
```

Real XCTest touches only, on the reader's own transport, never the lock
screen's. Checks the Settings version line first (so a JavaScript-only change
is proven current, the same reasoning as `settings-version.sh`), then: Play,
Pause, Play, Pause (each Play must resume and keep playing, not just flip the
button); a Pause immediately followed by Play, measured (`driving`'s ordering
queue, ADR 0012); two taps of Next sentence while paused followed by Play
(plays from the skipped-to sentence, not the old one). After every phase it
checks the player's own notes and the LogBox banner for anything naming
`suspend`, `resume` or `audio context`. It never touches the lock screen —
pair it with `lock-screen.sh`'s `tap` mode above for the remote-transport half
of #66. Measured 2026-09-25: a full run (four Play/Pause cycles, a measured
quick toggle, and a skip) passed with 0 failures in 49.9 s, and Metro's own
`HX` log independently corroborated continuous `utterance` progress —
including across a chapter boundary — through every pause and resume, never a
reset. It does not prove the lock screen's own icon or inferred state, which
only a physical device can (`lock-screen-state.sh`).

The script runs `testPauseResumeOrderingAndSkip` only. `testQuickToggleTight`
taps Pause and then Play with no wait between them; run it by building the
project the same way and passing
`-only-testing:LockScreenProbe/PauseSuspendProbe/testQuickToggleTight`, on a
fresh launch seeked back to the first sentence. It passed twice at 0.69 s
between the taps on 2026-09-25; one earlier run at 0.82 s failed on a LogBox
banner (Pitfalls, "A LogBox banner can appear with no `WARN`/`ERROR` line").
