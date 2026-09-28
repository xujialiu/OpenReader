# Downloads and offline narration

## Offline narration and reader actions

Current offline data lives in `Documents/offline-narration-v2`, including
`catalog.sqlite` and any SQLite WAL/SHM files. The unreleased JSON store was
discarded with the owner's approval; do not restore pre-SQLite backups. Create
fresh fixture downloads before testing persisted playback or management.
Terminate the app before taking or restoring a complete offline-directory
backup so an open database connection cannot keep writing to replaced files.
After restoration, launch the app again before testing.

With the current Debug app connected to Metro and the fixture Document `A Short Test of Reading Aloud` in the Library:

```sh
bash test/manual-test/kit/run-probe.sh OfflineProbe SIMULATOR_UDID /tmp/openreader-offline-inspect --mode inspect
```

This uses real XCTest touches to check the three-action drawer, font-size stepper, keyboard-visible rename/save and restoration of the fixture's original display name. It then checks persisted download completion, or selects chapters if the fixture has not yet been downloaded. It never presses Play. Review the exported screenshots as well as the assertions.

To exercise management and deletion against an already completed fixture, use `management` instead of `inspect` after making a complete backup of the stopped app's `Documents/offline-narration-v2` directory. The mode uses real XCTest touches to enter Manage downloads, select the first chapter, confirm Delete downloaded audio, and assert that only the second chapter remains with its measured saved size. Stop the app before restoring that same SQLite-format backup, then relaunch it before handing the simulator back; this mode does not prove deletion of a document from the library or playback of the remaining chapter.

To verify display-name persistence across a cold app restart, use `alias` instead of `inspect`. The mode uses real Rename touches, terminates and relaunches OpenReader, checks the alias in Library and Reader, then restores the fixture's original name. It does not prove persistence across an OS reboot or a library file migration.

To exercise real synthesis and persistence, configure a provider in the app and use `download` instead of `inspect`. This selects and downloads the entire short fixture and may spend provider quota; it never downloads the owner's other documents. The fixture has 17 speakable utterances in two chapters. Already completed audio is reused; start this mode with an incomplete fixture if testing the actual Download selected button.

To verify indexed progress for a second voice without provider quota, stop the app's current work first and run the disposable synthetic-fixture mode:

```sh
bash test/manual-test/downloads/second-voice-progress.sh SIMULATOR_UDID /tmp/openreader-second-voice-progress-01
```

The wrapper backs up and restores the complete v2 offline directory, Library and settings, then adds one known shared clip for a synthetic second voice to the short fixture. The XCTest uses real touches to open Download, choose that saved voice and require `0 chapters downloaded` plus `1 / 7` for the second chapter. The synthetic row and copied audio are removed by restoring the backup even when the test fails. This checks indexed SQLite progress and the omitted-text `textCount` display; it does not test provider synthesis or playback.

After the fixture is downloaded, silence the device with `silence.sh set SIMULATOR_UDID`, terminate and relaunch the app with `xcrun simctl` to empty the memory cache, then run:

```sh
node test/manual-test/downloads/offline-playback.cjs SIMULATOR_UDID
```

This reuses `cdp.cjs` to reject all fetches, temporarily disable the fixture's Fish provider, and route every newly created native audio source through a zero-gain node before Play. It checks actual saved-audio decoding, an active native playback queue and word-timing state, then immediately pauses. A five-second app watchdog and host cleanup also pause on failure. It prints the measured duration and network request count, restores settings/fetch, and keeps generated debugger expressions in a temporary directory. The zero-gain route is additional silence protection for the iOS 27 simulator, whose Control Centre had no volume slider; the `0.6` its `outputVolume` reported is the device's own `sim_volume`, which `silence.sh` now sets to zero. This is a handler probe, not a real Play touch, a physical connectivity test or a drift measurement. Restart the app afterwards to remove debugger instrumentation and verify it remains paused.

`OfflineProbe`'s `background` mode presses Home, waits 40 seconds to cover the bounded UIKit background-task window, then returns to the app without playback. Use it with a controlled queued task and observe the persisted task state from the host; the UI test alone proves only that the app can be left and reopened, not that synthesis continued or resumed.

## Issues #13/#14: a fresh Library, Fish from empty settings, and the two destructive confirmations the other probes always cancel

`OfflineFixProbe.swift` covers what none of the other probes do: a device that has
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
bash test/manual-test/kit/run-probe.sh OfflineFixProbe SIMULATOR_UDID /tmp/openreader-offline-fix-01 \
  -only-testing:testConfigureFishProvider
