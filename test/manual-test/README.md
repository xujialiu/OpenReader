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
of it (same title and chapters, different manifest digest).

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

After muting the simulator and machine output, with the reading already paused:

```sh
bash test/manual-test/lock-screen.sh SIMULATOR_UDID /tmp/openreader-transport-01 top.xujialiu.openreader YES tap
```

This takes the paused screenshot, taps the system's Play button, waits up to
three seconds for its label to become Pause, then immediately taps Pause and
checks for Play again. Failure paths also attempt to pause in the app. It refuses
nonzero host output volume as an additional silence guard. Read the test log to
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
node test/manual-test/reading.cjs play-for 5
```

Open a Document first. `play-for` requires an explicitly chosen duration up to
10 seconds and zero machine output volume; mute the simulator too. Five seconds
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

After the fixture is downloaded, terminate and relaunch the app with `xcrun simctl` to empty the memory cache, mute host output, then run:

```sh
node test/manual-test/offline-playback.cjs
```

This reuses `cdp.cjs` to reject all fetches, temporarily disable the fixture's Fish provider, and route every newly created native audio source through a zero-gain node before Play. It checks actual saved-audio decoding, an active native playback queue and word-timing state, then immediately pauses. A five-second app watchdog and host cleanup also pause on failure. It prints the measured duration and network request count, restores settings/fetch, and keeps generated debugger expressions in a temporary directory. The zero-gain route is additional silence protection for the iOS 27 simulator, whose Control Centre had no volume slider and whose standalone volume APIs left outputVolume at 0.6. This is a handler probe, not a real Play touch, a physical connectivity test or a drift measurement. Restart the app afterwards to remove debugger instrumentation and verify it remains paused.

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

For deterministic transport/handover checks, first mute machine and simulator,
open the fixture Document, and open Voice once so its Fish list is loaded. Fish
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

With the same muted simulator, fixture Document and loaded Fish list as above:

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
bash test/manual-test/library-actions.sh SIMULATOR_UDID /tmp/openreader-library-actions-01
```

This uses real XCTest touches, entirely on the short English fixture. It long-
presses the Library row and taps its `...`, checking both raise the same drawer
(Appearance/Rename/Download/Delete) with no system alert on the `...` tap. It
taps Delete, checks the `Delete this book?` confirmation, and **cancels** —
this mode never removes the fixture. It renames the fixture to a long title to
photograph the `...` button centred against a two-line row, then renames it
back and confirms the restoration survives a relaunch. It then opens the reader
itself and checks the Appearance/Rename/Download menu (no Delete row there) and
that all three still open from that entry point, including the persisted
Download view. It never presses Play. It does **not** check the Contents note:
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
download for real (real Fish Audio spend: 17 utterances, then 1). **Both
failed once, in this order, with "Needs attention · The saved audio could not
be verified." on the very first write into a brand-new voice directory**, and
both succeeded immediately on `testRetryBlockedShortFixture` (taps
`Continue`) with no other change. `src/offline/storage.ts`'s `saveClip` calls
`temp.move(target, { overwrite: true })` without `await` and reads
`target.size` on the next line; `expo-file-system`'s `move` is `async` (a
separate `moveSync` exists for the synchronous case — confirmed against
`node_modules/expo-file-system`'s own mock, which implements `move` as `async
move() { this.moveSync(...) }`), so that read can race the native move and
observe a size of `null`, which is exactly the sidecar this reproduction
found on disk with no payload file next to it. This is pre-existing
(`storage.ts` is untouched by #13/#14) and one `Continue` tap always recovered
it in this run, but it means an ordinary fresh install has a real chance of
seeing a scary-looking error on its very first download. Worth its own issue.

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
