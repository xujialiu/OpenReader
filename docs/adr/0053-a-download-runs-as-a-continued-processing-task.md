---
status: accepted
---

# A download the owner starts runs as a continued processing task

_The product half is [design 0053](../design/0053-a-download-goes-on-when-you-leave-the-app.md).
Issue #77. It revises "iOS uses a bounded UIApplication background task" in
[ADR 0027](0027-whole-document-offline-narration.md), which has an amendment
pointing here. The measurement that opened the issue is in
`notes/NOTES_2026-09-28.md`, 02:49, and the first run on the owner's iPhone
is in the same file, 19:26._

With nothing playing, a download went on for less than a minute after the owner
left the app or locked the phone. `beginBackgroundTask` bought that minute and
its expiration marked the download `interrupted` until the app came back. The
owner chose, on 2026-09-28, iOS 26's `BGContinuedProcessingTask` for a download
the owner starts, and the bounded task as the fallback where that task is not
available.

## What the platform requires

This was read on 2026-09-28. The sources are the iOS 27.0 SDK headers in Xcode
27.0 (27A266a): `BackgroundTasks.framework/Headers/BGTask.h`,
`BGTaskRequest.h`, `BGTaskScheduler.h` and `BackgroundTasks.apinotes`. The
others are Apple's article "Performing long-running tasks on iOS and iPadOS",
the reference pages of `BGContinuedProcessingTask`,
`BGContinuedProcessingTaskRequest`, `strategy`, `expirationHandler`,
`setTaskCompleted(success:)`, `submit(_:)`,
`BGTaskScheduler.Error.Code.unavailable`, `BGTaskSchedulerPermittedIdentifiers`
and `UIBackgroundModes`, and the WWDC25 session 227 "Finish tasks in the
background" with its code. The quotations are theirs.

- **Availability.** `BGContinuedProcessingTask` and its request are
  `API_AVAILABLE(ios(26.0))`. They are unavailable on macOS, tvOS, visionOS,
  Mac Catalyst and watchOS. The app's floor is 17.2 (ADR 0001), so every use is
  behind `#available(iOS 26.0, *)`. A stored property cannot have an iOS 26
  type, so the module keeps the running task as a `BGTask?`.
- **The Info.plist key and the identifier.** The key is
  `BGTaskSchedulerPermittedIdentifiers`. The request's initializer says:
  "The identifier ought to use wildcard notation, where the prefix of the
  identifier must at least contain the bundle ID of the submitting application,
  followed by optional semantic context, and finally ending with `.*`". Its
  example is `com.foo.MyApplication.continuedProcessingTask.*`, submitted as
  `com.foo.MyApplication.continuedProcessingTask.HD830D`. The app permits
  `top.xujialiu.openreader.download.*` and submits
  `top.xujialiu.openreader.download.<UUID>`.
- **When to register.** The register method's header says: "You must register
  launch handlers before your application finishes launching
  (`BGContinuedProcessingTask` registrations are exempt from this
  requirement)". The session adds: "Launch handlers don't need to be registered
  before your app finishes launching. Instead, you'll now dynamically register
  these handlers when the intent to use them is expressed." Registration
  therefore happens right before each submission. The same header warns: "The
  system kills the app on the second registration of the same task
  identifier". So each submission gets a fresh UUID suffix and its own
  registration. Registration returns `NO` when the identifier is not in the
  Info.plist.
- **Who may submit.** The request's page says: "The app submits this request
  from the foreground. Submission needs to occur as a result of a person's
  action, such as tapping a button." The session adds: "People don't expect
  tasks to start automatically, even if they've set a preference in your app
  before … Doing this unexpected work may lead to your app's task being
  canceled."
- **Strategy.** The default is `.queue`: "Add the request to the back of a
  queue if there is no room for the submitted task or if the system is under
  substantial load … Queued `BGContinuedProcessingTaskRequest`s will be
  cancelled when the user removes your app from the app switcher." The other is
  `.fail`: "Fail the submission if there is no room for the task request, or if
  the system is under substantial load and is unable immediately run the task."
  The error for that is `BGTaskSchedulerErrorCodeImmediateRunIneligible` (4),
  "only … returned when using the `…StrategyFail`".