```

Real touches: Settings → Providers → Fish Audio, types the key read from
`/tmp/openreader-fish-key.txt` (never printed, logged or checked in — write
it there from `~/.secrets/openreader/` per MEMORY/device-testing.md before this method runs, `chmod 600`
it, and remove it afterward) into the still-masked field, taps Enable, and
waits for "Connection successful". `Show API key` is never tapped, so no
capture here can show it. Skips the enable step if a previous run already
left the provider enabled.

**A successful Fish connection check can still leave Voice empty on the next cold reader.** Measured 2026-09-26 on the dedicated iPhone 17: the connection row passed, but `testChooseVoiceForShortFixture` found no rows after a relaunch. Sending the walkthrough commands `{"do":"ask","provider":"fish"}` and then `{"do":"voicelist","provider":"fish","n":3}` after the reader was open populated the cached list; the next real Voice touch found `jjk narrator`. Treat an empty Voice sheet after a successful key check as a list-prefetch failure and ask the provider again before testing narration.

`testChooseVoiceForShortFixture` opens the short fixture and taps whichever
Fish voice sorts first (this is a download/playback mechanics check, not a
locale-picker test — `ReaderProbe`'s `fish` mode already covers real navigation to a
specific locale, `voices-and-providers/README.md`). Choosing while paused leaves the sheet open by design
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
without using Contents — this fixture's nav/spine mismatch (documented in
`library-and-reader/README.md`, `LibraryActionsProbe`) makes every Contents row inert here too, so the
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

## The download ring, pausing, and Manage downloads' listed-chapters rule (#37, #38, #56)

With a fresh Library (no provider configured, no saved audio) holding only `A
Short Test of Reading Aloud`, and the Fish key staged at
`/tmp/openreader-fish-key.txt` (`chmod 600`, never printed) as in **Issues
#13/#14** above:

```sh
bash test/manual-test/kit/run-probe.sh DownloadRingProbe SIMULATOR_UDID /tmp/openreader-download-ring-01 \
  -only-testing:testDownloadRingLifecycle
```

Real XCTest touches throughout, spending the fixture's 17 Fish utterances for
real: configures Fish Audio and chooses its first-sorting voice exactly as
`OfflineFixProbe` does, opens Download and requires `0 chapters downloaded`
with neither `Manage downloads` nor `Pause all`, selects both chapters and taps
`Download selected (2)`. Chapters are written from the top of the list down
(#56), so it waits for the first chapter's ring to read `Pause download` and
requires `Pause all` opposite `Manage downloads`. It then:

1. taps the first chapter's own ring and requires that ring alone to become
   `Resume download` while the second chapter's still reads `Pause download`,
   and no `Paused` line anywhere (three screenshots follow, `03-second-running-N`);
2. taps `Pause all` (if the second chapter has not already finished) and
   requires `Resume all` in its place, no ring reading `Pause download`, and
   still no `Paused` line;
3. opens Manage downloads while paused, where the same place holds `Delete all
   saved audio` and not `Resume all`, and goes back;
4. taps the first chapter's ring again and requires it alone to resume;
5. waits up to 60 s for `The First Chapter, downloaded`; if the second chapter
   is still paused, requires `Resume all` (the download is paused with only
   that chapter left) and taps it;
6. waits up to 90 s for `2 chapters downloaded`, with no ring and neither
   `Pause all` nor `Resume all` left, checks Manage lists both chapters as
   checkboxes, and leaves the Download drawer open on the plain view.

A ring's label says what a tap does, not which chapter it is on, so the probe
finds a chapter's ring by position: the `Pause download` or `Resume download`
button at the height of the chapter's title and to its right
(`ring(beside:)`). A second method, `testReopenDownloadDrawer`, just reopens
that same drawer on an already-downloaded fixture and leaves it open — used to
restore the final state after a separate run (such as `OfflineProbe`'s `management` mode)
has left the app elsewhere.

The first two steps race the provider: the fixture's chapters take seconds
each, and a fast connection can finish the second chapter before `Pause all`
is tapped, which the probe allows for rather than fails. Say in the report
which branch a run took. It establishes the per-chapter and whole-download
pause through real touches and screenshots; the order rules the fixture cannot
show (a chapter resumed above the one being written waits for it; adding
chapters leaves paused ones paused) are unit-tested in
`test/offline/scheduler.test.ts` and `test/offline/runtime-pausing.test.ts`.

Measured 2026-09-22, on the #38 version of this probe, whose ring paused the
whole download: the full lifecycle passed in 73.6 s including the Fish
provider setup and voice choice; the spinning-arc "preparing" phase was caught
(`Preparing selected chapter…` visible in at least one frame) but is not
guaranteed to be — the short fixture's per-chapter text is small enough to
count in well under one screenshot interval, so treat its absence in a given
run as inconclusive, not a defect, and say in the report whether that run
happened to catch it (the probe prints `SAW PREPARING TEXT BEFORE THE FIRST
RING`). The ring's accessibility tree entries are `Button` elements 24×24pt
with label `Pause download` or `Resume download` (`Continue download` before
#56; matching `SIZE` in `download-ring.tsx`); a plain chapter checkbox row is
an `Other` with `value: checkbox`, not a `Button`, so query it with
`app.descendants(matching: .any)` as the existing offline probes do, never
`app.buttons`. This does not measure highlight timing, drift, or anything
about playback, and it does not by itself prove the ring is legible against
the sheet background in Dark (a ring only renders during an incomplete
download, so checking Dark without a second real download needs either a
fresh, unfinished task or visual inspection of the saved light-mode
screenshots' contrast against the app's dark palette).

The two-chapter fixture cannot show order independent of tap order, pausing
the chapter being written leaving the *next* chapter to finish while the
paused one stays put, the ring in Manage downloads, or adding a chapter while
another stays paused — `PauseOrderProbe.swift` drives
these on a disposable five-chapter fixture instead
(`test/manual-test/fixtures/pause-order-fixture.ts`, seeded through the harness like
any fixture, never checked into the Library by the generator itself):

```sh
bash test/manual-test/kit/run-probe.sh PauseOrderProbe SIMULATOR_UDID /tmp/openreader-pause-order-01 \
  -only-testing:PauseOrderProbe/testOrderMixedAddAndRingSweep
