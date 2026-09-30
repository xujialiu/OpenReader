# Measuring inside the reader's WebView

## Measuring inside the reader's WebView

- **`performance.now()` is coarsened to 1 ms.** Time N repetitions and divide.
- **Computed sizes include text-size-adjust on an iPhone, and not on an iPad in the desktop content mode.** Divide by the percentage in effect only where it applies (ADR 0030).
- **A probe's own root-only text-size-adjust rule loses to the app's.** The app declares text-size-adjust on every element in `#openreader-highlight`. Take those lines out for the probe and put them back afterwards.
- **`rendition.on('rendered', …)` never fires for a probe either.** The library's template registers its own `rendered` listener first, it throws on every section, and epub.js's emitter stops there (#34, ADR 0036). A probe that counts `rendered` reads 0 however much renders. Use `rendition.hooks.content.register`, which runs for every displayed section, or read the views (`rendition.manager.views.all()`).
- **A regex inside a probe's template literal loses its backslashes.** In a `.cjs` script the WebView code is a template literal, where `\d` cooks to `d`: `/^(\d+)/` reached the WebView as `/^(d+)/`, matched nothing, and an event history came back empty rather than failing. Write `\\d` in the script's source.
- **`scrollTop = 0` does not take the page away from the reading.** It goes to the top of the first view. epub.js answers by prepending the section above, scrolling down by its height so the text stays where it was, and trimming the new sections again about 350 ms later. Measured 2026-09-23 at 19:48: twelve of them left the views at `[5, 6, 7]`. Scroll in relative steps (`scrollTop -= 1500`), as `follow-probe.cjs` does. Five `scrollTop = 0`s did walk the page up at 19:26, from a different starting place, so do not rely on either result.
- **A display's promise resolves as the section's iframe starts loading, not when the section is on the page.** For every load request that is not its main document, `@epubjs-react-native/core`'s `onShouldStartLoadWithRequest` calls `goToLocation(url)`. A section's `srcdoc` iframe is one, so the library itself runs `rendition.display('about:srcdoc')`, and epub.js's `Rendition.display` resolves the display in flight whenever another is asked for (measured 2026-09-23, 19:53, by recording a stack for it). A probe that waits on `rendition.display(…).then` reads the page before the section is there. Wait for the content hook, or for the queue to empty, instead.
- **Resetting the page with `rendition.display()` while epub.js's queue is still busy left the queue stuck for good.** Measured 2026-09-22 at 12:30: after four back-to-back flings the manager's queue held 17 tasks with `running` true, nothing it held ever ran, and every later fling moved nothing (`scrollTop` 0, one view), which reads as the page refusing to scroll rather than as a stuck queue. Wait for `!rendition.manager.q._q.length && !rendition.manager.q.running` before a reset, and treat a queue that does not empty as its own finding; `scroll-theme.cjs` does both.
- **A screenshot taken right after a reader remounts can be blank even though
  the DOM underneath is already styled and has its text.** Measured
  2026-09-22 verifying #34: after leaving the reader and tapping a Library row
  to reopen it (a fresh `WKWebView`, not the same one Appearance/Font Size
  reflow), `waitForLayout`'s signal — React Native's "Laying the document
  out…" placeholder gone — had already cleared, yet two screenshots taken
  right after came back page-coloured with no glyphs at all, in both themes.
  A same-second harness `js` audit of the WebView found the section's
  `#openreader-highlight` style installed and its text present
  (`bodyRect=[27,7112]`, `text="Chapter 26: …"`), and a screenshot taken about
  two seconds later than the first pair showed that same text correctly
  painted. React Native's placeholder tracks the app's own readiness, not
  whether WebKit has actually composited a frame after a brand-new
  `WKWebView` is inserted; the two are not the same signal. Add a second or
  two of settle time after reopening a reader (not needed for
  Appearance/Font Size changes to an already-visible WebView, which repaint
  promptly) before trusting a screenshot of it.

- **A scroll made from JavaScript does not show what a finger's fling shows.**
  60 frames of `scrollTop += 300` on the manager's container, the same
  distance as a long fling, gave 0 white frames in 52 (2026-09-23 23:04), while
  real XCTest flings gave white frames in 3 of 3 runs (#27). The difference is
  #58's (ADR 0045): while iOS moves the page itself, under a finger or in a
  fling's momentum, it drops the scroll epub.js sets to keep the text still when
  it adds or removes a section above, and a script's own scroll is not iOS's.
  The same boundary crossed from JavaScript kept every adjustment in 4 of 4 runs
  (2026-09-24 02:35), where one real flick lost it in 3 of 3. `scroll-theme.cjs`
  (#34) is still right for what it asks, whether a section was styled; use real
  touches (`fling-jump.cjs`, `white-flash.sh fling`) for what is seen during the
  scroll.
- **A probe can post a long log straight to the Mac.** The harness's `js`
  answer is one line in Metro's log (`HX PROBE …`, #113; it was cut at 500
  characters while it rode the player's note), and a log of every animation
  frame is hundreds of kilobytes. From the reader's WebView, a `file://` page,
  `fetch('http://127.0.0.1:PORT/…', { method: 'POST', body })` reached a server
  on the Mac (2026-09-24 02:15), answered with `Access-Control-Allow-Origin: *`.
  `fling-jump.cjs` runs one on a free port and hands the probe its number.
- **A finger that lands on a moving page seldom reaches the page's touch
  listeners.** Listening on the reader's document and on every section's, a
  probe heard 1 to 4 `touchstart`/`touchend` pairs from ten flicks, each landing
  while the page still coasted from the one before (2026-09-24 02:48). iOS takes
  that touch to stop the scroll. Do not count fingers in the WebView during
  flings.
- **The WebView's scroll events stop for up to 280 ms while the page moves**,
  whenever its main thread is laying a section out, and a drag reaches it in
  steps about 100 ms apart (2026-09-24 02:57). So a quiet spell is not rest, and
  a big step between two samples is not a jump on screen when the text moved
  exactly as far as the scroll position did: `fling-jump.cjs` counts a step as
  a jump only when it outruns the page's own recent speed and either epub.js
  had just scrolled the page or the text and the scroll moved differently.
- **A probe stopped as soon as its XCTest returns can stop before the page
  rests.** Ten flicks can coast for longer than the XCTest's two seconds of
  settling, and work the program parks until the page rests (#58) had not run:
  three runs at 05:23–05:25 on 2026-09-24 were INCONCLUSIVE for that. Wait for a
  second without scroll events and an idle queue, as `fling-jump.cjs` does.
- **`fling-jump.cjs` called a JUMP on a real fling that never left the screen
  full of text**, before its rule was tightened. Independent #58 verification,
  2026-09-24, on "Cultivation Online" (`down`, real flicks): two runs each read
  one or two JUMPs, 17–20 ms after an `append()`, never after an
  `erase`/`counter`/`scrollTo`/`scrollBy`, with coverage 1.000 throughout. The
  frame pair was a sample repeated at the same `scrollTop` and then a step of
  639 px in 16 ms, in which the text moved exactly as far as the scroll position
  did: a new flick's drag reaching the WebView in one batch. The rule then
  excused such a step only while a touch event showed a drag, and a finger
  landing on a moving page is seldom heard (above). Confirmed not a jump:
  `white-flash.py` on that run's recording read 0 empty-dark and 0 white frames
  in 499, and the frames spanning it show prose advancing smoothly. The rule now
  needs, besides the step outrunning the page's recent speed, an epub.js scroll
  in the 150 ms before or text that moved a quarter of a viewport more or less
  than the scroll; on every saved log it keeps all 23 red runs from before the
  change red and reads both of these runs green. A JUMP that follows `append()`
  alone would now be a new finding.
- **A tap right after a fast-fling burst can silently do nothing**, unrelated to
  #58. Independent verification, 2026-09-24: `ScrollThemeReaderProbe`'s
  `testFastFlingBothDirections` + `testFontSizeLiveOnPage` +
  `testTapWordAfterFling` run together, the last method's own real tap left
  `utterance`/`section` both `null` and no highlight painted, although the
  screenshot showed real chapter text under the tap point — and `known` (the
  Utterance count `{"do":"say"}` reports) had not grown at all since the reader
  was opened, well before any of the three methods ran. A fresh standalone
  rerun of just `testTapWordAfterFling` moments later, on the same live app,
  tapped cleanly: `utterance`/`section` updated and the sentence highlighted
  (screenshot confirmed), and `known` had grown substantially by then. The tap
  resolves through `utteranceAt`, which needs the tapped section's Blocks
  already adopted from epub.js's content hook (`highlighter.ts`'s `adopt`,
  fired once per section's iframe `load`) — a mechanism the #58 fix never
  touches (`append()`, which is what puts a new section's iframe up, is not
  gated at all). A fast, unpaused fling can plausibly outrun that adoption for
  the section it lands on. Before reading a null tap as a `#34`/`#52`
  regression, check `known`/`rendered` via `{"do":"say"}` first, and retry the
  tap once rather than treating one miss as the result.
- **A note a probe puts on the player stays on screen as a visible error
  banner until something clears it, and a plain skip does not.** Since #113 a
  `js` command's answer is its own `HX PROBE …` line and leaves nothing on the
  player. A probe that posts an `openreader:problem` message itself still goes
  through `use-reading.ts`'s "highlight could not be drawn" problem-report path
  (`line-follow.cjs`'s `noted`, which wants a note; until #113 every `js`
  answer did), so the reader keeps showing "The highlight could not be drawn:
  …" over the player until `status.note`
  is next set to `null` — which a Play (`onPlay`) does at once, but a paused
  `{"do":"skip",...}` measured here (2026-09-26, #71) does not, even after a
  skip back and forward. Before handing a reader back with such a note as
  the last thing posted, send a real `play` (a fraction of a second is enough;
  `note: null` is set the instant Play starts, before any Clip) and `pause` it
  again, and confirm with a screenshot that the banner is gone rather than
  trusting the status line's `note=null` alone — the banner is a UI overlay,
  not part of `status`, so only a screenshot shows it directly.
- **The harness `open` command pushes onto whatever screen is already on top,
  the same as `simctl openurl`** (Pitfalls, XCTest, "`Back` is not what the
  back button is called"). Independent #58 verification, 2026-09-24: opening a
  Document by id right after an unrelated XCTest run had ended on Settings
  left the stack `["Library","Settings","Reader"]`, so a later probe's own
  `if app.buttons["Back"].exists { tap }` (expecting Library behind the reader)
  landed back on Settings instead, and the next line failed looking for a
  Library-only control. `{"do":"navstate"}` shows the real stack; back out to a
  single-entry `["Library"]` before a method that assumes it.
