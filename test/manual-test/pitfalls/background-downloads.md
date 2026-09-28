# A download away from the screen

## A download away from the screen (#75, #76, #77)

- **The 02:49 baseline's "interrupted at about 60 s" is not what a fresh
  process gets, and the difference is not the change under test.**
  - Symptom: on the #77 build (`iPhone 17 download`, iOS 27.0, 2026-09-28 06:03
    and 06:12), `download-away.cjs home … 90` read `interrupted` between +26 s
    and +31 s instead of the baseline's ~60 s, and clips went on for 28.7 s and
    32.7 s instead of ~17 s. That looks like a change in the bounded fallback.
  - Cause: the simulator's allowance for the bounded task. UIKit's own log for
    the task `Prepare narration` showed `Calling expiration handler … (elapsed = 28)`
    and `(elapsed = 27)`, 27.2 s and 27.0 s after it was created as the app
    left. The #75 tester had measured 25.5 s on the same device with a build
    that has no #77 native code. The 02:49 process had a different history.
  - Fix: read when the bounded task began and expired from UIKit, not from the
    5 s CDP samples:
    `xcrun simctl spawn UDID log stream --level debug --style compact --predicate 'process == "OpenReader" AND category == "BackgroundTask"'`
    prints `Created background task … taskName = Prepare narration` and
    `Calling expiration handler for task: … Prepare narration … (elapsed = N)`.
    Relaunch the app before each such run, compare runs made in one session,
    and do not play anything in that process first.
- **The continued processing task's register line only shows at debug level.**
  - Symptom: without `--level debug`, the log stream shows the module's
    `OpenReaderOffline: continued task refused: …`, an `NSLog`, and nothing
    about which identifier was registered or what was submitted.
  - Cause: `registerForTaskWithIdentifier: top.xujialiu.openreader.download.<UUID>`
    is a Debug (`Db`) line of `com.apple.BackgroundTasks:Framework`.
    `submitTaskRequest:completionHandler: <BGContinuedProcessingTaskRequest: …,
    (title: …, subtitle: …, resources: Default, submissionStrategy: Fail)>` is `Df`.
  - Fix: stream with `--level debug` and
    `subsystem == "com.apple.BackgroundTasks" OR eventMessage CONTAINS "OpenReaderOffline"`.
  - On the simulator, each submission was refused within about 5 ms of its
    register with `Error Domain=BGTaskSchedulerErrorDomain Code=1 "BGTaskScheduler is not available on this platform."`,
    which is the expected result. The Live Activity, its stop control, and how
    long the task keeps a download running cannot be seen on a simulator.
- **Lines that a fault or crash search matches, from a run that did not crash.**
  - `simctl spawn … log stream` prints `getpwuid_r did not find a match for uid 501` first.
  - About 2 s after a download starts, the app logs a fault:
    `[com.apple.defaults:User Defaults] Could not resolve UID for user "mobile"`.
  - runningboard's `Sending terminate request … No such process found` lines
    come from the WebKit child processes of the hidden indexer, not from the
    app.
  - Installing an XCTest runner puts `dasd … manualtests.xctrunner` lines into
    any predicate that matches `openreader`.
  - Fix: to check for a crash, compare the app's PID before and after
    (`xcrun simctl spawn UDID launchctl list | grep openreader`) and look for
    new `~/Library/Logs/DiagnosticReports/OpenReader-*.ips` files.
- **A task reads `paused` when its only running chapter finishes.**
  - Symptom: in both 06:03 and 06:12 runs, the task went from `downloading` to
    `paused` 26–31 s after the app came back, and the closing `toggleTask` of
    `download-away.cjs` did nothing.
  - Cause: the enqueued chapter was complete, and the task's other 186
    chapters were paused from earlier runs. Nothing paused it.
  - Fix: read `chapterProgress(document, voice).get(id).complete` before
    treating a `paused` state as a pause.
  - The continued task's subtitle counted the paused chapters too: one fresh
    chapter enqueued into that task was submitted as `48 of 187 chapters`, as
    ADR 0052 then specified. Since the owner's decision of 2026-09-28 (#77) it
    leaves out paused chapters that are not complete while the download goes
    on, so such a task no longer counts all 187; a download paused as a whole
    is counted whole.