# host-level restart between the two methods — never an in-test app.terminate()/launch()
xcrun simctl terminate SIMULATOR_UDID top.xujialiu.openreader
xcrun simctl launch SIMULATOR_UDID top.xujialiu.openreader -RCT_jsLocation localhost:PORT
bash test/manual-test/kit/run-probe.sh PauseOrderProbe SIMULATOR_UDID /tmp/openreader-pause-order-02 \
  -only-testing:PauseOrderProbe/testOrderAfterRestart
```

Chapters one and two are tapped in reverse order and left untouched, so which
finishes first is the order proof — a ring's own accessibility label carries
no fraction, only halted or not, so it cannot show which in-task chapter is
actually being written this instant (measured 2026-09-24: chapter one, tapped
second, finished first every time). Chapters four and three (tapped four
first) drive the rest: three carries extra sentences so there is a window to
pause it before it finishes on its own, pausing it lets four proceed to
completion while three stays paused throughout — the mixed-state label and
the ring inside Manage downloads are read in between, tolerant of chapter
four finishing first on a fast connection exactly as `DownloadRingProbe`
already tolerates for its own two chapters (measured 2026-09-24: the Manage
ring case raced away in 2 of 4 runs, in which case only the code
(`marker()`'s manage branch, `src/app/download-rows.ts`) stands behind that
one sub-claim). Chapter five is added last, while three is still paused, and
the method ends with three paused and five mid-flight or queued for the
host-level restart; `testOrderAfterRestart` reopens the drawer, requires
three still paused and five finished without a tap, resumes three and
finishes the download. Real spend: 19 short utterances across five chapters,
a fraction of `DownloadRingProbe`'s per-run cost.

## A download away from the screen, and beside a Reading (#75, #76, #77)

`download-away.cjs` hands chapters to the runtime's `enqueue`, waits for the
first ten clips, then takes the app away for `AWAY_SECONDS` and brings it
back, printing the clip count and the task's state every 5 s and a summary of
when clips were saved relative to leaving and coming back. The clip times are
the files' birth times in `Documents/offline-narration-v2/<document>/<voice>/`,
so the timeline holds while the app's JavaScript cannot answer; the task's
state is read through `cdp.cjs` whenever it can. At the end every chapter of
the task is paused through `toggleTask`, so nothing goes on spending.

```sh
export OPENREADER_METRO=http://127.0.0.1:PORT   # not localhost (Pitfalls, cdp.md)
node test/manual-test/downloads/download-away.cjs home     UDID DOCUMENT_ID fish VOICE 90 nav.2 nav.3 …   # Settings in front
node test/manual-test/downloads/download-away.cjs lock     UDID DOCUMENT_ID fish VOICE 90 nav.19 …        # device locked
node test/manual-test/downloads/download-away.cjs play     UDID DOCUMENT_ID fish VOICE 20 nav.16 …        # a Reading plays
node test/manual-test/downloads/download-away.cjs playlock UDID DOCUMENT_ID fish VOICE 120 nav.23 …       # a Reading plays, locked
```

Prerequisites: Fish configured (`OfflineFixProbe … -only-testing:testConfigureFishProvider`),
the Document in the Library (`{"do":"add"}` through the harness), and the
chapter ids from `download-chapter.cjs … --list`. Choose chapters without saved
audio: a chapter already complete is skipped and saves nothing. `play` and
`playlock` open the Document, choose the voice through the harness, set the
simulator's volume to zero and check it immediately before Play, and pause
afterwards; the duration is the away time, so derive it from what is measured
(20 s shows whether clips stop; crossing a chapter boundary while locked needs
about a minute more than the chapter takes). Until #75 the app held every
download back while a Reading played; the notes of 2026-09-28 name a
`PRETEND_NOT_PLAYING=1` that bypassed that hold after Play, by calling the
runtime's `playbackActive(false)`, to measure a download beside a Reading
before the app allowed one. The hold and the option went with #75: `play`
and `playlock` now measure the app as it is.

`lock-device.sh UDID lock|unlock` presses the simulator's own lock button
through XCTest (`DeviceLockProbe.swift`, `pressLockButton` by selector) and
opens it again with two Home presses; the first call builds the probe into
`/tmp/openreader-lock-device` (about 30 s, and again whenever the probe's
source is newer), later calls take 15–35 s, and the press comes about 20 s
into the call, so `away (locked)` is marked about 4.5 s after the actual lock
(`lock.log`'s `Pressing lock button` is the real moment; Pitfalls,
[lock-and-background.md](../pitfalls/lock-and-background.md)). What neither
can show: the phone's own background time (the simulator's was longer than
the phone's usual half minute), and anything about the system's continued
processing tasks, which the simulator does not run. A simulated lock passes through `active` once on the way (Pitfalls,
simulators.md).

`download-lock-at.cjs` locks at a moment of the download it chooses, for what
a lock at an arbitrary moment rarely meets: a chapter boundary crossed while
locked, or a preparation out when the app leaves (#76). It starts
`lock-device.sh UDID lock-on FILE` first, which waits in `testLockOnSignal`
and presses within about 0.05 s of FILE appearing, enqueues, samples the task
about four times a second, and creates FILE when WHEN holds; then it watches
AWAY_SECONDS locked, unlocks, brings OpenReader back, watches 40 s and pauses
every chapter of the task, like `download-away.cjs`.

```sh
node test/manual-test/downloads/download-lock-at.cjs UDID DOCUMENT_ID fish VOICE 120 left:5 nav.69 …     # lock with five texts of the chapter left
node test/manual-test/downloads/download-lock-at.cjs UDID DOCUMENT_ID fish VOICE 90 preparing nav.130 …  # lock while its text is being prepared
```

`left:N` reads the chapter's saved count from the progress the Download
drawer also asks for (`requestProgress`, asked once). `preparing` needs a
chapter whose text is not prepared and a download not already running, so
that the hidden rendering mounts first and the preparation takes 1–5 s; the
app leaves the screen 0.5–0.8 s after the press. Measured 2026-09-28 (#76):
`left:5` — the next chapter, prepared ahead, began 3.8 s after the lock and
saved 20 clips until the background time ran out 31.6 s after it;
`preparing` — the preparation was withdrawn as `PreparationInterrupted` the
moment the app went inactive, and the download read `interrupted` for 104 s
and went on 1.2 s after the return.

To see how each preparation ends, a probe through `cdp.cjs` can poll
`preparationRequest()` every 100 ms and wrap the returned request's own
`resolve` and `reject`, which the runtime calls on it, so a rejection's name
and message are logged without changing what happens (restart the app
afterwards; Pitfalls, cdp.md). Stutter while a download starts is measured on
a `simctl io recordVideo` of `fling-jump.sh`'s flicks: the recording has a
frame only when the screen changes, so a gap between frames while the page
moves is a hitch (`frame-gaps.py VIDEO`). Every flick's first frame comes
62–67 ms after the last, with or without a download; measured 2026-09-28, a
download's start added one 242–373 ms hitch 0.3–0.8 s after the enqueue,
whether or not it prepared anything, and the ten preparations ahead that
followed added none.

Three tools for every chapter prepared ahead (c7de45e) and the JavaScript
thread under it, with `OPENREADER_METRO=http://127.0.0.1:PORT`:

