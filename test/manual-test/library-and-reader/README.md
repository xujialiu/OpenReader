# The Library and the reader

## Cold Library opening

With the latest installed Debug app connected to Metro and the named Document
already in Library:

```sh
bash test/manual-test/kit/run-probe.sh LibraryOpenProbe SIMULATOR_UDID /tmp/openreader-library-open-01 --mode '仙逆'
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

## Library and reader actions drawer (long press, '...', Delete)

With the current Debug app connected to Metro and both `A Short Test of Reading
Aloud` and `仙逆` in the Library:

```sh
bash test/manual-test/kit/run-probe.sh LibraryActionsProbe SIMULATOR_UDID /tmp/openreader-library-actions-01 \
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
bash test/manual-test/kit/run-probe.sh LibraryActionsProbe SIMULATOR_UDID /tmp/openreader-library-actions-01 \
  -only-testing:testContentsExactPrecision
```

(Reuses the project the first command generated.) It opens 仙逆, opens Contents, and requires a row to be marked
current before asserting that neither of the two approximate-precision
sentences appears. **Opening Contents immediately after the reader's "Choose a
Voice" button appears is too early**: `status.rendered` (what marks the row
when nothing has been actively read) arrives asynchronously after the WebView's
first render message, separately from the player footer mounting, and the
first measured run landed at the top of the 2,076-row list with nothing marked.
The probe now waits, then retries once after closing and reopening Contents.
Neither mode touches downloads, rename, or deletion.

## Long-press lookup and translation (issue #73, `TranslationProbe.swift`)

With the current Debug app connected to Metro and `A Short Test of Reading Aloud` in the Library, build the disposable UI-test project and run `TranslationProbe.testSettingsDefaultsMenusAndPersistence` first, then `TranslationProbe.testLongPressDisabledThenEnabledDrawerAndCopy` and `TranslationProbe.testPronunciationButtonsTouchDictionaryAudio`:

```sh
bash test/manual-test/kit/run-probe.sh TranslationProbe SIMULATOR_UDID /tmp/openreader-translation-probe \
  -only-testing:testLongPressDisabledThenEnabledDrawerAndCopy
```

Change the final `-only-testing` method name for the other two methods. The pronunciation method uses `silence.sh`'s zero-volume simulator before the test, taps both dictionary audio buttons, and observes the app's pronunciation-active state; it does not press narration Play or prove narration pause/resume.

Method order matters for the drawer, not only for the selection state: every method whose precondition waits for the player footer (`testLongPressWhenEnabledAndReaderOpen` waits for `Choose a Voice`) fails while the lookup drawer from an earlier method is still open, because the drawer replaces the player footer in the accessibility tree. Run `testCloseCurrentLookupDrawer` — it ends with the drawer closed — or another drawer-closing method first (pitfalls/verification-runs.md, "Verifying #74"). To count long presses per run without a diagnostic build, read the simulator's own WebKit lines with `xcrun simctl spawn UDID log show --predicate 'process == "OpenReader" AND (eventMessage CONTAINS "Drag session requested" OR eventMessage CONTAINS "selectTextWithGranularity:atPoint")'`: one `Drag session requested` per long press, a `selectTextWithGranularity` line within tens of ms when the selection began. `longPressAnUnhighlightedLine` returns at the first line whose press opens the drawer, so consecutive successful presses usually land on the same first-line word; it does not vary words by itself.

The probe uses real settings taps, native selection long presses, drawer drags, copy, and service-menu touches. It proves Youdao dictionary content, UK/US pronunciation controls, a Google refusal with Retry, and an explicit Youdao switch. `testHandleDragOnPreparedReader` also proves that releasing a native handle changes the selected `The` word to Translation and displays Youdao's real `这个` response. Beta35 had a longer native selection that reached `This is a short test` with `Service, Youdao` but stayed on its spinner for more than 100 seconds; beta37's native wrapper release fix was retested with `testSelectionHandleExpansionTranslatesSentence` followed by `testPreparedHandleReleaseFinishesRequest`, and the root-owned green artifacts `/tmp/openreader-translation-fix-prepare2.xcresult` and `/tmp/openreader-translation-fix-release2.xcresult` show real selected sentence text with Youdao Chinese output (`只写第一句话`, then `第一个句子`).

## A long press that starts no selection, on the phone (#74, `long-press-watch.py`)

```sh
PMD3=/path/to/venv/bin/pymobiledevice3 python3 test/manual-test/library-and-reader/long-press-watch.py \
  live --udid IPHONE_UDID --out NEW_OUTPUT_DIR