- **How to submit.** `submitTaskRequest:error:`, Swift `submit(_:)`, is
  `API_DEPRECATED(…, ios(13.0, 27.0))`. It is replaced by
  `submitTaskRequest:completionHandler:` (iOS 27) "to capture all error
  conditions", whose header says "Do not call this method from the main
  thread". The other codes are `unavailable` (1), `tooManyPendingTaskRequests`
  (2) and `notPermitted` (3).
- **Progress.** `BGTask.h` says tasks "_must_ report progress via the
  `NSProgressReporting` protocol conformance during runtime and are subject to
  expiration based on changing system conditions and user input. Tasks that
  appear stalled may be forcibly expired by the scheduler". The session says
  "tasks that do not report any progress will be expired" and "if that
  progression is slower than expected, the system will prompt the initiator,
  asking if they want the work to continue". The article says "The system also
  prioritizes the termination of tasks that reflect minimal progress".
  Progress is `task.progress`, an `NSProgress`: `totalUnitCount` and
  `completedUnitCount`. `updateTitle:subtitle:` changes the text of the Live
  Activity. On the owner's iPhone (notes 19:26) the phone showed that prompt
  on the Live Activity about five minutes after the submission, with the
  download locked and saving clips in every 10 s bin: "My Vampire System —
  Chapters 251–500 is 16% complete. Do you want to continue running this task
  in the background?" with Continue and Stop. The app neither causes nor
  controls it, and is not told of it; after Continue the task went on.
- **Expiration.** The article says "If a person cancels a task through the
  interface, the framework invokes the task's expiration handler", and "the
  system expires your task, as occurs when a person cancels the task in the
  system UI". The handler takes no argument. **The owner's cancel and the
  system's expiry therefore arrive the same way**, and nothing documented tells
  them apart. On the owner's iPhone both stops in the Live Activity logged
  dasd's private `ActivityExpirationEvent(… reasons: 1048576)`,
  `_BGTaskExpirationRequest … reason: 2` and a progress `CANCELLED`. No end
  the phone chose itself has been seen, so whether those differ for one is not
  known, and nothing private is read. The article also says: "The system
  cancels any running tasks if a person closes the app in the app switcher,
  but the app doesn't receive an indication of cancellation in that case."
- **Completion.** `BGTask.h`: "Not setting an expiration handler results in the
  system marking your task as complete and unsuccessful"; "Not calling
  `setTaskCompletedWithSuccess:` before the time for the task expires may result
  in the system killing your app"; the handler "is cleared after it is called by
  the system or when `setTaskCompletedWithSuccess:` is called". The session:
  "when your task does complete its work, you must call setTaskCompleted", and
  on completion "the system briefly updates, then automatically dismisses the
  UI". What `success: false` changes in that UI is not documented.
- **Background modes.** `BGProcessingTask`'s header asks for the `processing`
  mode and `BGAppRefreshTask`'s for `fetch`. The header of
  `BGContinuedProcessingTask`, its article and the session name only the
  identifier. **No `UIBackgroundModes` value is added.** A missing mode is among
  the causes `notPermitted` (3) lists, so a code-3 refusal on the device would
  say otherwise.
- **Resources.** `requiredResources` stays at its default, CPU and network.
  `.gpu` needs the `com.apple.developer.background-tasks.continued-processing.gpu`
  entitlement and is not asked for.
- **The simulator.** The `unavailable` (1) code lists "The app is running on
  Simulator which doesn't support background processing". This lane could not
  boot a simulator, so this was **not tried**. The module logs every refusal
  (`OpenReaderOffline: continued task refused: …`), so a simulator run reads the
  actual error in the device log.
- **Priority.** The session says: "your background task may receive a lower
  quality of service compared to when your app is active … When your app does
  return to the foreground, it will intelligently boost your task priority".

## What was built

**Native.** `OpenReaderOfflineModule.swift` keeps `beginBackground`,
`endBackground` and `expired` unchanged and adds three `AsyncFunction`s and an
event, all on the main queue:

- `submitContinued(title, subtitle, completed, total) → Bool` resolves
  `false` below iOS 26. If a submitted task is still running, it updates that
  task and resolves `true`. Otherwise it registers `<bundle>.download.<UUID>` on
  the main queue and submits a request with `strategy = .fail`. On iOS 27 the
  submission uses `submitTaskRequest(_:completionHandler:)` from a global
  queue, and on iOS 26 `submit(_:)`. A refused registration or submission is
  logged with `NSLog` and resolves `false`.
- The launch handler keeps the task, sets its expiration handler and shows the
  latest title, subtitle and progress. A launch for any identifier other than
  the one submitted last and not finished is completed at once. That covers a
  download finished before its task launched.
- `updateContinued(title, subtitle, completed, total)` stores the values and
  applies them to a running task: `updateTitle` when the text changed, then
  `totalUnitCount` and `completedUnitCount`.
- `finishContinued(success)` calls `setTaskCompleted(success:)` and forgets
  the task.
- `continuedExpired` is sent from the expiration handler on the main queue,
  and the task is then completed with `success: false`. The handler first
  records what is publicly visible as the task ends, in one `NSLog` line
  (`OpenReaderOffline: continued task <id> expired: progress cancelled …,
  fraction …, … of …; thermal state …, low power …`), and the event carries
  the same values (`ContinuedEnded`): the task's `progress.isCancelled`,
  `fractionCompleted`, `completedUnitCount` and `totalUnitCount`, and
  `ProcessInfo`'s `thermalState` (0 nominal to 3 critical) and
  `isLowPowerModeEnabled`. Nothing decides on them. They are there so that
  an end the phone chooses can one day be compared with the owner's stop.
- `OnDestroy` completes a running task, because a reload makes a new module
  and the old one's task would otherwise never be completed.

**Info.plist.** `plugins/with-continued-processing.ts` writes
`BGTaskSchedulerPermittedIdentifiers = ["<ios.bundleIdentifier>.download.*"]`.
Like the other two plugins, it fails the prebuild if something else already
wrote the key. The prebuild of this tree produced
`["top.xujialiu.openreader.download.*"]`, and `UIBackgroundModes` remained
`["audio"]`, which is what the audio plugin writes.
`test/app-config.test.ts` runs the plugin's mod and pins the Swift's identifier
line to the plugin's prefix.

**Rules.** `src/offline/continued-processing.ts` is a pure module, with the
native module and the catalogue passed in. It is tested in
`test/offline/continued-processing.test.ts`, and its wiring in
`test/offline/runtime-continued.test.ts`.

