# Screenshots

## Screenshots of a sheet

- **A sheet photographed as it opens can be 1 pt short of where it rests, and
  that reads as a layout change.**
  - Symptom: two screenshots of the same sheet differ by one vertical offset of
    everything in it. On 2026-09-22 the #28 before-shot of the loading voice
    sheet sat 3 px lower than the fixed build's, title, chip and note alike,
    and the grip's last pixel row was only partly covered.
  - Cause: the modal's slide-in eases out and pauses one point short. Recorded
    with `simctl io recordVideo`, the sheet's top edge went 1318, 1316, 1315,
    **1314** px, stayed at 1314 for 30–70 ms, then jumped to 1311 and rested
    there. That pause is the frame a `simctl io screenshot` most easily lands
    on. The old build's before-shot and a new-build frame at 1314 were
    pixel-identical over the whole sheet except the note #28 moved.
  - Fix: before comparing positions across screenshots, check that the sheet's
    top edge is at rest: two consecutive frames that agree, or the frames of a
    recording (`voice-sheet-loading.cjs` with `VIDEO=1`, below). Compare
    resting frames with resting frames, or 1314 with 1314.
- **The voice sheet's loading state after a cold start can be shorter than one
  screenshot.** Measured 2026-09-22 in three cold starts: in the two that were
  recorded, the Voices arrived 0.5 s and 1.0 s after the sheet came to rest
  (the #24 run saw about 5 s), and each `simctl io screenshot` took 0.4–0.6 s,
  once 1.1 s. A burst caught the loading state at rest in one frame, one, and
  two. Record the screen instead (`VIDEO=1`): `ffmpeg` or `cv2.VideoCapture`
  reads every frame, and the recording keeps the device's 1206×2622 pixels.

## Screenshots of the reading page

- **The book's text is not in the accessibility tree.** Measured 2026-09-25
  (#67): `app.debugDescription` of the open reader lists the navigation bar and
  the player's buttons, and the WebView as one `Other` labelled `Vertical scroll
  bar, 2 pages, …`, with no `StaticText` from the book. Its sections are
  iframes. A first version of `ReadingButtonProbe` looked for
  `app.webViews.staticTexts` and found none, so it reported "no line of text"
  for a full page. Read the text's position off a screenshot (`inkRows` there),
  and tap a sentence by where it is drawn.
- **A reader just opened is still laying out, and its waiting line is ink.**
  The same probe's first reading, taken a second after the reader appeared,
  found the first text at 463 points, where "Laying the document out…" sits,
  and the next one found the book's heading at 146. It reported a 317-point
  move for no move at all. Two readings that agree are not enough: the waiting
  line stays put for seconds. Wait until the waiting line has gone, then for
  three readings half a second apart that agree (`settledInk`).
- **The waiting line is not in the accessibility tree either, so an XCTest
  wait for it to go passes at once.** Measured 2026-09-28 (#79): `ZoomProbe`
  waited for `app.staticTexts` matching `label BEGINSWITH 'Laying the document
  out'` to stop existing, the wait passed on its first check, and the pinch
  after it landed on that line, which its screenshot showed at 12 s after the
  tap and at 29 s in a slower run. The pinch magnified nothing, and three runs
  read that as the page refusing to zoom. Fix: open the Document through the
  harness (`{"do":"open","id":…}`) and wait for Metro's log to print an
  `HX … rendered=N` line after it, as `zoom.sh` does; or wait on ink, as above.
- **`xcresulttool export attachments` once never returned.** The first
  `zoom.sh`, 2026-09-28: the second XCTest ended at 09:06:18, the export after
  it was still running when the 600 s command limit killed the script, and no
  `attachments` directory had been written. The first run's export had taken
  a second. Cause not isolated. `zoom.sh` now runs it under `perl -e 'alarm 60;
  exec @ARGV'`, since this Mac has no `timeout` (pitfalls/shell.md).
- **A Reading Button waiting for audio reads `busy, Playing`, not `Playing`.**
  `accessibilityValue` and `accessibilityState.busy` arrive in XCTest as one
  `value`. Match the end of it.
- **Paint an earlier run left on the screen is still there when the next run
  starts, in the same place.** Stale paint stays until something repaints its
  area, so a probe that ran the same sequence again saw its predecessor's strip
  and counted it as its own: a run with the trigger removed still read RED
  (2026-09-22, #35). Fix: begin every run with a fresh render,
  `rendition.display(0)` in the reader or a reload in Safari, and photograph that
  baseline once to see it clean.
- **A thin region of highlight colour is not always a strip.** Inside a
  highlighted word, the counter of an `e` or a `q` is amber cut off from the
  rest of the word by the glyph's strokes, 9 to 31 px tall at Font Size 28, and
  a detector that sorts regions by height reports it as stale. Ignore a region
  that lies inside a word's box, as `leading-strip.py` does.
- **A strip on the same line as the held word merges into it if the detector
  groups pixel rows.** Grouped by rows, the 6 px strip above "He" and
  "completed" beside it made one 102 px band that read as the held word, and the
  run as GREEN. Group connected regions instead, and hold on a word on another
  line.
- **A RED from `leading-strip.py` can be React Native's own LogBox, not a
  strip.** Symptom (2026-09-22, #35, iPhone 16 simulator): a STALE region at the
  same y 2342..2395, x 72..125 on every affected run, colour ~(250,186,48),
  whatever sentence or line height was under test. Cause: any `console.warn` or
  `console.error` from the app's own JS (not the reader's WebView) opens the
  "Open debugger to view warnings." banner, whose amber "!" icon falls inside
  the detector's colour threshold; the banner is global app state, so it
  outlives a `shut`/`open` reader cycle and every later screenshot reads it as a
  stale strip until something clears it. Met from two unrelated triggers here: the
  `injectedJavaScript` race below, and React Native's own `Sending
  onAnimatedValueUpdate with no listeners registered` during rapid automated
  `shut`/`open` cycling — neither related to the highlighter. Fix: `xcrun simctl
  terminate` then `launch` the app to clear LogBox; the same probe read GREEN
  immediately after that restart, no code change. `leading-strip.py` now tells
  the icon apart by its blue, 48 all over the icon against 2 to 5 in the word
  colour, and reads that same screenshot as GREEN; restart anyway, since the
  banner covers whatever is under it. A screenshot showing the actual reading
  text is still worth reading by eye — the true strip and this false one look
  nothing alike once you see them.
- **`do:"js"` sent right after `do:"open"` can race the WebView's own bridge.**
  Symptom (2026-09-22): Metro logged `WARN Error evaluating injectedJavaScript:
  ... TypeError: undefined is not an object (evaluating
  'window.ReactNativeWebView.postMessage')` and the harness's answer was "no
  answer from the reader" (INVALID), although the Document had visibly finished
  opening. Not reproduced on an immediate retry with the same 8 s gap between
  `open` and `js`. Treat one INVALID right after an `open` as worth a retry
  before treating it as a real failure, and check Metro's log for this WARN when
  it happens — it is also what leaves the LogBox banner above.
- **A LogBox banner can appear with no `WARN`/`ERROR` line in Metro's log to
  explain it.** Measured 2026-09-25 verifying #66: in
  `PauseSuspendProbe.testQuickToggleTight` on a freshly relaunched app, the
  banner `!, Open debugger to view warnings.` was absent at the capture before
  a 0.82 s Pause→Play and present at the one 5 s after it, while the reading
  ran on to the fixture's last sentence. Metro's log carried no warning in that
  window (its `HX` lines went on), CDP closed with 1006 before it could read the
  buffer, and the simulator's unified log held no React line. The next tap aimed
  at Pause landed on the banner (hit point `{-1, -1}`), so the method failed.
  Cause not found. It did **not** recur: two more runs of the same method, each
  on a fresh launch seeked back to the first sentence, passed with 0.69 s
  gaps, and a play from sentence 15 to the end of the book ended on the
  ordinary end-of-book note with no banner. Before blaming the change under
  test, relaunch (`xcrun simctl terminate` then `launch`), seek back to the
  start of the fixture and run the method again; a probe that has run the
  short fixture past its end is measuring the end of the book as well.
- **On iOS 27 the LogBox close glyph has no stable accessibility label.**
  Measured 2026-09-26 in the Fish narration probe: its gray circle is at
  normalized `(0.918, 0.933)` on the iPhone 17, about `{{360, 802}, {20, 20}}`
  points. Tap that real coordinate up to five times while the banner remains
  present before touching the floating player; one tap can be consumed while
  the warning is being redrawn.
- **`waitForExistence(timeout:)` can consume nearly its whole budget before its
  first check, inflating a measured gap between two taps.** Measured
  2026-09-25 verifying #66 (`PauseSuspendProbe.swift`): `app.buttons["Pause"].tap()`
  then `app.buttons["Play"].waitForExistence(timeout: 1)` then `.tap()` printed
  a gap of 1.74 s between the two taps, with the verbose log showing
  `Waiting 1.0s for "Play" Button to exist` immediately followed, a full 1.00 s
  later, by the first `Checking existsNoRetry == 1` — the button had almost
  certainly already existed long before that first check ran. Removing the
  `waitForExistence` call and tapping the second button directly (the query
  re-resolves at tap time) measured 0.82 s for the same two taps on the same
  device. Prefer two direct `.tap()` calls with no intervening
  `waitForExistence` when the measurement itself is the point; keep
  `waitForExistence` for ordinary existence gating, where the extra latency
  does not matter.
- **A failed UI test can leave `xcodebuild` waiting in diagnostic collection for ten minutes.** On 2026-09-25, a follow-up test failed its starting-screen precondition in 52 seconds, then `IDETestOperationsObserverDebug` waited 600 seconds for simulator diagnostics before exiting. Kill that exact `xcodebuild` PID after recording the failure, fix the starting-state guard, and rerun with a fresh result bundle.
- **XCTest has no public way to move two fingers together.** `XCUICoordinate`
  drags one finger; `pinch` and `rotate` move two apart or around each other.
  `TwoFingerProbe.swift`'s `Fingers` plays one path per finger through
  XCUIAutomation's private `XCPointerEventPath`, `XCSynthesizedEventRecord` and
  `eventSynthesizer` (selectors read out of Xcode 27.0's binary; notes
  2026-09-24, 02:15). Reuse it rather than reaching for Computer Use.
- **A private-API completion block declared without `@escaping` traps, and
  then xcodebuild sits.** Symptom (2026-09-24): the two-finger drag reached the
  app, the runner died at once with "closure argument passed as @noescape to
  Objective-C has escaped", xcodebuild printed "Restarting after unexpected
  exit, crash, or test timeout", ran 0 tests and did nothing more for seven
  minutes. Cause: the event synthesizer keeps the block it is given. Fix: type
  the block `@escaping @convention(block)`, and kill a stuck xcodebuild by its
  PID (`pgrep -f "xcodebuild -project OUTPUT"`).
- **`swipeUp()` and `swipeDown()` on the download drawer's list chose the row
  they began on.** Measured 2026-09-24 on the tree before #57: the
  `Download selected (N)` count changed on 5 of 6 alternating swipes, as well as
  the list scrolling; a synthesized one-finger drag of 160 pt over 0.5 s changed
  it on 0 of 6 (`TwoFingerProbe.testDrawerOneFingerNeverChooses`). A probe that
  scrolls a list of checkboxes and then counts what is chosen scrolls with a
  synthesized drag, never with `swipeUp()`.
- **`More actions` tapped straight after `Close Download` opens nothing.** The
  drawer is still sliding out, and the next line fails with "No matches found
  for … 'Download'" (2026-09-24). Wait for `Close Download` to be gone first, as
  `TwoFingerProbe.openDrawer()` does.
- **A SwiftUI menu row is an `Other` until it has the button trait.** A row
  built on `ChoiceMenu` (ADR 0035) is one accessibility element made with
  `accessibilityElement('ignore')`, which starts with no traits, so on
  2026-09-22 `app.buttons` could not find `Alignment, Justify` and XCTest
  listed it as `Other`. `ChoiceMenu` adds `isButton`; if a row built some other
  way is missing from `app.buttons`, look for it with
  `descendants(matching: .any)`. The open menu's items are `Button`s whose
  `identifier` is the SF Symbol (`text.alignleft`, `sun.max`) and whose label is
  the title, and the checked one `isSelected`.
- **A relaunch lands in the last reader instead of the Library.** That is state restoration. Tap `Back`, if it exists, before looking for Library rows.
- **Back-to-back `-only-testing` runs against the same live app inherit
  whatever screen or sheet the previous run left**, since a new `xcodebuild
  test` invocation's `app.activate()` foregrounds the process as-is rather
  than relaunching it. Measured 2026-09-22: a method written to start from
  Library (open the book, `More actions` → `Download`) was run right after an
  earlier method that had deliberately left the Download sheet open over the
  reader; `More actions` was never found (it is behind the open sheet), and
  the next line failed with "No matches found for … 'Download'". `xcrun simctl
  terminate` + `launch` between runs (not just `app.activate()` inside the
  test) restores the known starting screen; a method that must tolerate
  either starting point should check for a sheet-specific element first.
- **XCTest runs methods in the class's discovered order, not the order of
  repeated `-only-testing` arguments.** On 2026-09-24, one BrowseTouchProbe
  invocation listed its stateful methods in the documented order, but XCTest
  ran `testDragAway…`, `testDragBack…`, and `testFontSize…` before
  `testOpenBook…`; the font-size method then could not open the drawer and the
  later methods inherited the wrong page. Run each stateful method separately
  in the README's order, or use a test class whose discovery order is known.
- **The same inheritance can make a blind tap on a screen-position button hit a
  stray row of a sheet the previous run left open**, rather than simply miss.
  Measured 2026-09-24 verifying #52 (`BrowseTouchProbe`): a method failed
  cleanly and left Contents open over the reader; the next `-only-testing`
  invocation's `app.buttons["Contents"].tap()` — the *player's* Contents
  button, not the sheet — landed on whatever Contents row now sat at that
  screen point instead, silently choosing a chapter in the book meant to stay
  unread for a later method (harmless here since the choice is not written
  while the book is unread, but it would not have been in general). Guard the
  open with `if !app.staticTexts["Contents"].firstMatch.exists { app.buttons["Contents"].tap() }`
  — the sheet's title is a `staticTexts` element and the player's button a
  same-labelled `buttons` element, so the two do not collide — rather than
  tapping unconditionally.
- **A tap right after the reader opens hits a blank page.** The header and "More actions" exist before the Document is laid out. Wait for `Play` or `Choose a Voice`, then for "Laying the document out…" to go.
- **Waiting for "Laying the document out…" never waits.** It is the label of the WebView's scroll view, an `Other`, not a static text. Query `app.descendants(matching: .any)`.
- **A cold launch straight into 仙逆 takes over 40 seconds to lay out.** A warm open takes 3–6 seconds. Time tests from a warm open.
- **A coordinate tap on text does nothing.** It landed between two lines, which the reader treats as blank space by design. Take the point from a screenshot of the middle of the line.
- **The lookup drawer's adjustable header frame stays 24 points tall while the drawer expands.** Measured 2026-09-26 in `TranslationProbe`: its `minY` moved from `525.7` to `207.3` after a real upward drag, while `frame.height` stayed `24.0`. Compare the header's `minY` when proving the drawer height, not its handle height.
- **A copied lookup result keeps the accessibility label `Copy result` after the visible child changes to `Copied`.** Measured 2026-09-26 in `TranslationProbe`: the real tap changed the device pasteboard (`xcrun simctl pbpaste` returned the dictionary text), but `app.staticTexts["Copied"]` never appeared because the parent button's stable label hides that child. Verify the pasteboard or keep the button tap as the touch evidence.
- **The lookup handle-release probe's old coordinates miss the handles after the reading navigation bar is moved above the reader.** Measured 2026-09-26 on beta38: the old `(0.47, 0.29)` drag left the selected `This` word and the drawer in Dictionary mode; after seeding the fixture at its first sentence, the screenshot showed the right handle near `(0.125, 0.205)`. Drag from `(0.125, 0.205)` to `(0.36, 0.23)`; the selected result changed from `is a` to `is a shor`, and Youdao returned `是短线`. WebView text is not reliably in the accessibility tree, so use the native result title and kept screenshot to prove the selection changed.
- **One tap on `Pause` is not always a pause.** Measured 2026-09-21: a tap three
  seconds after Play left the reading running — no pause handler, no `pause`
  sync run, and the reading went on to the end of the book while the probe sat
  in its fifteen-second wait for `Play` to come back. The same one-tap pause had
  worked in the two runs before it. Tap, wait for `Play` to exist, and tap again
  (`SyncProbe.testSeekAwayAndBack` does it four times at most), and treat a run
  whose transport still says `Pause` as a failed measurement, not a slow one.
- **A timed tap cannot be aimed at a window a few hundred milliseconds wide.**
  Issue #20's claim rule needs a real tap between "an adopted place is pending"
  and "the section it names has rendered". Against the owner's own folder that
  window is inside the 1.40 s measured from `app.activate()` to the highlight
  landing (2026-09-21), network round trip included, and one `.tap()` on a
  coordinate took **1.60 s** to dispatch — wider than the window it was aiming
  at. Point `sync.url` at the stalling stub (`slow-webdav.py`, **Against the
  owner's real folder** in [../sync/README.md](../sync/README.md)) instead: the stub decides when the place
  arrives, so the tap can be scheduled against its delay.
- **`press(.home)` pokes a sync of its own, so a timed tap's clock starts
  there.** `shell.tsx` pokes on `background` as well as on `active`, and
  single-flight coalesces the activation's poke into the run the Home press
  already started. With a 6 s stall the place therefore arrived ~6.1 s after
  **Home**, not after `activate()` three seconds later; a delay measured from
  the activation missed by the whole three seconds.
- **A tap that lands too early looks exactly like the claim rule failing**, so
  say which one happened. The tell is `status.resume`: `abandonResume` shows the
  sentence a *failed* resume left behind ("The sentence this book was left on is
  not in the text that has rendered…"), which only exists once the place has
  arrived and missed. A tap before the place arrives clears nothing, leaves
  `resume` null, and the place then wins — the same screen as a broken claim
  rule, from the opposite cause.
- **A chip is not a `.radioButton`.** The voice sheet's provider and locale
  chips have `accessibilityRole="radio"`, and
  `app.descendants(matching: .radioButton)` found none of them on iOS 27.0.
  Find a chip by its label (`label == 'en-US'`), as `ReaderProbe` does.
- **A download-list row's own `accessibilityRole="checkbox"` is not a
  `.button` either, the same story one bullet up.**
  `app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'The First
  Chapter'"))` found nothing on a row plainly on screen (2026-09-24,
  `LineColourProbe`, verifying #29): the screenshot taken moments earlier
  showed the row, but the element search timed out and the probe silently
  skipped the tap it gated on it. `PauseOrderProbe.checkbox` and
  `DownloadRingProbe.ring`/`firstRow` already work around this with
  `app.descendants(matching: .any).matching(NSPredicate(format: "label ==
  %@", title))` — an exact label match over every descendant, not a
  `.buttons` query. Reuse that pattern for any new download-row lookup
  instead of rediscovering it; a silent `waitForExistence(timeout:)` guard
  around an optional tap can hide exactly this mistake, so check the
  screenshot it was meant to gate before trusting a GREEN run that has one.
- **`Back` is not what the back button is called.** It is named after the screen
  behind it: the Sync screen's is `Settings`, the Settings screen's is `Library`.
  Only the reader's is `Back`. A book handed over with `simctl openurl` is pushed
  onto whatever stack is on screen, so a reader opened over Settings goes back to
  *Settings*, and `app.buttons["Back"]` then finds nothing — the run reports
  "… is not on the shelf" for a book that is on the shelf. Walk towards the
  Library by something the Library has (`label BEGINSWITH 'Actions for '`), tap
  `app.navigationBars.buttons.element(boundBy: 0)` rather than a label, and
  relaunch the app when there is no back button left (`SyncProbe.openBook`).
- **iOS's own "Save Password?" AutoFill prompt is not in the app's
  `XCUIApplication` tree at all**, and it blocks whatever a query against that
  tree tries next. Raised once after `clearAndType` submits a *new* secure
  field (`testEnterFolderAndSwitchOn`'s Password), it sits over the Library
  the next time the app is queried and made one run's `statusLines` (`app.
  staticTexts.allElementsBoundByIndex`) fail with `Failed to get matching
  snapshot: No matches found for Element at index 2 …` — an accessibility
  snapshot mismatch, not a missing element, because the system sheet was
  mutating the tree out from under the query. It belongs to a system process,
  reached the same way `UIA.MediaControls.NowPlaying.CenterButton` is: a
  second `XCUIApplication(bundleIdentifier:)` for whichever process owns it —
  `com.apple.springboard` answered `Not Now` reliably here; try
  `com.apple.PasswordBreachSheet` and
  `com.apple.AuthenticationServicesUI.AutoFillPromptUI` too, since which
  process actually owns the sheet was not pinned down further. Call before any
  whole-tree query after a first-time password submission; harmless the rest
  of the time, since it waits at most a couple of seconds per candidate and
  moves on when none exists.
- **A probe's expected list can go stale when the app's own list changes.**
  `GeneralFontsProbe.testFontsPageListAndBackButton` still asserted all eleven
  Fonts-page names, four of them CJK (`苹方`, `宋体`, `楷体`, `圆体`), and failed
  with six `XCTAssertTrue` failures (2026-09-22, independent #32/#33
  verification) naming exactly those four as missing. The app is not wrong:
  `READING_FONTS` in `highlighter.ts` dropped those four in `01ab1c2` (#12,
  2026-09-21), predating this probe failure and untouched by #32/#33's diff —
  three of the four do not resolve as distinct faces on this runtime
  (`UIFont.familyNames` has only PingFang of the four), so the rows were
  removed rather than left doing nothing (see the comment above
  `READING_FONTS`, and ADR 0029). The element tree confirms it: the Fonts
  `ScrollView`'s own accessibility label reads "Vertical scroll bar, **1
  page**" with exactly the current seven `Button`s inside it (`Original Book
  Font`, `System`, `Georgia`, `Times New Roman`, `Palatino`, `Avenir Next`,
  `Helvetica`) — there is nothing further to scroll to, so the `swipeUp()`
  that follows the missing-row assertions produces a byte-identical
  accessibility tree, which reads exactly like a broken gesture and is not
  one. `test/manual-test/README.md`'s own **Font Size against Documents…**
  section still says "nine named `preview` faces" for the same reason: prose
  the code has moved past. Treat a Fonts-page name mismatch as a probe/doc
  staleness question first — diff the failing names against `READING_FONTS`
  — before suspecting the row under test; fixing the probe's expected list
  (or the stale README prose) is a separate, already-scoped change, not
  something to fold into an unrelated feature's verification.
- **A real, accessibility-matched tap can land on a debug overlay instead of
  the button underneath.** Measured 2026-09-22 verifying #34: `app.buttons["Play"].tap()`
  resolved and reported success (the test passed), but nothing played — no
  `playing=true` HX line anywhere in Metro's log, no Fish request attempted —
  because React Native's own "Open debugger to view warnings." banner (raised
  earlier by the stale-harness JavaScript exception two bullets below) sits
  over the floating player, and its rectangle (`{{10.0, 786.7}, {382.0, 67.3}}`
  in points) overlaps the Play button's (`{{166.0, 793.7}, {56.0, 52.0}}`).
  XCUITest's `.tap()` dispatches a physical touch at the resolved element's
  screen point; whatever the OS hit-tests there receives it, accessibility
  match notwithstanding. Do not assert only that `Play` reappears afterwards
  — that also holds if Play never started. Assert the transition to `Pause`
  (`app.buttons["Pause"].waitForExistence(...)`) as the proof playback began,
  and dismiss or clear the warning banner (a clean relaunch is the reliable
  way) before trusting a Play tap near it. The same banner swallowed a tap on
  the playback speed (the number at the right end of the player row) on
  2026-09-23, after a fixture reader was opened; the relaunch cleared it, and
  state restoration reopened the same reader. Measured again 2026-09-24
  verifying #52: `Contents`, `Play` and `Playback speed` all sat under the
  banner's `{10, 787.7, 382, 48}` at once (`Contents` at `{12.3, 797.7, 44,
  44}` almost entirely inside it), and a tap on `Contents` opened nothing.
  Starting a real-touch sequence's first method with `app.terminate();
  app.launch()` rather than `app.activate()` avoids it pre-emptively — a
  fresh launch has logged no warning yet — which is cheaper than detecting
  and dismissing the banner on every later method.
- **A doubled or missing class in `-only-testing` runs nothing, and exits 0.**
  `kit/run-probe.sh` now takes a method, `Class/method` or the full
  `LockScreenProbe/Class/method` and builds the one path Xcode matches; what
  follows was measured with the per-probe wrappers it replaced. Whichever
  script runs it, confirm a real duration and `Executed N tests` in the log.
  `offline-fix.sh` took the bare method name and prepended the class itself.
  Passing
  `-only-testing:OfflineFixProbe/testConfigureFishProvider` (reasonable by
  analogy with the old `reader.sh`'s own `-only-testing:LockScreenProbe/…/testX`
  examples elsewhere in this file) doubles the class —
  `LockScreenProbe/OfflineFixProbe/OfflineFixProbe/testConfigureFishProvider`
  — which matches no test. Measured 2026-09-22: `xcodebuild` still exited 0,
  in under a tenth of a second, having run nothing. Exit 0 is not evidence of
  a pass here; confirm a real duration (seconds, not milliseconds) and an
  assertion count in `test.log`.

- **`download-ring.sh`, the wrapper `DownloadRingProbe` had, took the same
  bare method name.** Passing `-only-testing:DownloadRingProbe/testReopenDownloadDrawer` makes the
  runner prepend the class a second time, yielding
  `LockScreenProbe/DownloadRingProbe/DownloadRingProbe/testReopenDownloadDrawer`;
  Xcode exits 0 after reporting zero executed tests. Measured 2026-09-22 while
  restoring the final simulator screen. Confirm the test log shows the
  method running and not only `Executed 0 tests`.

- **`two-finger.sh` and `pause-order.sh` required the class-qualified
  selector.** Passing the bare `-only-testing:testDrawerManageSweepSelectsForDelete` form
  left the wrapper's own `-only-testing:` prefix in the generated path, so
  Xcode exited 0 after reporting zero executed tests. Both now go through
  `kit/run-probe.sh`, which takes either form.

- **A preserved simulator can violate a probe's documented fresh-fixture state.**
  `DownloadRingProbe` expects zero saved chapters and `PauseOrderProbe` expects
  every chapter to be unsaved; on 2026-09-24 both fixtures already held saved
  audio from an earlier run. The probes then failed their preconditions and
  later assertions were not evidence of the interaction. Open Manage downloads
  and delete the fixture audio, then relaunch the app and confirm the zero
  chapter count before rerunning either probe.

- **`PauseOrderProbe`'s Manage-ring partial branch can misread a paused task as completion.**
  When the probe taps the only chapter still being written in Manage downloads,
  that tap can pause the whole task; Manage then removes the ring because no
  chapter is in the writing state. On 2026-09-24 the log printed
  `MANAGE RING CHECK PARTIAL`, while the saved task still held chapters three
  and four in `paused` and the later 30-second chapter-four assertion failed.
  Treat that branch as inconclusive and inspect the task state before calling it
  a scheduler failure.

- **Calling `xcodebuild` directly, not through one of the wrapper scripts,
  needs the full `TARGET/CLASS/METHOD` path.** The wrapper scripts' own bare
  method name (above) works only because each one prepends `LockScreenProbe/`
  itself — `project.rb` always names the generated target `LockScreenProbe`,
  whatever probe source file is added to it. Passing
  `-only-testing:PausedTransportProbe/testPlayAfterIdlePause` straight to
  `xcodebuild` (no wrapper script) failed at once (exit 70): `Tests in the
  target "PausedTransportProbe" can't be run because "PausedTransportProbe"
  isn't a member of the specified test plan or scheme.` Measured 2026-09-23.
  Fix: `-only-testing:LockScreenProbe/PausedTransportProbe/testPlayAfterIdlePause`.
- **`-resultBundlePath` refuses a path a previous attempt already created,**
  including a failed one — exit 64, `Existing file at -resultBundlePath …` —
  the same "use a new artifact directory" rule the wrapper scripts enforce for
  their own output directories, but it applies to a bare `xcodebuild` call
  reusing one fixed path across retries too. `rm -rf` the stale
  `.xcresult` (or pick a new path) before retrying.

- **A Contents row's chapter number is not always followed by a colon.**
  Verifying #52 (`BrowseTouchProbe`), `label BEGINSWITH 'Chapter '` then
  taking digits up to `:` parsed `Cultivation Online`'s rows fine (`"Chapter
  2018: Entering the Starry Sky"` → `2018`) but found zero matches in
  `Cultivation Online — Chapters 1751–2000`, whose own EPUB source omits the
  colon (`"Chapter 1751 Embroidery"`), and read back as "Fewer than 3 chapter
  rows on screen" although the rows were plainly there. Two different
  fan-translation sources, two different headings; take the digits
  themselves (`rest.prefix { $0.isNumber }`) rather than assuming a
  separator.

- **`app.swipeUp(velocity: .fast)`/`swipeDown` move a wildly uneven number of
  spine sections per call, so "N swipes" is not "N screens" and not even
  consistent with itself.** Verifying #52's drag-back case on `Cultivation
  Online`, four swipes moved the page 22→26, then a later four moved 26→25,
  then 25→24, then 24→23, then 23→6 (a single call), then a forward four only
  6→7 and another only 7→8 — the same gesture, the same book, an order of
  magnitude apart. It was put down here to the sections' uneven lengths. **It
  was #58**: a fling that crossed the end of the laid-out text lost epub.js's
  scroll adjustment for the sections it prepended, and the page landed whole
  sections back (ADR 0045); 23→6 in one call is that. Do not compute a target
  section from a swipe count anyway; re-read the page's own top section after
  each batch (`browse-touch-state.cjs`, or an in-app read) and stop once it has
  crossed the section wanted.
- **`app.swipeUp(velocity: .fast)` never carried the page past the laid-out
  text on the owner's book**, so it could not show #58. Measured 2026-09-24
  02:18: five swipes each way from the first section moved `scrollTop` 600 to
  700 px a swipe and at most to 3,813 of the 5,209 that sections 0 and 1
  allowed; nothing was appended or trimmed, and every frame was covered. The
  owner pointed out that the defect needs a scroll past the end of the scroll
  bar. `FlingProbe.testFlicks` (`fling-jump.sh`) drags at a chosen velocity
  instead, 4,000 pt/s by default.
- **XCTest waits for the app to go idle before and after every synthesized
  event, so repeated flicks never add up.** Each `swipeUp` took about 2.5 s,
  and each flick's momentum had died before the next began, which a finger
  flicking again and again does not allow. `FlingProbe` replaces
  `XCUIApplicationProcess`'s `waitForQuiescenceIncludingAnimationsIdle:isPreEvent:`
  (the only spelling Xcode 27's XCTest has; `…AnimationsIdle:` alone is gone)
  with a block that returns at once, and then ten flicks 0.1 s apart took 6 to
  7 s and reached 3 to 8 sections on. `NOWAIT=0` keeps the waits.

- **A Settings-stack screen can be more than one level away, even when it
  looks like one.** Reaching Fish Audio's provider form is Library → Settings
  → Providers → Fish Audio, three pushes. Until #48 each back button was named
  after the screen behind it (`Library`, `Settings`, `Providers`); since #48
  every one shows the arrow alone and is labelled `Back`, like the reader's
  (measured 2026-09-23, `DesignShotsProbe.testBackButtonLabels`), so the label
  says nothing about how deep the stack is. Tapping `app.navigationBars.buttons.element(boundBy:
  0)` exactly twice after enabling Fish Audio (assuming Settings → Providers →
  Fish Audio, two levels) landed on **Settings**, not Library (measured
  2026-09-22, `DownloadRingProbe.testDownloadRingLifecycle`): the next line
  then failed with "No matches found for … 'A Short Test of Reading Aloud,'".
  Fix: walk back with a bounded loop against something only the Library has
  (`label BEGINSWITH 'Actions for '`, the same marker `SyncProbe.openBook`
  uses), not a fixed tap count.
- **A successful Settings version probe leaves the app on Settings.** On
  2026-09-22 `SettingsVersionProbe` passed, then a Library-based download probe
  could not find `More actions` because the accessibility tree still showed
  Settings. Relaunch OpenReader before the next Library-based probe, or tap
  Settings' `Library` navigation button explicitly.
- **A manual probe can retain an old beta literal.** On 2026-09-22
  `DownloadRingProbe` still required `Version 0.0.2-beta4` while the working
  tree and Settings screen were at beta8, which would fail after the download
  assertions had already passed. Update the probe's explicit version assertion
  whenever `app-version.ts` receives the next beta; a simulator XCTest must not
  read the host checkout at runtime to infer it.
- **Several of `ScrollThemeReaderProbe`'s own methods are pinned to a book
  named `Scroll Fixture`, which is not always on the shelf.** It was #34's
  fixture and is not one of #27's two Documents (the owner's real book and
  `Stat Line Fixture`); `testVersionAndThemeLiveOnPage`, `testFastFlingBothDirections`,
  `testTapWordAfterFling`'s sibling methods that reopen it, and others all tap
  `app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Scroll Fixture'"))`
  and would fail "Scroll Fixture is not on the shelf" against a Library that never
  held it — a staleness question about the session, not the app, the same shape
  as `GeneralFontsProbe`/`READING_FONTS` above. `testLongFlingForRecording` and
  `testTapWordAfterFling` need no book by name (they act on whatever reader is
  already open) and are safe either way; `testRealTapOpenForRecording` and
  `testVersionAndLightThemeOnRealDocuments` (independent #27 verification,
  2026-09-24) were added rather than edited, so a future run against a Library
  that does hold Scroll Fixture can still use the originals. Check what the
  session's own Library holds before choosing which method to run.
- **The provider-order probe can inherit an enabled provider from app data.** On
  2026-09-22 the replacement run read `Fish Audio, enabled` after a previous
  session had configured Fish, while the probe expected every provider to be
  disabled and stopped before its Azure screen assertions. Use a fresh simulator
  or disable the retained provider through the app before treating that mismatch
  as a product failure.
- **A completed-fixture probe can start with only part of the fixture saved.**
  On 2026-09-22 the download simulator showed `1 chapters downloaded` and the
  catalog held 10 of 17 clips, so a probe requiring `2 chapters downloaded`
  failed before exercising its target control. Inspect the drawer first, then
  complete the missing chapter with `OfflineProbe`'s `download` mode or use a probe
  whose expected count matches the fixture; back up and restore the offline
  directory when the run must preserve the starting state.
- **A failed XCTest can remain in `simctl diagnose` long after its assertions
  finish.** The failed partial-fixture run left `xcodebuild` in the diagnostic
  phase with `--timeout=600`, blocking the wrapper for several minutes. Once
  the failure and its artifacts are captured, stop that exact `xcodebuild` and
  diagnostic process rather than treating the delay as an app hang.
- **A probe assertion can encode the very behavior a feature intentionally
  changes.** `OfflineProbe.swift`'s `management` mode deleted "The First
  Chapter"'s saved audio and then asserted `label == 'The First Chapter'`
  still existed — true under the old Manage downloads (list every chapter,
  issue #37's own problem statement) and false once Manage lists only
  chapters with saved audio: the row is unlisted outright, not left
  undecorated. Measured 2026-09-22: `XCTAssertTrue` failed on exactly that
  line, immediately after the same run's delete and its "saved" wait both
  passed, so the delete itself worked. Fixed by asserting the opposite (the
  row's plain and `, downloaded` labels both gone; its sibling's `,
  downloaded` label the only one left) rather than reading the failure as a
  regression in the new code — the same staleness question as
  `GeneralFontsProbe`/`READING_FONTS` above, this time in a probe rather than
  in the app.

- **A dynamic note's `BEGINSWITH` query can match the screen's own nav-bar
  title instead of the note.** `provider-screen.tsx`'s connection note and the
  pushed screen's title are both plain `StaticText`s, and `app.staticTexts` is
  unscoped: on 2026-09-22, `NSPredicate(format: "label BEGINSWITH 'Azure'")`
  against `app.staticTexts` matched the nav bar's title ("Azure") every time,
  so `AzureProviderProbe`'s wording assertions all read back the single word
  "Azure" instead of the real sentence below the Test connection button.
  Scope the query to the screen's own container instead, e.g.
  `app.scrollViews.staticTexts`, which excludes the navigation bar.
- **`.exists` right after a navigation tap can read `false` on a state that
  is actually `true`.** A helper checked `app.staticTexts["Enabled"].exists`
  immediately after tapping a Providers row and, on 2026-09-22, read `false`
  for a provider that actually was enabled — the screen had not finished
  settling from the tap. The helper then skipped disabling it, and every
  following `typeText` into the still-locked API key field failed with
  "Neither element nor any descendant has keyboard focus." Read the control's
  own state instead, with a wait: a `Switch`'s `.value` (`"0"`/`"1"`) via
  `XCTNSPredicateExpectation`, not an unretried `.exists` on a label whose
  appearance depends on a screen transition.
- **Since #48 a provider's switch label is always `Enabled`, so waiting for it
  proves nothing.** Before #48 the label read `Disabled`, `Testing…` or
  `Enabled`, and probes waited for `app.staticTexts["Enabled"]` after tapping
  the switch. With the label fixed, that query matches at once, before the
  connection check has even started. Wait for `Turn off to edit.` instead,
  which is drawn only once the check has passed and the provider is enabled,
  then read the switch's `.value`. Likewise `Test connection` keeps its label
  while the check runs, and is disabled instead: wait for its `isEnabled`, not
  for its label to leave `Testing…`.
- **`continueAfterFailure` defaults to `true`, so one wrong assertion
  cascades silently through the rest of the method.** Combined with the note
  above misreading every wording as "Azure", `AzureProviderProbe`'s first run
  logged five failures and kept going regardless, including tapping Enable at
  the end — which is why the run still ended in a real `Enabled` state
  despite failing every assertion along the way. For a probe with several
  sequential, state-dependent steps, set `continueAfterFailure = false` in
  `setUpWithError()` so a genuine failure is reported where it happened
  rather than many steps later, with everything after it unproven.
- **A masked field can screenshot as completely blank right after an
  Enable/Disable transition, even though it holds the saved value.**
  `XCUIScreen.main.screenshot()` taken in the same instant as a `Switch`
  toggling captured Azure's API key `SecureTextField` with no dots and no
  `Not set` placeholder — on two separate runs, 2026-09-22. A plain
  `xcrun simctl io … screenshot` taken moments later, nothing else changed,
  showed the correct masked dots. Before treating a blank masked field as a
  lost or uncleared value, take a second, plain screenshot outside the XCTest
  capture to rule out this rendering race.
- **`xcodebuild`'s own event trace writes a prefix of a typed secret into the
  wrapper script's `test.log`, in plain text, regardless of the field being a
  `SecureTextField`.** Configuring Fish Audio for independent #58 verification
  (2026-09-24, `testConfigureFishProviderNoRelaunch`), `test.log` held a line
  reading `Type 'sk-fish-XXXXXXXXXX...' into "Not set" SecureTextField` —
  XCTest logs the value it is synthesizing keystrokes for, in its own
  `t = …` trace, independently of what the field masks on screen or what any
  probe screenshots. This is a different leak from the masked-field screenshot
  above: the screenshot precaution does not cover it. Treat every wrapper
  script's `test.log` (and any `.xcresult` it produced) as holding the secret
  once a masked-field probe has run, `grep` it out or delete the log after
  reading the pass/fail line, and never quote the fragment itself in a report.

- **`xcodebuild … test` can stay alive long after its test has finished.**
  Measured 2026-09-23: `design-shots.sh`'s dark run wrote "Executed 1 test, with
  1 failure" to `test.log` at 17:50:36, and its `xcodebuild` was still running
  more than ten minutes later with nothing more written. Killing it ends the log
  with `** BUILD INTERRUPTED **`, and the result bundle then yields no
  attachments: the outcome survives in `test.log`, the screenshots do not. The
  cause is not established; the light run just before it, on the same
  simulator, failed the same assertion and exited at once. Watch `test.log` for
  the `Executed` line, and if `xcodebuild` is still alive a minute after it,
  kill that process and rerun rather than wait.

- **A disabled React Native `Switch`'s XCUITest `.isEnabled` can read `true`
  even though a tap on it does nothing.** Verifying #48's "the whole Voice
  sources card must freeze with the rest once enabled"
  (`ProviderFreezeProbe.testFishVoicesFieldAndEnableDisableCycle`), asserting
  `XCTAssertFalse(manualVoices.isEnabled, …)` right after a real Fish Audio
  enable failed — `isEnabled` read `true` — which looks exactly like the
  freeze not working. It is not: a follow-up method
  (`testVoiceSourcesLockIsFunctionalThenCleanUp`) started from that same live
  state (Fish already enabled, read from the device, not assumed) and tapped
  `Manual voices` for real — its value stayed `0` before and after the tap,
  printed as evidence. `disabled={locked}` (`provider-screen.tsx`) does
  correctly stop the switch from responding; the accessibility `enabled` trait
  XCUITest reads from an RN `Switch` just does not reflect it on this runtime.
  Test a `Switch`'s lock functionally — tap it and compare the value before
  and after — never with `.isEnabled`, the same way a `TextField`'s lock is
  already tested by tapping and checking for a keyboard rather than reading
  its own `.isEnabled` (`GeneralFontsProbe`'s bracket-field check, `isLocked`
  above).
- **`OfflineFixProbe.testConfigureFishProvider` passed with Fish Audio still
  disabled.** Measured 2026-09-25 on a new `iPhone 17 download_slow` (iOS
  27.0): the method passed in 74.9 s, yet its own last capture showed the
  Enabled switch off and no footer, its element tree read `Switch …
  label: 'Enable Fish Audio', value: 0`, the app's container had no
  `settings.json`, and the first download stopped with "Fish Audio is
  disabled. Choose an enabled provider." Two causes together. The tap on the
  switch only put the software keyboard away: the provider page's ScrollView
  keeps React Native's default `keyboardShouldPersistTaps`, so the first tap
  outside the focused key field dismisses the keyboard and reaches nothing. A
  simulator that shows no software keyboard never meets this, which is why the
  method worked on older devices. And the last assertion waited for
  `staticTexts["Enabled"]`, which since #48 is the row's own title and exists
  whether or not the provider is enabled. Fix, now in the method: clear the
  field before typing (a key left by an earlier run would have the new one
  appended), put the keyboard away with a tap on the `Voice sources` header
  (`.firstMatch`, since a React Native `Text` is listed twice), tap the switch,
  and wait for `Turn off to edit.`, which only an enabled provider draws. The
  rerun passed in 32.7 s and `settings.json` then held `"enabledProviders":
  ["fish"]`. `ScrollThemeReaderProbe.testConfigureFishProviderNoRelaunch`
  already waits for that note, so on such a device it fails rather than
  passing; it still taps the switch with the keyboard up.
- **On a new `iPhone 17 player` both Fish setup methods failed, and Fish Audio
  ended enabled anyway.** Measured 2026-09-25 (#67), iOS 27.0, software
  keyboard shown. `ScrollThemeReaderProbe.testConfigureFishProviderNoRelaunch`
  failed after 48.8 s waiting for `Turn off to edit.`, as the bullet above
  predicts. `OfflineFixProbe.testConfigureFishProvider` then failed after 29.2 s
  at "The keyboard stayed up": the tap on `Voice sources` did not dismiss it
  within 3 s. An `XCTAssert` does not stop a method, so it went on to the
  switch. Afterwards the page showed Enabled, `Turn off to edit.` and
  `Connection successful`, and `settings.json` held `"enabledProviders":
  ["fish"]`. Read `settings.json`, not the verdict, to know whether a
  provider is enabled. Each run also left the stack at Fish Audio's page (see
  "The harness's `open` pushes the Reader…").
- **`download-concurrency.ts` showed Speechify no faster at two or five than
  at one, which measured the provider's queue, not the service.** Measured
  2026-09-25 14:47: 22.2 s at two against 23.3 s at one, each request's own
  time doubled. Speechify's provider sends every request through one shared
  queue, so the probe's workers only lined up behind it. Since #64 the queue
  takes a width from `speechify.atOnce`, and the probe passes each level's
  width; a run at two and three then met the plan's real limits as `429`s
  (notes 15:09). Any provider that queues or paces its own requests needs
  the same, or a concurrency run measures the queue.
- **Chatterbox, as the OpenAI-compatible provider, lists every voice with
  the locale `mul`,** so a probe that looks for an English voice by locale
  finds none ("compatible: no English voice"). `VOICE_MATCH` in
  `node-kit.ts` names `Emily.wav` for it.
- **`XCTNSPredicateExpectation` created right after `.tap()` can already match
  the state from *before* the tap.** The general form of the pitfall above
  "`.exists` right after a navigation tap can read `false` on a state that is
  actually `true`": here it ran the other way, reading a not-yet-changed
  value as already settled. Measured 2026-09-23: `ProviderFreezeProbe`'s first
  version tapped Sync's switch, then immediately built
  `XCTNSPredicateExpectation(format: "isEnabled == 1", object: syncSwitch)`
  and waited on it — since `.tap()` returns once the touch is delivered, not
  once React has re-rendered `disabled={checking}` to `true`, the expectation
  can observe the *pre-tap* `isEnabled == 1` and fulfil immediately, before
  the check has done anything. The method then read the switch's `value`
  (still `"0"`, true either way for a check that has not — or has — failed)
  and the footer text (found none yet, so it fell through to "Folder", the
  next card's own title, misread as the refusal) as if the check had already
  settled. Fix: wait for the busy state to *begin* first
  (`isEnabled == 0`) before waiting for it to end, or wait on a second,
  independent control the same operation disables (`AzureProviderProbe`
  and `ProviderFreezeProbe`'s provider checks wait on `Test connection`, a
  separate row, for exactly this reason — Sync's switch has no such second
  control, which is why it needs the extra step).
  `ProviderFreezeProbe.testSyncRefusalPathAlone` does both fixes and is the
  one to reuse.
- **A Sync refusal in a probe can come from mistyped text, not the network.**
  Measured 2026-09-23: `ProviderFreezeProbe.testSyncRefusalPathAlone` typed
  `https://openreader-test-unreachable.invalid/dav` into Sync's Address and got
  `The WebDAV URL must start with http:// or https://.` after 34 s. Its
  screenshot shows the field holding `h://openreader-test-unreacha…`: the first
  ten-character chunk, typed straight after the field was emptied with its clear
  button, lost `ttps`, the controlled-field typing race described above. So that
  refusal never reached the network. An earlier run of
  `testFailurePathsNoCredentials` with the same address took 2350 s end to end,
  during an outage that also cut off the testing agent's own connection
  (`ENOTFOUND`); its cause was not isolated. The app's check itself is bounded:
  `use-sync.ts`'s `check()` is one PROPFIND through `createWebDAVClient`'s
  `request()`, which wraps every fetch in `withTimeout` at `WEBDAV_TIMEOUT_MS`,
  15 s. Read the Address back, from a screenshot or `settings.json`, before
  believing a Sync refusal.

- **A screenshot taken from a background queue while the main thread is
  blocked in `Fingers.play`'s `wait(for:)` crashes the *next* test, not the
  one that took it.** Verifying #57's long-stretch auto-scroll,
  `testDrawerLongStretchSmoothness` scheduled three `capture()` calls on
  `DispatchQueue.global().asyncAfter` to sample an 8 s hold in progress. It
  reported "passed", but the very next test,
  `testDrawerOneFingerNeverChooses`, crashed at start with `Activity cannot
  be used after its scope has completed. (NSInternalInconsistencyException)`
  and a `LockScreenProbe-Runner` crash log (2026-09-24); `xcodebuild`
  silently restarted the suite and ran the remaining tests as a fresh `Test
  Suite` block, so the crash is easy to miss unless the log is read past the
  first "passed" line. The three scheduled captures also did not do what was
  intended: their manifest timestamps landed within under a second of the
  method's own final, synchronous capture — all three fired in a burst once
  `wait(for:)` returned, not spread through the hold, because the background
  queue made no progress while the main thread was blocked inside it. Fix:
  do not call `add(_:)`/`capture()` from a background queue while a
  synthesized gesture is in flight. For an intermediate visual record during
  a hold, wrap the `xcodebuild` invocation in a host-side `xcrun simctl io
  UDID recordVideo`, started and `kill -INT`'d from the calling shell, and
  extract frames with `ffmpeg -vf fps=N` afterward.
- **A two-finger hold longer than about 3 s can be silently ignored.**
  `testDrawerLongStretchSmoothness`'s first version held for 8 s (`held()`
  emits a trembling point every 0.1 s, so ~80 points a finger). The
  synthesizer's completion handler reported success (no `TWO-FINGER
  SYNTHESIS FAILED` print), but the drawer chose nothing and never scrolled
  — `chosen=0`, `before == after` (test.log, 2026-09-24). No method in this
  codebase holds longer than 3.0 s (`testFilesEdgeTime`, `testDrawerSweeps`'s
  own edge test); rerun at 3.0 s and the same gesture scrolled 81 rows
  cleanly in a video (`f205`→`f217`, roughly one second apart, showing
  `Download selected` climbing 5 → 28 → 50 → 74). Prefer several separate
  sweeps (each ≤ 3 s) over one long hold, or confirm at 3 s first if a
  longer one seems needed; do not assume a long hold's silent `chosen=0` is
  a product defect without first trying a proven-shorter duration.
- **`.isSelected` does not read a drawer row's checked state.** A checkbox
  row is a plain `Pressable` with `accessibilityState.checked`, which iOS
  exposes through the element's `value` (`"checkbox, checked"`, matching
  `drawerRows`' own `value == 'checkbox'` predicate), not through
  `UIAccessibilityTraitSelected`. Asserting
  `row.isSelected == true` after tapping an unselected row failed
  (`testDrawerOneFingerTapToggles`, 2026-09-24) although the very next
  screenshot showed the row correctly checked — this file's own passing
  sweep tests only ever *print* `.isSelected` for the report, never assert
  on it, for the same reason. Read `chosenCount()` (the "Download selected
  (N)"/"Delete selected (N)" button's own number) instead.
- **The "Download selected (N)"/"Delete selected (N)" button always
  exists, N included when it is 0**, because it renders unconditionally and
  is merely `disabled` at zero (`download-sheet.tsx`). `XCTAssertFalse(...
  .exists, "a sweep must select nothing")` therefore always fails, sweep or
  no sweep — met twice the same day in two different probe files
  (`TwoFingerProbe.testDrawerCheckedRowsUnaffectedBySweep`,
  `PauseOrderProbe`'s ring-sweep check). Compare `chosenCount()` before and
  after instead of asserting the button's absence.
- **React Native's "Open debugger to view warnings." LogBox banner overlays
  the drawer's own footer almost exactly**, not only the floating player's
  Play button the README already documents. Measured 2026-09-24: the
  banner's frame was `{{10.0, 787.7}, {382.0, 48.0}}` and "Download selected
  (0)"'s was `{{20.0, 792.7}, {362.0, 49.3}}` — nearly the same rectangle. A
  `.tap()` on the accessibility-matched button dispatched to that screen
  point anyway, and landed on the banner: the tap "succeeded" (no XCTest
  error), but `enqueue()` never ran, `selected` was never cleared, and the
  next sweep's count came out doubled from the stale selection underneath.
  The banner is global app state and, once raised, persists until a
  restart; what raises it here was not isolated (unlike the two triggers
  the README already names). Fix, the same as for the Play button: restart
  to clear it, and check for `label BEGINSWITH '!, Open debugger'` before a
  footer tap in any probe that configures a provider or chooses a voice
  first, since either can apparently raise it.
- **The same banner covers the player's `Contents` button, and a dev client
  that lost Metro for a moment raises it.** Measured 2026-09-24 13:50
  (`LineColourProbe`, #29): the Contents drawer never opened, and the next
  step failed "No drawer to close". `node test/manual-test/kit/cdp.cjs --warnings`
  read the one warning behind it: `Cannot connect to Expo CLI … URL:
  localhost:8091 … Error: undefined`, while that Metro answered
  `packager-status:running` throughout. A terminate and launch cleared it and
  the same run passed. `LineColourProbe` now fails at once, naming the banner,
  rather than one step later.
- **A failed test leaves xcodebuild waiting ten minutes to collect
  diagnostics.** Measured 2026-09-24: the test ended at 13:21:33 with three
  assertion failures, and xcodebuild exited at 13:31:34 after
  `IDETestOperationsObserverDebug: Failure collecting diagnostics from
  simulator: Timed out after 600.0 seconds`. `-collect-test-diagnostics never`
  on the `xcodebuild test` line skips it; `line-colour.sh` passes it. It does
  not happen every time: on 2026-09-29, `kit/run-probe.sh NativeReferenceProbe`
  failed twice in the same directory on iPhone 17e (iOS 27.0); xcodebuild
  returned 91 s after the first run started, and the second waited the full
  ten minutes after its failure at 05:16:01.
- **Retrying a failed download test against the same fixture inherits its
  partial progress**, because saved audio and task state are persisted
  (SQLite) and reloaded on the next launch, not reset by
  `app.terminate()`/`app.launch()`. A `PauseOrderProbe` rerun after an
  earlier attempt had already completed three of its five chapters found
  those three rendered as checkmarks, not checkboxes — `label ==
  "Order Chapter One"` no longer matched anything, and the next selection's
  `Download selected (N)` count came out higher than expected because the
  still-selected rows from the *previous* attempt's stalled tap were never
  cleared either. Give the fixture a fresh identity between attempts that
  must start from zero: regenerating an EPUB with identical readable text
  but a bumped `dcterms:modified`/comment changes its content hash, so
  `identifyDocument` treats it as a new, never-downloaded Library entry
  without touching a single sentence (`pause-order-fixture.ts`). Remove the
  stale entry from `library.json` first (matched by title) or the Library
  shows two rows with the same name.
- **`/tmp/openreader-fish-key.txt` can be gone by the time a later probe in
  the same session reads it**, even though nothing in the session deleted
  it — macOS's own periodic housekeeping clears old files under `/tmp`.
  Measured 2026-09-24: staged once near the start of a multi-hour session,
  gone (`No such file or directory`) roughly ninety minutes later with nothing
  else having touched it. Re-stage it (`cp
  ~/.secrets/openreader/fish_audio_apikey_2.txt
  /tmp/openreader-fish-key.txt && chmod 600 ...`) immediately before a probe
  that needs it if any real time has passed, rather than trusting an earlier
  staging in the same session.
- **A freshly created worktree simulator does not have `A Short Test of
  Reading Aloud` (or any of the other shared fixtures) in its Library**,
  only whatever the task handoff explicitly says was loaded. The README's
  "Issues #13/#14" section describes seeding it once through
  `identifyDocument`/`serializeLibrary` directly, as a one-time step on the
  original device; a later, different device needs it seeded again.
  `test/manual-test/fixtures/short-test-fixture.ts` generates the same two chapters
  and 17 utterances, for loading through the walkthrough harness's `add`
  command instead (README, "Real books") — an equally direct, non-picker
  path, proven working 2026-09-24.
- **A drag between two sibling labels that sit outside the Download drawer's
  chapter list scrolls nothing, with no error.** Verifying #64
  (`DownloadConcurrencyProbe`), a first version dragged between the "N
  chapters downloaded" line and the "Download selected (N)" button — the
  natural anchors, immediately above and below the list on screen — for 45
  attempts with zero effect: the same five chapters stayed on screen every
  time, and the probe's own `XCTAssertTrue` only reported "Could not scroll",
  no crash or warning. Measured from the tree: the list's own `ScrollView`
  sits at `{y: 411.7, height: 330}`, but the "downloaded" text ends around
  `y: 372` and the button starts around `y: 792.7` — both outside the
  ScrollView's frame, because the footer's own "Manage downloads" row and the
  layout's `gap`s sit between them and the list. A drag's start point is what
  gesture arbitration hit-tests; starting outside the ScrollView and merely
  passing over it on the way to the other anchor never engages its pan
  recognizer, and nothing here has `minPointers(2)` to explain the miss the
  way `use-sweep.tsx`'s two-finger sweep gesture might suggest. Fix: query
  `app.scrollViews.firstMatch` directly and drag between two points inside
  *its own* frame (`list.frame.maxY - 12` to `list.frame.minY + 12`); the
  same run then reached a chapter about 100 rows down in under 40 drags.
- **A document whose saved audio was written by `download-chapter.cjs`
  (CDP, calling `runtime.enqueue` directly) shows "Choose a voice in the
  player" and "0 chapters downloaded" the first time it is opened for real,
  even chapters deep into that same voice's saved clips.** `enqueue` never
  calls `library.voiced()` — that is a UI-level side effect
  (`reader-actions.tsx`'s `onStart`/`onVoice`), so the Library entry's own
  voice stays unset and the drawer computes progress against the settings'
  default voice instead, which owns nothing. The saved audio is not lost: the
  drawer's own "Use downloaded voice · `provider/voice`" link is offered
  (`otherVoices` in `download-sheet.tsx`) and a real tap on it calls
  `library.voiced()` for real, after which the count and the checkmarks
  appear. Tap it before selecting any chapter. The same first real open also
  retitles the Library entry from the EPUB's own metadata (the `add`
  version of this pitfall, above) even when the entry was seeded directly
  in `library.json` with a different title, not only when `add` named it
  after its file — a `BEGINSWITH` match on the seeded title stops working
  after that first open for the same reason either way.
- **A single `typeText` call on a `keyboard="url"` `TextInput` silently drops
  characters mid-string.** Verifying #65 (`DownloadConcurrencyProbe`,
  OpenAI Compatible's Address field), one unchunked `field.typeText(baseURL)`
  produced `h//<host>…` on screen and in the accessibility tree —
  five characters ("ttps:") gone from the middle of "https://…" — even though
  the same call worked for the plain-keyboard Model field right below it.
  `AzureProviderProbe.clearAndType`'s existing fix (type in chunks of ten,
  README's "typeText with a long value kills a settings screen") also fixes
  this; a `url` keyboard specifically needs it even for a fairly short value.
- **Tapping a switch while a field is still focused can spend the tap on
  dismissing the keyboard instead of toggling the switch, and no single
  sibling tap reliably dismisses the keyboard first.** Measured 2026-09-25
  configuring OpenAI Compatible and Speechify from empty settings
  (`DownloadConcurrencyProbe`): `OfflineFixProbe`'s own fix for this
  (tap a plain Text inside the ScrollView, then wait for
  `app.keyboards.firstMatch` to go away) failed here even after switching the
  dismiss target to the navigation bar, itself outside the ScrollView
  entirely — the keyboard was still reported present 5 s later either way.
  Stop trying to guarantee keyboard dismissal before the real tap; instead
  read the switch's own `.value` before tapping it, tap it, and tap it again
  only if the value did not change — self-verifying regardless of why the
  first tap did not register.
- **A voice a probe hardcodes can quietly disappear from a live provider's
  own catalog.** `VoiceListProbe.swift` names a specific real Speechify
  voice, "Dax — Casual US male (EN)" under en-US, as of when it was written.
  Verifying #64's Speechify `RequestQueue` change on 2026-09-25, that same
  chip/locale path opened fine (both chips read Selected in the accessibility
  tree) but no button named "Dax — Casual US male (EN)" existed anywhere in
  the sheet after a 10 s wait — `waitForExistence` just polls and times out,
  printing no hint of what changed. Speechify's en-US list is alphabetical
  now, in a different label shape ("Alfonso (male)", "Alicia (female)", …
  "Emily (female)", "Erin (female)", …), with no "Dax" among them; nothing
  about the request failed. Read the sheet's own tree (or a screenshot) before
  assuming a network problem, and for a mechanics check that does not care
  which voice, prefer `app.scrollViews.buttons.firstMatch` (the voice list's
  own ScrollView has no other Button-typed children; the locale chips above it
  are `Other`, not `Button`) over a name that can go stale.
- **A masked field's dots can be invisible on screen while the accessibility
  tree still reports them.** Verifying #65's "Extra headers is a secret field,
  so it is masked too" requirement, a screenshot of a filled, focused
  `SecureTextField` labelled "Extra headers" showed nothing at all in the
  value area — no bullets, no placeholder, nothing — both while focused
  (`Keyboard Focused` in the tree) and after locking on Enable. The same
  screenshot's accessibility tree reported the field correctly, `value:
  ••••••••••••••••••..., Disabled`. Content is not visible either way, so
  nothing is leaked, but do not rely on a screenshot alone to confirm masking
  for this specific field — cross-check the exported tree's `value`. Not
  this field alone: at beta28 (`testDownloadsCardLastAndHeadersEye`) Fish
  Audio's saved, locked API key drew no dots either, beside its eye. Since
  beta28 Extra headers has the same eye as the API key, so the owner can
  check either value on screen.