python3 test/manual-test/library-and-reader/long-press-watch.py archive \
  --archive X.logarchive --start "YYYY-MM-DD HH:MM:SS" [--end "…"] --out NEW_OUTPUT_DIR
```

Prerequisites: a paired iPhone reachable by `devicectl`, pymobiledevice3 in a throwaway venv (pitfalls/physical-iphone.md), any build (Release included). For `archive`, a log collected with `pymobiledevice3 syslog collect OUT --udid IPHONE_UDID --start-time EPOCH` soon after the presses; WebKit's lines were gone from a day-old collection.

It classifies each long press on a page from WebKit's own lines: `Drag session requested` (about 0.65 s after touch-down) followed within 1.5 s by `Text interaction changing selection using '-[WKContentView(WKInteraction) selectTextWithGranularity…` is OK; no selection line is FAIL. `live` prints one line per press and, on FAIL, writes the preceding 90 s and the following 3 s of the app's non-network lines (WebKit, UIKit, `HX`, `[DEBUG-lp74]`) to `fail-YYYYMMDD-HHMMSS.log`, and echoes the last `HX` state line and any `[DEBUG-lp74] wk` decisions. It keeps the whole filtered stream in `raw-*.log`. Measured on 2026-09-29's archive (07:50–08:08): 8 FAIL then OK at 08:07:06.892, the same record as reading the lines by hand (engineering log, 2026-09-29 08:20).

The temporary `DEBUG-lp74` build of #74 (`modules/open-reader-debug-lp74`, removed after the fix; restore it with `git checkout 652f6a9 -- modules/open-reader-debug-lp74 src/app/walkthrough-harness.ts`, then `pod install` and a Release build) made the phone also persist, subsystem `top.xujialiu.openreader.lp74`: at touch-down (`down #N`) the first responder, every WKWebView with its content view's first-responder state, the touched WKContentView's interactions and recognizers, every recognizer in the window not in Possible, and the scroll views above the touch; while down, recognizer transitions (`gr #N`) and WKContentView's answers (`wk #N`: `gestureRecognizerShouldBegin:`, `hasSelectablePositionAtPoint:`, `textInteractionGesture:shouldBeginAtPoint:`, first-responder calls; which ones it could hook is logged once as `WKContentView hooks:`); `held #N` 1.2 s in and `lift #N` with the touch's recognizers and their states; and every `HX` line (`[DEBUG-lp74] js HX …`).

What it cannot prove: a press that WebKit never treats as a drag attempt (for example on a link or an image) is not counted at all; a press shorter than about 0.65 s is not a long press to WebKit and is not counted either. It says whether a selection started, not whether the lookup drawer then showed a result.

## Pinch and double tap on the reading page (#79, `zoom.sh`, `ZoomProbe.swift`)

```sh
bash test/manual-test/library-and-reader/zoom.sh SIMULATOR_UDID METRO_PORT METRO_LOG NEW_OUTPUT_DIR
bash test/manual-test/library-and-reader/zoom.sh SIMULATOR_UDID control NEW_OUTPUT_DIR
```

Prerequisites: `A Short Test of Reading Aloud` in the Library
(`short-test-fixture.ts`), a Debug app on that Metro, and `METRO_LOG` the file
that Metro's output goes to. Nothing is played.