```sh
node test/manual-test/downloads/download-ahead.cjs install DOCUMENT_ID 10     # in-app: every request, AppState, lag; until a relaunch
node test/manual-test/downloads/download-ahead.cjs fail SECTION MAX           # handler probe: fail that section's requests MAX times
node test/manual-test/downloads/download-ahead.cjs read [OUT.json]            # requests in order, overlaps, missed tokens, durations, lag
node test/manual-test/kit/cdp-rtt.cjs SECONDS [INTERVAL_MS]             # the thread's answer time, from outside
node test/manual-test/kit/cdp-profile.cjs FILE SECONDS OUT.json         # Hermes's sampler around evaluating FILE
bash test/manual-test/kit/lock-device.sh UDID home | home-on FILE       # a real Home press (axe's does nothing)
```

Measured 2026-09-28 on `iPhone 17 download` (iOS 27.0), Debug `0.0.2-beta45`
(8aa75f6), Fish `s2.1-pro-free` at five at once, the Mac on a phone's hotspot;
artifacts in `/tmp/openreader-final-sim/`:

| Run | What happened |
| --- | --- |
| 40 fresh chapters of *My Vampire System*, Home after 11 | writer's first preparation 10.4 s; 18 ahead in 1.9 s, then the one out withdrawn as `PreparationInterrupted` in the same ms as `inactive`; no request for 24.4 s away; again 115 ms after `active`, all 40 prepared 3.1 s later, 32 s before the first chapter was written; list order, no overlap |
| Every chapter (2,077) of a 34 MB Chinese book, 300 s in front, reader open | 794 prepared, 795 requests seen at 10 ms, no overlap; median 263 ms outside XCTest launches, first and last hundred 275 and 254 ms, slope −0.16 ms per chapter prepared; JS lag worst-per-second median 25 ms (17 with nothing running); CDP round trip median 4 ms, p95 62, max 447; flings at 30, 150, 260 s: frames p95 33 ms and 1–3 gaps over 100 ms, against 37–42 ms and 2–5 with no download |
| The same book's download resumed in a new process, profiled | one JavaScript stall of 1.7 s (2.5 s in the run above), all in `injectWebViewVariables` of `@epubjs-react-native/core`: the hidden rendering's `Reader` puts the whole EPUB, base64, into its HTML template, and 14 `String.replace` calls scan it (#78) |
| `fail` 1, 2, 3 times | 1: one warning, retried after the next chapter, never `preparing`; 2: two warnings, the writer read `preparing` and prepared it; 3: `blocked`, `Provoked failure 3` |
| `download-away.cjs playlock` 120 s, fresh nav.229–232 | three chapter boundaries 2.6, 52.8 and 109.7 s after `background`, all prepared ahead 40 s before the lock; no `expired` in 155.8 s; never `interrupted` |
| `download-lock-at.cjs … left:30`, nothing played, new process | next chapter 17.5 s after `background`; `expired` 27.0 s after it, `interrupted` 0.12 s later with no error; `downloading` 0.25 s after the return |

## A Reading paused and played with the phone locked, and the drawer beside a Reading (#75)

Four more tools, all against a running app (none relaunches it), with
`OPENREADER_METRO=http://127.0.0.1:PORT`:

```sh
node test/manual-test/downloads/download-sampler.cjs install DOCUMENT_ID       # in-app, once a second, until a relaunch
node test/manual-test/downloads/download-prepare.cjs DOCUMENT_ID fish VOICE nav.LAST nav.A nav.B …   # text only, no clip
node test/manual-test/downloads/download-lock-pause.cjs UDID DOCUMENT_ID fish VOICE 45 60 30 nav.F nav.A nav.B …
EXPIRE_AT=20 node test/manual-test/downloads/download-lock-pause.cjs UDID DOCUMENT_ID fish VOICE 45 30 30 nav.F nav.A …
node test/manual-test/downloads/download-sampler.cjs read SINCE_MS [UNTIL_MS [OUT.json]]
bash test/manual-test/downloads/download-drawer.sh UDID NEW_DIR testOpenDrawer
SCROLL_TO=nav.N bash test/manual-test/downloads/download-drawer.sh UDID NEW_DIR testReadDrawer
SCROLL_TO=nav.N bash test/manual-test/downloads/download-drawer.sh UDID NEW_DIR testRingThenPauseAllAndResumeAll
bash test/manual-test/kit/lock-device.sh UDID play|pause                # the lock screen's own centre button
```

- `download-sampler.cjs` records, inside the app, the Reading's `playing`,
  `buffering` and Utterance and the download's state once a second, every
  `AppState` change and every `expired` event of the offline module. It is the
  only thing here that shows whether the background time ended, and when; a
  gap in its samples is the app's JavaScript not running.
- `download-prepare.cjs` is set-up for runs away from the screen, where a
  chapter boundary blocks the download in the branch that has only #75 (#76;
  Pitfalls, verification-runs.md): it prepares chapters' text in the
  foreground by pausing each chapter while it reads `preparing`.