- **One continued task at a time** covers every download that goes on by
  itself (`GOES_ON`: queued, preparing, downloading, waiting), and shows them
  together (#92). Its batch is every download that went on by itself from the
  task's submission to its end, including one that starts going on while it
  runs, and is still there (`covering`, filtered by `deps.tasks()`): a
  finished download stays in it, so the count never goes back, and a deleted
  one leaves it. At the submission it is the downloads going on then. The next
  task starts a new batch. Until the owner's decision of 2026-09-29 (#92, #93)
  it showed the download being written, or else the first one waiting its
  turn, and followed the scheduler from one Document to the next: with two
  books going on, the Live Activity showed one book's count and then the
  other's, and never how much was left of both.
- **What it shows.** `continuedShown` reads the batch, each download with the
  catalogue's `repository.progress` for its voice and its Document's plan.
  The title is `Downloading {n} books`, or `book` when `n` is 1, where `n` is
  the distinct Documents among the batch's downloads that put at least one
  chapter in the total: two voices of one Document are one book, and a
  download paused before it saved anything is none. It names no Document
  (#93): until 2026-09-29 the title was the shown Document's name as the
  Library shows it, handed in by the shell through the runtime's
  `nameDocuments`; the Live Activity cut it after about 25 characters (#93), it
  changed as the task followed the scheduler, and the phone's prompt named
  only that one (`My Vampire System — Chapters 251–500 is 16% complete`).
  Turned down with it: `{n} books` (the prompt reads `2 books is 6%
  complete`), `OpenReader` (the Live Activity already shows the app's icon),
  and `Downloading` alone (`Downloading is 6% complete`, and it hides how many
  books). The names are still handed in, for the Debug Log: its line
  `continued task shows "Downloading 2 books", 120 of 200 chapters, for "…",
  "…"` gives the Documents the title counts, each cut by `cutText`, or a
  short id where the Library has not named it; a rename no longer reports.
  The Document ids travel in `ContinuedShown.documents`, and the runtime's
  `continuedNative` passes the rest to the native calls, which are unchanged.
  The subtitle is `{saved} of {total} chapters`, or `chapter` when `total` is
  1, where `total` sums the batch's downloads: two of 100 chapters, the first
  done and the second at 20, read `120 of 200 chapters`, and a third of 50
  added reads `120 of 250 chapters`. While any download of the batch goes on
  by itself (`GOES_ON`), a chapter in a download's `paused` list counts only
  once it is complete for its voice, in every download of the batch whatever
  its state, which leaves out all but the saved chapters of a download the
  owner paused as a whole while another goes on. The owner decided on
  2026-09-28 (#77) that the count leaves out the chapters the owner paused,
  after the first version, which counted `task.chapters.length`, read `49 of
  188 chapters` with 140 paused; on 2026-09-29 (#92) that rule was taken
  across the batch, where it had held per download. Failed chapters are
  counted. Once nothing of the batch goes on by itself, as at Pause all or
  when the ring pauses the last chapter going on, every chapter of every
  download of the batch counts again, so the last report before
  `finishContinued` reads where things stopped (`49 of 188`), never a full
  `49 of 49` or `0 of 0` that looks complete. Chapters of a Document outside
  its download are not counted. Turned down on 2026-09-29: counting only the
  downloads not yet finished (the count goes back when one finishes) and
  counting every download in the Library, paused ones included (a total the
  batch will never reach). Progress is 1,000 units per counted chapter:
  `completed` is the complete counted chapters plus the saved share of each
  download's `task.current` when it is counted, read from `repository.progress`
  and the plan's text count, so the bar moves with every saved clip; `total`
  is `max(total, 1)` × 1,000. The report is taken after every
  `persist()`, which the scheduler calls after each saved clip and each change
  of state. One report waits its turn at a time and reads the downloads when it
  runs, the same one-in-flight rule as the drawer's `requestProgress`.
- **When it is submitted.** After the owner's own start or resume, while
  `AppState` is `active`. That means `enqueue` (Download selected),
  `toggleTask` when it resumes (Resume all, Retry failed), and `toggleChapter`
  when the tap resumes. A tap resumes when the chapter was paused, or when the
  download was paused, blocked or interrupted, which is the ring's Continue.
  And, by the owner's decision of 2026-09-28 (#77), whenever the app comes to
  the foreground with a download that goes on by itself: the `AppState`
  `active` handler calls `continueAway()` after making `interrupted` tasks
  `queued`, and `startDownloads` calls it once the stored tasks are restored,
  which submits if the app is then in front. `continued.start()` submits
  nothing when no download is in `GOES_ON`, and only reports while a task is
  being submitted or runs, so a return while the task still runs submits
  nothing. The owner treats opening the app as the person's action. The first
  version submitted only after a tap, because Apple asks for a submission to
  follow a person's action on this very work and says people do not expect
  tasks to start automatically (above); after the task had ended away from the
  screen, the download went on when the app came back, and leaving again
  without a tap had only the bounded task. What is given up: the phone may
  refuse or cancel a task submitted when the app is opened, as unexpected
  work; on the owner's iPhone it accepted both such submissions (below), and a
  refusal falls back to the bounded task as before. **It is never
  submitted** while the app is away, when playback stops, nor from
  `continuedExpired`: the end pauses the downloads the task covered (below),
  so the next return finds nothing going on by itself and submits nothing
  either.
  `start` reads what the Live Activity will show from the catalogue before it
  submits, and checks `foreground` again right before `submitContinued`,
  settling as not running if the app has left. At 8aa75f6 it checked only
  when called: in the final simulator run the simulated lock went `inactive`,
  back to `active` for up to a second, then `background`, the flicker's
  submission was still reading when the app reached the background, and in
  two of five locks it reached BGTaskScheduler 0.85–0.96 s after
  `background` (`test/manual-test/pitfalls/background-downloads.md`). An owner
  who comes back and leaves within about a second meets the same window.
  Every `active` counts as a return, including the one after `inactive`
  (Control Center, the app switcher, a system alert), and each submission
  registers a fresh identifier, so where the phone refuses, each return
  registers one more handler and logs one more refusal; on the simulator that
  is every return with a download going on. On the owner's iPhone (notes
  19:26) the submission after Download selected was accepted at once
  (`SUBMITTED` 3 ms after the registration, `Running task` 4 ms after that),
  and so were the two made when the app was opened, at 19:20:23 and 19:21:14;
  the second ran until Pause all at 19:26:52.
- **Why `.fail`.** A queued request would start later, beside a bounded task
  already begun, for a download that may be over by then. It would also give
  the runtime a third state (submitted, not running) to reconcile with the
  bounded task's expiry. With `.fail`, a download either has a continued task
  from the tap, or from the app's return to the foreground, onwards or has the
  old behaviour.
- **Leaving the app.** The `AppState` handler begins the bounded task unless
  a continued task the phone accepted runs (`running()`). A submission still
  out does not count, since the phone may refuse it. At 8aa75f6 the handler
  asked `holding()`, true while one was being submitted too, and began the
  bounded task only once a refusal came back: in the same five simulator locks
  the app sat in the background with no background task for 0, 0.96, 1.00,
  1.27 and 3.88 s. Now a refusal leaves the bounded task begun on leaving
  running, and an acceptance that arrives after the app left gives it back
  (`endBackground`), since the continued task keeps the app running from then
  on. The bounded task's own `expired` is then ignored while a continued task
  runs, as it may already be on its way when `endBackground` arrives, and
  `allowed()` holds while one runs even if the bounded time was refused
  (`beginBackground` resolving false sets `expired`). An `expired` that
  arrives while the phone's answer is still out interrupts the download as
  before; it would need a submission to take the whole bounded time, about
  half a minute. `runtime-continued.test.ts` checks each order with the native
  module doubled, and `runtime-reading.test.ts` a download that goes on under
  a continued task accepted after the app left, with the bounded time
  refused.
- **The end.** When nothing goes on by itself, the next report shows where the
  download ended and then calls `finishContinued`. That happens at Pause all,
  at the last chapter done, at a key or quota failure, or when deletion leaves
  nothing. `success` is decided at that moment, over the downloads the task
  covered: each that went on by itself between its submission and its end,
  including one that started going on while it ran, and is still there. It is
  true when every one of them is `done` without a failed chapter, or `paused`,
  and false otherwise; a download the task did not cover is not judged. At
  9bda89e every download was: on the owner's iPhone, Pause all at 19:26:49
  finished the task with `complete with success: 0` at 19:26:52, because an
  old download of another Document sat `blocked` (notes 19:26). An expiry is
  never a success; the module completes that task with `success: false`
  itself. Every native call waits for the one before it, so a new submission
  never lands between a finishing task's last report and its finish.
- **Expiry, and the owner's stop.** The owner decided on 2026-09-28 (#77),
  from what the iPhone showed, that the Live Activity's stop is Pause all. On
  `continuedExpired`, on the screen or away, `continued.expired()` names the
  downloads the task covered that still go on by themselves (`GOES_ON`), and
  each is paused as Pause all pauses it (`pausing.pauseAll`: every chapter not
  failed in `paused`, the state `paused`); the downloads are then saved.
  Downloads already stopped (`blocked`, `interrupted`, `paused`, `done`) are
  left as they are. An `interrupted` one, stopped away from the screen at a
  chapter not prepared, is queued again at the next opening as before; the
  opening that the stop itself causes does that before the end arrives, so in
  the phone's order it is going on again by then and is paused with the rest.
  Away, `expired` is also set, as the app has no background time left.
  Opening the app then resumes nothing and, with nothing going on by itself,
  submits nothing; the owner resumes with Resume all, which submits again.
  It applies on the screen too, because the stop itself opens the app: on
  the phone SpringBoard logged `Received request to open
  "top.xujialiu.openreader" … on behalf of ActivityProgres` at the tap
  (19:19:38), the app was in front for about 4 s and back in the background
  at 19:19:43, and the task ended at 19:19:48–49, 10 s after the tap. The
  second stop ended it 4.0 s after the app reached the background.

  Until then (9bda89e) the end was an interruption, as the bounded task's
  `expired` is: away, preparing and downloading became `interrupted`, and on
  the screen nothing changed. On the phone the app was suspended 0.15 s and
  1.3 s after the two ends, no clip was saved until it was opened, and each
  opening queued the download again and submitted a new task, accepted with
  the same Live Activity. To the owner, the stop stopped nothing.

  **Every end is taken as the owner's stop**, because the public API gives the
  handler no reason and nothing private is branched on (above). What is given
  up: when the phone ends the task under pressure, the download is paused
  too, and stays paused until the owner taps Resume all, where the first
  version went on at the next opening. The owner accepted that on 2026-09-28
  unless the two can be told apart reliably, which is what the logged values
  are for. The pause is saved after the event, and the module completes the
  task right after sending it. A save not finished when the app is suspended
  finishes when it resumes; it is lost only if the phone ends the suspended
  app first, and the next launch then restores the download as going on.

## What the owner's iPhone showed, and what is not yet known

The first run on the owner's iPhone 16 Pro (iOS 27.0, 24A437), Release
0.0.2-beta45 at 9bda89e, is in `notes/NOTES_2026-09-28.md`, 19:26. The
submission after Download selected and the two made when the app was opened
were accepted at once. Locked, with nothing playing, clips were saved in every
10 s bin (4 to 12 per bin) for over five minutes, and the download crossed
chapter boundaries (nav.5 to nav.8) with their text prepared ahead (#76). The
Live Activity read `2 of 15 chapters` with a circular progress. The phone's
own prompt to continue came at about five minutes and 16% (Progress, above),
and what the stop did is under "Expiry, and the owner's stop".

**The Dynamic Island (#90).** On 2026-09-29 (`notes/NOTES_2026-09-29.md`,
21:05), on the same iPhone with 0.0.2-beta54 and Debug Mode, the island showed
the Live Activity expanded (about 374 × 90 pt) over the Home Screen, with
`My Vampire System —…`, `2 of 250 chapters` and the stop ring, and it went back
only when the owner swiped it up. The system log
(`/tmp/openreader-island-0929/system.logarchive`, SpringBoard's categories
`SpringBoard:Activity`, `SpringBoard:SystemApertureHosting` and
`SystemAperture:*`; times local, UTC+8) shows it is the phone's own start
alert. The submission at 20:27:46.698 started activity `606D6C66…` (client
`com.apple.ActivityProgress.ActivityProgressUI`) at 20:27:46.838, with
`creating system aperture element`, then `Presenting a prominent alert`,
`adding to pending alerts`, `alerting with sound` and `Turn on screen`. At
20:27:46.913 SpringBoard logged `Created alerting activity assertion
(<SAUIAlertingAssertion …; locked: NO; invalidation interval: 3; timer
scheduled: NO>)` with a preferred layout `custom` for the reason `alerting
activity`, and in the same instant `Automatic invalidation disabled:
<SAUIAlertingAssertion …; locked: YES; invalidation interval: 3; timer
scheduled: NO>`. Each time the app left the screen (20:27:49.505,
20:28:29.828, 20:29:20.853) the element went `layoutMode: none -> custom`,
expanded, and each return `custom -> none`. After the last departure it stayed
expanded for 178.6 s with the app away, until 20:32:19.458: `Update preferred
layout mode … compact; _layoutModeChangeReason: user interaction`, the
alerting assertion invalidated with `layout mode changed by user interaction;
locked: YES; … timer scheduled: NO`, `invalidating alerting assertion` and
`layoutMode: custom -> compact`, the owner's swipe. The app's own updates
raised no alert: its subtitle changed at 20:29:27.527 and 20:31:13.531 (Debug
Log `continued task shows …`) with no layout change after either; every later
departure went `none -> compact`; away from 20:37:21.617 to 20:48:09.998 the
subtitle changed six times (20:37:53 to 20:46:32) and the element never left
`compact`; and the submissions after the next two launches (activities
`59C7EFF7…` at 20:48:31.784 and `F4DF5CEA…` at 20:49:48.428) raised no alert.
At the completion, `continued task finished, succeeded` at 20:51:41.564 with
the app in front, the element alerted again at 20:51:41.696 (`alerting with
sound`, layout `custom`, `Automatic invalidation disabled … locked: YES`), and
at 20:51:47.705 the phone invalidated that assertion itself with
`SBActivitySystemApertureElementObserver's
dismissAlertForActivityAlertProvider`, 6.0 s later. So the start alert's
three-second automatic invalidation is disabled the moment it is created and
nothing re-enables it, while the completion alert is dismissed by the phone.

Nothing public controls it. `BGContinuedProcessingTaskRequest` takes an
identifier, a title, a subtitle, a `strategy` and `requiredResources`, and
`BGContinuedProcessingTask` offers `updateTitle(_:subtitle:)`, `progress` and
`setTaskCompleted(success:)`; none bears on how the Live Activity is
presented. The owner decided on 2026-09-29 (#90) to accept it, record it and
report it to Apple. An ActivityKit Live Activity of the app's own would add a
second card beside the phone's, not replace it, and giving up the continued
task would bring back the download stopping within a minute of leaving the app
(#77).

**Closing the app from the app switcher (#91).** On the same phone and build
(notes 21:15, `/tmp/openreader-island-0929b/system.logarchive`), the owner's
Lock Screen at 21:00 showed two OpenReader cards under Background Activities:
`My Vampire System — Chap…` / `Task failed` with an `!`, and
`My Vampire System — Chap…` / `17 of 250 chapters` with the phone's
prompt to continue. The app ran one continued task at a time throughout. At
20:48:30.249 SpringBoard logged `SBWorkspaceTerminateApplication:
top.xujialiu.openreader: "killed from app switcher"`, and dasd `CANCELED
bgContinuedProcessing-…download.18DF6850…` at .304, progress
`CANCELLED`. After the next launch the app submitted
`…download.1FCD6BA0…` at 20:48:31.770, and SpringBoard started
activity `59C7EFF7…` at .784. The first task's activity `72C73F55…` was
`dismissed` at 20:48:54.899, 24.6 s after its cancellation, the cover sheet
having been pulled down at 20:48:50; what dismissed it is not in the log.
Closed from the switcher again, dasd logged `CANCELED
…download.1FCD6BA0…` at 20:49:46.818, and the app logged nothing: it is
not told, as the article says (Expiration, above). The next task
(`305A3A20…`, activity `F4DF5CEA…`) ran to `247 of 247`, `complete with
success: 1`, and its activity was `dismissed` at 20:51:41.664; the one after
(`360CC697…`, activity `CDEA5FA7…`) was submitted at 20:53:10.788 with
the app in front. Between 21:00:01 and 21:00:12 ActivityUIServices brought
activity `59C7EFF7…`, the task cancelled at 20:49:46, to the foreground on
the Lock Screen: the `Task failed` card, still there 10 min 15 s after its
cancellation, beside the running task's. So the second card is not a second
task but what the phone keeps of a task it cancelled. No public API lets the
app end or clear the Live Activity of a continued task it no longer holds, and
its next launch cannot reach the cancelled one; the owner clears it with the
✕ beside Background Activities. Nothing saved is lost.

Not yet known: what Stop in the phone's own prompt does, presumably the same
expiry; what the logged values look like for an end the phone chooses; whether
a download waiting for the network is expired as stalled; whether
`success: false` looks different from `true`; and what dismissed the
`72C73F55…` card 24.6 s after its cancellation, and whether a `Task failed`
card ever goes by itself.
The simulator has to show that its refusal is the documented `unavailable`
and that the bounded fallback still behaves as measured at 02:49.