For each gesture, the script relaunches the app with `-RCT_jsLocation`, opens
the fixture through the harness and waits for Metro to print `HX …
rendered=N`. `ZoomProbe` then pinches (`pinch(withScale: 3, velocity: 2)`
mid-screen) or double-taps a quarter of the way down, and photographs the page
before and after. The script asks the page for `visualViewport.scale`,
`innerWidth` and its viewport through `{"do":"js"}`, and prints `ZOOM pinch
scale=…` and `ZOOM doubletap scale=…`, read from Metro's `HX PROBE …` line
(#113). It exits 0 when both are 1, 1 when either gesture magnified the page,
and 2 when a step failed. It ends with a relaunch.

The probe also prints `ZOOM mark <gesture> before=X after=Y`, the player's
Following mark (A or M), read from the accessibility tree. The script exits 1
when a pinch turns A into M.

Expected since #79: both gestures read `scale=1 innerWidth=402` on an iPhone
17, and both marks read `before=A after=A`. The page's viewport reads
`width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`.
Before #79, a pinch read 2.60 and `innerWidth=155`, and it turned A into M
(engineering log, 2026-09-28).

`control` serves a page with the reader's old viewport on port 8111 and pinches
it in Safari. It must magnify (measured 1.00 → 2.39), or a reader that stays at
1 proves nothing about the reader.

What it cannot prove:

- A double tap never magnified the page, even before #79, so its `scale=1`
  guards only against a regression.
- Screenshots are the only evidence that a gesture landed on text: the page is
  not in the accessibility tree (pitfalls/screenshots.md).
- XCTest's pinch puts both fingers down together, in one section document.
  A real pinch whose second finger lands a moment later, or in another
  section document, is not measured. `highlighter.ts` counts moves before the
  second finger lands as a one-finger drag.

## The reader's title in the navigation bar (#85, `rename.sh`, `ReaderTitleProbe.swift`)

Set the display name with the app stopped and measure the bar from
full-res screenshots; the VoiceOver heading proof is the bundled AXe binary's
tree, since XCUITest cannot query headers:

```sh
bash test/manual-test/library-and-reader/rename.sh SIMULATOR_UDID "A long name…" PORT
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"open","id":"sha256:…"}'
python3 test/manual-test/kit/ink.py /tmp/title.png
TEST_RUNNER_OPENREADER_METRO_PORT=PORT bash test/manual-test/kit/run-probe.sh ReaderTitleProbe SIMULATOR_UDID NEW_OUTPUT_DIR
```

See [bar-title.md](bar-title.md) for the whole recipe: what to measure (two
centred lines inside the 54-pt bar, clear of both glasses, ellipsis past two
lines, short name equal to the native title by glyph-mask IoU), what each
check cannot prove, and the `-RCT_jsLocation` every probe launch needs.

## The share button in the actions drawer (#95, `ShareProbe.swift`)

With the current Debug app connected to Metro and a book whose title begins
`The First Legendary Beast Master` in the Library (a part of the owner's copy
in `~/Works/epub_books`, per **Real books**), run the methods one at a time,
in this order:

```sh
TEST_RUNNER_OPENREADER_METRO_PORT=PORT bash test/manual-test/kit/run-probe.sh ShareProbe SIMULATOR_UDID NEW_OUTPUT_DIR \
  -only-testing:LockScreenProbe/ShareProbe/testSheetClosesBackToOpenDrawer
```

1. `testSheetClosesBackToOpenDrawer`: Library `…` → Share → the system sheet
   over the drawer → its `Copy` cell closes it → the drawer is still open with
   Share back.
2. `testReaderDrawerShareOnlyOnMenu`: the reader's More actions shows Share at
   the same frame, and Appearance, Fonts (the `Font, <chosen>` row), Rename and
   Download do not.
3. `testLongTitleWrapsBeforeButtonAndShareName`: renames through the Rename
   page to the long name and checks that the title wraps before the button.
   Then `ls` the data container's `Library/Caches/share/` for
   `The First Legendary Beast Master, Volume Three - The Long Road Through the Northern Mountains and Beyond.epub`
   and `cmp` it against `Documents/library/sha256-*.epub`.
4. `testMissingFileShowsAttentionNote`: first overwrite `Documents/harness.json`
   (`printf '{"seq":9999,"do":"shelf"}'`, pitfalls/verification-runs.md) and
   move the kept `Documents/library/sha256-*.epub` out of the container, or
   the launch re-adds it. Then `testShareAgainAfterFileRestored`, with the file
   put back.

The sheet's own actions (Save to Files, AirDrop) cannot be driven from here
(pitfalls/mcp.md, "The share sheet's actions"). The bytes are proved by `cmp`
on the `Caches/share/` copy instead. On 2026-09-30 (iPhone 17, iOS 27.0) all
five methods passed. The Debug Log showed `copied in 4–13 ms` for a 1 MB book
and `sheet closed after 2589–3250 ms`.

## The reader's web content process ended (#120, `webcontent-killed.sh`)

With a Debug Mode app and a Document open in the Reader with its text on the
page:

```sh
bash test/manual-test/library-and-reader/webcontent-killed.sh SIMULATOR_UDID          # kill with the app in front
bash test/manual-test/library-and-reader/webcontent-killed.sh SIMULATOR_UDID --away   # in Settings during the kill, as on the phone
```

It reads the probe's answers from the app's own Debug Log (`[probe]` lines),
not Metro's log: on 2026-10-01 Metro 8160's log stopped at 23:03:52 while the
app stayed connected, and the first version, which read Metro's log, answered
`before: (no answer in 10 s)` three times (pitfalls/metro.md).

It asks the page with `kit/probes/page-alive.js`, `kill -9`s the device's one
WebContent process (the `WebContentExtension` child of its `launchd_sim`), waits
5 s (`--wait`), and asks again. PASS: epub.js is on the page with a displayed
view taller than zero and, when a sentence was highlighted before the kill (a
harness `{"do":"seek","utterance":N}` paints one while paused), the same
sentence highlighted after it; FAIL: anything else, a missing answer included.
Exit 0 / 1, 2 when the page has no text before the kill or there is not exactly
one WebContent process. It plays nothing and saves a screenshot to
`/tmp/openreader-webcontent-killed.png`.

On the phone (2026-10-01) iOS ended the process itself, with the app suspended
(`JETSAM_REASON_MEMORY_LONGIDLE_EXIT`), and WebKit reported it on the next
resume as `WebPageProxy::processDidTerminate … reason=Crash`; a `kill -9` is
the same report. Measured 2026-10-01 22:03 on iPhone 17 (iOS 27.0), "My Vampire
System 251-500": FAIL in 3 runs of 3 (twice in front, once `--away`), about 20 s
each, the screenshot blank under the navigation bar and the player, Metro
logging `WARN Webview Process Terminated`. Closing the Reader and opening the
book again, with nothing playing, brought the text back.

After the fix (ADR 0067, `1.0.0-beta10`), 6 of 6 PASS at 22:44–23:02: four in
front, two `--away`, one with nothing cued (the new page opened where the old
one was), the others with the sought sentence highlighted again.

A Reading playing through the kill is not in the script, because its sentence
moves on. By hand, with `player-and-reading-held/fake-kokoro.cjs` as the
Provider (setup in `place-and-following/background-crossing.md`), `silence.sh
check && hx.cjs … '{"do":"play"}'`, then the same `kill -9`, `page-alive.js`
8 s later, and a pause: on 2026-10-01 at 23:00:48 the Reading went on from
Utterance 302 to 306 with no note, and the new page showed the sentence being
spoken with its word highlighted. Four kills within a minute leave the page
blank on purpose (ADR 0067, decision 6): reopen the book before the next run.

What it cannot prove: what an idle-exit while suspended does beyond the kill
(the phone's wait was 85 minutes).
