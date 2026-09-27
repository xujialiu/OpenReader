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
  - The continued task's subtitle counts the paused chapters too: one fresh
    chapter enqueued into that task was submitted as `48 of 187 chapters`, as
    ADR 0052 specifies.
- **What JavaScript got back from the native module.** `continued-processing.ts`
  logs nothing. To see whether `submitContinued` resolved `false`, replace it
  through `cdp.cjs --eval` with a recording wrapper. Assigning to the Expo
  module object works, and `String(offlineNative.submitContinued)` then reads
  `function () { [bytecode] }` rather than `[native code]`. On 2026-09-28,
  such a wrapper recorded five `false` results, and no `updateContinued`,
  `finishContinued` or `beginBackground` calls while the app was in front. As
  [cdp.md](cdp.md) says, relaunch the app after such a probe and before
  measuring anything else. The relaunch also removes the wrapper.