- `download-lock-pause.cjs` reads aloud, locks, pauses through the harness
  after `PAUSE_AFTER` s (the harness is answered while locked, because the
  Reading keeps the app running), watches `PAUSED_FOR` s, presses the lock
  screen's own Play (`lock-device.sh play`, a real XCTest tap on SpringBoard's
  `UIA.MediaControls.NowPlaying.CenterButton`, one Home press to wake a dark
  screen first), watches `PLAY_FOR` s, unlocks and pauses. It prints the task's
  state both through CDP and as last persisted in a copy of `catalog.sqlite`,
  which is readable while the app is suspended. `EXPIRE_AT` emits `expired`
  from JavaScript: a handler probe, needed because the simulator never ended
  the background time in a process whose Reading had played (Pitfalls,
  simulators.md).
- `download-drawer.sh` runs one method of `DownloadBesideReadingProbe` (real
  touches, built once into `/tmp/openreader-download-drawer`): open More
  actions › Download; read the state line and the rings and take two
  screenshots 3 s apart; or tap the first hittable `Pause download` ring, then
  Pause all, Resume all and Pause all again, checking each turns. `SCROLL_TO`
  brings a chapter's row into view first (a CDP handler), since the ring of a
  chapter far down a long book is not rendered until the list is scrolled.