- **What JavaScript got back from the native module.** `continued-processing.ts`
  logs nothing. To see whether `submitContinued` resolved `false`, replace it
  through `cdp.cjs --eval` with a recording wrapper. Assigning to the Expo
  module object works, and `String(offlineNative.submitContinued)` then reads
  `function () { [bytecode] }` rather than `[native code]`. On 2026-09-28,
  such a wrapper recorded five `false` results, and no `updateContinued`,
  `finishContinued` or `beginBackground` calls while the app was in front. As
  [cdp.md](cdp.md) says, relaunch the app after such a probe and before
  measuring anything else. The relaunch also removes the wrapper.
- **A poll of `preparationRequest()` every 100 ms misses preparations.**
  Measured 2026-09-28 (final run, check 1): 9 of 40 tokens were never seen,
  since a preparation ahead of *My Vampire System* took 10–110 ms. Tokens are
  consecutive, so a gap is a miss, not a request that bypassed the slot. Poll
  every 10 ms (`download-ahead.cjs install DOCUMENT_ID 10`); on the 2,077-chapter
  book that saw all 795 of 795.
- **In a freshly launched app `planOf(document)` is null until something asks
  for it.** An `enqueue` built from `planOf(X).chapters` threw `Cannot read
  property 'chapters' of null` after a relaunch and the 5-minute run measured
  nothing (2026-09-28, check 2's first try). Call `requestPlan(X, TITLE)` and
  poll `planOf` first; opening the reader does not load it.
- **At #77's 8aa75f6 the simulated lock's `active` flicker submitted a continued
  task, and the app could be in the background with no background task until the
  refusal was handled.** Measured 2026-09-28 (final run) in five locks: the
  flicker ended the bounded `Prepare narration` and submitted; the new bounded
  task started after the refusal, 0 s, 0.96 s, 1.00 s, 1.27 s and 3.88 s after
  `background`, and in two locks the submission itself reached
  BGTaskScheduler 0.85–0.96 s after `background`. `holding()` was true while a
  submission was out, so `background` started nothing itself. The simulator did
  not suspend the app in those windows (runningboard `running-active`). Read it
  in the stream of the entry above: `Ending task with identifier N … Prepare
  narration`, `submitTaskRequest`, `continued task refused`, `Created background
  task … Prepare narration`. Fixed in the commit after 22be978 (ADR 0052,
  "Leaving the app"): `background` now begins the bounded task unless a
  continued task the phone accepted runs, and a submission whose catalogue read
  ends after the app left is dropped. Expect `Created background task …
  Prepare narration` within milliseconds of every `background` with a download
  going on, and no `submitTaskRequest` more than a few milliseconds after it.
- **The Mac on the owner's iPhone hotspot (gateway 172.20.10.1) loses its route
  for a few seconds, and the simulator's download goes `waiting`.** Measured
  2026-09-28 09:55: the Mac's own log said `No network route` at 09:54:58, the
  app's `NWPathMonitor` answered unsatisfied, and the task read `waiting` (`No
  network connection, waiting to reconnect`) until paused. A `waiting` download
  starts no bounded task on leaving (`runsAway()` leaves it out), but is
  submitted on every return (`GOES_ON` includes it). A run that meets it
  measures the network, not the change: check the task's state before blaming
  the app.
- **`DownloadBesideReadingProbe.testRingThenPauseAllAndResumeAll` spends fresh
  chapters.** Its Resume all resumes every chapter of the download, and since
  c7de45e every unprepared one is then prepared ahead, within seconds, before
  its closing Pause all. On *My Vampire System* (245 chapters) it prepared the
  remaining fresh ones. Run it after the measurements that need fresh chapters.
- **A preparation during an XCTest runner's launch takes up to ten times as
  long.** On the 2,077-chapter book, 7 of the 8 preparations over 1.2 s (up to
  2.99 s, against a median of 263 ms) came within 20 s of a `fling-jump.sh`
  call, while its runner was being launched, before any flick. The recording's
  `flicks began` is when `xcodebuild` started; the flicks come 15–25 s later.
  Leave the runner's launch out when timing what the app does.
