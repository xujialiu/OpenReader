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
scale=…` and `ZOOM doubletap scale=…`. It exits 0 when both are 1, 1 when
either gesture magnified the page, and 2 when a step failed. A final relaunch
clears the probe's answer from the player's note.

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