Measured 2026-09-28 on `iPhone 17 download` (iOS 27.0), Debug `0.0.2-beta42`
(774a34b, 3d0857b), Fish `s2.1-pro-free` at five at once, `My Vampire System
1-250.epub`, times UTC:

| Run | What happened |
| --- | --- |
| `download-away.cjs play`, 60 s, fresh nav.172–175 | 99 clips during 62 s of reading (51 + 48), 53 in the 41 s after Pause; `downloading` at every 5 s sample; the Reading playing at all 12 samples and all 61 sampler samples, Utterance 112 → 135, one buffering of about 1 s at the first clip, no Utterance held longer than 3.0 s |
| `playlock`, 120 s, fresh nav.241–243 | clips until the chapter boundary 27.6 s after `background`, then `preparing` and `blocked` 60.7 s later (#76); never `interrupted`, no `expired` in 139.8 s in the background, the Reading playing at every sample |
| `playlock`, 120 s, fresh nav.192, prepared nav.193–194, fresh nav.195 | 140 clips after the first 30 s, the last 112.8 s after `background`; `preparing` at the fresh chapter from 113 s; no `expired` in 140.8 s; never `interrupted` |
| `download-lock-pause.cjs` 45/60/30, fresh nav.196, prepared nav.197–199 | paused through the harness while locked; the download went on through all 75 s paused (117 clips); no `expired` |
| the same, 45/240/20, prepared nav.215–222 | 399 clips in 256 s paused while locked; no `expired` in 341 s in the background |
| the same with `EXPIRE_AT=20`, fresh nav.211, prepared nav.212–214 | after the emitted `expired` the download went on (44 clips in 26 s); Pause while locked: `interrupted` in the same 1 s sample, 5 clips already asked for saved within 3.0 s, then none until the lock screen's Play, 40 s later: `downloading` again in the same sample as `playing`, first clip about 2 s after; unlocked, it went on |
| Reader (drawer opened), Library (harness `shut`), locked 61 s | 71 clips in 52.6 s in the Reader, 52 in 35.1 s in the Library, 97 in 61.1 s locked, `downloading` and playing at every sample, no `expired` |
| `download-drawer.sh` while a Reading played, about 16 s | `Downloading…` in both reads 3 s apart, 4 rings reading `Pause download` on screen, the ring of the chapter being written from about 44 % to 50 % of its circle |
| `home` 90 s, no Reading in the process | `expired` 25.5 s after `background`, `interrupted` 0.6 s later, clips stopped; `downloading` 0.1 s after coming back, first clip 10.3 s later (Fish's idle connection, Pitfalls) |

What these cannot show: a phone's own background time, whether a phone ends
it while a Reading plays or after one is paused (#77), and anything about
Speechify's queue, which is unit-tested and was not spent on.

## Two fingers: Files' own selection, and the download drawer's copy (#57)

`TwoFingerProbe.swift` makes two-finger drags (see **Pitfalls › XCTest**) and
`two-finger.sh` runs it. Files first needs rows to sweep: launch Files once on
the device, then

```sh
bash test/manual-test/downloads/two-finger.sh SIMULATOR_UDID stage   # 60 files in On My iPhone › Rows
bash test/manual-test/downloads/two-finger.sh SIMULATOR_UDID /tmp/openreader-two-finger-01 \
  -only-testing:TwoFingerProbe/testFilesBackTowardStart
```

The `testFiles…` methods are the measurements of ADR 0045 (notes 2026-09-24,
02:23 to 03:13); each opens Files afresh on `Rows`, switches the folder from
icons to a list through `More` › `List` if it is showing icons, sweeps, and
prints a `MEASURE` line with the rows Files reports selected (`isSelected`) and
the first row fully in view, which says how far the list scrolled (64 pt a
row). `testFilesEdgeTrembling` holds the fingers with a 1.5 pt tremble: a
perfectly still synthesized hold sometimes stopped Files scrolling at all,
which a real finger does not do. A quick start (19.2 pt every 60 ms) begins
Files' run a row late, because its recogniser fires 26–38 pt after the fingers
come down; move slower when the first row matters.

The `testDrawer…` methods need OpenReader already on a reader whose drawer has
a long list — a part from `~/Works/epub_books` (**Real books**) shows the edge
scrolling; `Shadow Slave 1-250` gives 256 rows — and they `activate` the app
rather than relaunch it, so a worktree's device stays on its Metro (launch it
with `-RCT_jsLocation localhost:PORT` from the host first). Each opens the
Download drawer afresh. `testDrawerSweeps` prints `DRAWER` lines with the
`Download selected (N)` count after each sweep: measured 2026-09-24 at 03:04, 4
for the first row to the fourth, 2 after a sweep that begins on a selected row
goes to the fourth and back to the second, 4 when one finger carries on alone,
26 after a hold past the list's bottom edge for 1 s (Chapters 16–20 then in
view), and unchanged after a one-finger drag. `testDrawerOneFingerNeverChooses`
compares `swipeUp()` with a synthesized drag (**Pitfalls › XCTest**): measured
again 2026-09-24 verifying #56/#57 together, 4 of 6 `swipeUp()`/`swipeDown()`
changed the count and 0 of 6 synthesized drags did.

Added 2026-09-24, same file: `testDrawerTopEdge` scrolls down first with a
synthesized one-finger drag, then holds at the *top* edge and requires the
shown rows to change (measured: Chapter 25–29 back up to Chapter 2–6, 29
chosen). `testDrawerLongStretchSmoothness` holds at the bottom edge for 3 s —
not longer; see **Pitfalls › XCTest** for why — and requires the shown rows to
differ from before the hold (measured: Part 1 to Chapter 72–76, 81 chosen,
`chosen` climbing 5 → 28 → 50 → 74 across a `recordVideo` capture's frames a
second apart, no stall or drop). `testDrawerOneFingerTapToggles` confirms a
plain one-finger tap still selects, then deselects, a row (via `chosenCount()`,
not `.isSelected` — **Pitfalls › XCTest**). `testDrawerCheckedRowsUnaffectedBySweep`
and `testDrawerManageSweepSelectsForDelete` need the short fixture already
downloaded (run right after `DownloadRingProbe`'s `testDownloadRingLifecycle`,
while its reader is still the active one `openDrawer` reuses): a sweep across
downloaded rows chooses nothing, and a sweep across saved rows in Manage
downloads chooses them for `Delete selected (N)`, which the method then
actually taps through — fine for this fixture, never the owner's.

What it cannot establish: that a real hand does the same — a real finger
trembles, flicks and lands 20–40 pt apart, where these are two exact paths 36 pt
apart; Files' top edge band (a hold over its search field could not be read
back); how the drawer behaves past a 3 s hold, given the synthesis limit above;
and a collapsed volume's sweep behaviour on a device, since no book in
`~/Works/epub_books` has a nested contents list to sweep (checked 2026-09-24:
every part's `toc.ncx` is one flat level) — `range-selection.test.ts` is the
only coverage of that rule.

## Several sentences at once (#64, `download-concurrency.ts`)

`download-concurrency.ts` measures how fast a provider answers with one, two or more requests out at once. It goes through the app's own `createProvider`, `segmentBlocks` with `splitWithSentencex`, and `downloadSpeech`, so each request is exactly what a download sends. No simulator is involved. It reads the key from the settings export as `context-probe.ts` does (the two share `node-kit.ts`), and `OUT` must be outside the repository, because it receives the owner's book text.

```sh
OUT=/path/outside/the/repo; B=~/Works/epub_books
npx tsx test/manual-test/downloads/download-concurrency.ts "$OUT" "$B/My Vampire System/My Vampire System 1-250.epub" 1,4,2,8,5,6,10,3,1 40 20   # run.json, report.txt
npx tsx test/manual-test/downloads/download-concurrency.ts report "$OUT"   # the table again, from run.json
```

The arguments after the book are the levels in the order they run, the sentences per level, the first long section to take sentences from, and the provider (`fish` when left out). Running 1 first and last shows whether the service slowed down during the run. Every level sends different sentences. `fetch` is wrapped to record every exchange, a retried `429` included, with the `ratelimit-*` headers, and the clips are decoded with ffmpeg only after the timed part. Results of 2026-09-25 are in `notes/NOTES_2026-09-25.md`.

What it cannot show: the phone's own network, since it runs from the Mac through its proxy; the time the app spends saving each clip; how a provider other than Fish counts its limits, such as Azure's requests per minute (#40); whether Fish will enforce the limit it states.

### Timing a chapter download on the simulator

`download-chapter.cjs` prints `enqueued <ISO time>` as it hands the chapters to the runtime. Each saved clip is a file in `Documents/offline-narration-v2/<document>/<voice>/`, and the file's birth time is when the scheduler saved it, so the birth times time the download to the millisecond:

```sh
python3 -c 'import os,sys; d=sys.argv[1]; b=sorted(os.stat(os.path.join(d,f)).st_birthtime for f in os.listdir(d) if f.endswith((".audio",".m4a"))); print(len(b), b[0], b[-1])' VOICE_DIRECTORY
```

To compare with one request at a time: delete the chapters' audio through the runtime (`deleteDownloaded`, through `cdp.cjs`, then check that `occupied` reads 0), choose 1 in Settings › Providers › Fish Audio › Sentences at once (before beta26 this was `AT_ONCE` in `src/offline/scheduler.ts`), confirm that `settings.json` in the app container's `Documents` holds `"fish":1` under `sentencesAtOnce`, and download the same chapters again. Put it back to 5 afterwards. The number is read as each chapter starts, so change it only between downloads. Run the download with five at once first, so that anything the service remembers could only speed up the slower run. Configure Fish in the app first with `kit/run-probe.sh OfflineFixProbe … -only-testing:testConfigureFishProvider` (Pitfalls: before 2026-09-25 that method could pass with Fish still disabled).

### OpenAI Compatible's 422→MP3 fallback (#65) and Speechify's own queue, on the short fixture

`DownloadConcurrencyProbe.swift` also covers #65 (a PCM refusal falling back to
MP3) and confirms #64's Speechify `RequestQueue` change did not break plain
playback/download, both against the short two-chapter fixture rather than the
real book — a fresh voice directory each time, no pre-seeded state to manage:

```sh
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testConfigureCompatibleProviderRealTouches
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testChooseEmilyVoiceAndPlayShortFixture
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testCompatibleSentencesAtOnceFiveAndDownloadShortFixture
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testConfigureSpeechifyRealTouches
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testChooseSpeechifyVoiceRealTouches
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testSpeechifyDownloadAndPlayShortFixture
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testResetCompatibleSentencesAtOnceToDefault
```

Each method is its own invocation, run in the order above, the same discipline
as `AzureProviderProbe` and `OfflineFixProbe`: later methods depend on state
earlier ones leave (OpenAI Compatible configured and enabled, the short
fixture's voice chosen, Sentences at once at a particular value). The short
fixture needs adding first if it is not already in the Library (README, "Real
books"; the fixture is generated by `short-test-fixture.ts` and added through
the walkthrough harness's `add` command, which works for this one-shot use even
on a day the harness is otherwise unreliable for reading interactions).
OpenAI Compatible's Address/Model/Extra headers are read from
`/tmp/openreader-compat-{baseurl,model,headers}.txt` and Speechify's key from
`/tmp/openreader-speechify-key.txt`, the same host-only-file discipline as
`OfflineFixProbe.testConfigureFishProvider`. The last method resets OpenAI
Compatible's Sentences at once to its own default (1); Speechify's is never
changed from 1, and Fish's own default (5) is untouched by any of this.

What it cannot show: the app's MP3 decode path is only exercised end-to-end
through actual playback (item 2), not inspected directly; the OpenAI
Compatible connection check's own request shape is covered by this and by the
unit tests, not by inspecting wire bytes from the simulator.
