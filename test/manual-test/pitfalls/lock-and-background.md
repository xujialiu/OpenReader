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
