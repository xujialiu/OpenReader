---
status: accepted
---

# Nothing above the page changes while the page moves

_The product argument is
[design 0045](../design/0045-a-fast-scroll-never-skips-text.md). Issue #58._

**This corrects two explanations.** ADR 0043 put the empty frames left in a long
fling down to epub.js outrunning itself, and `test/manual-test/README.md` put a
swipe that moved the page from section 23 to section 6 down to uneven chapter
lengths. The measurements there stand; the explanations were wrong, and both
were this defect.

## The defect

Flicking fast through a document, once the scroll passed the end of the text
epub.js had laid out, the page went empty for a moment and the text jumped:
forward by up to a whole section, back by several. The owner reported it after
#27 had made the empty page dark instead of white.

## What was measured

iPhone 17 simulator, iOS 27.0, 2026-09-24, the owner's "My Vampire System 1-250"
(253 sections). `test/manual-test/scrolling-and-theme/fling-jump.cjs` makes real XCTest flicks and
reads, on every animation frame, which section and which offset within it is at
the top of the viewport and how much of the viewport displayed sections cover;
it wraps the manager methods below to log each call. The details are in
`notes/NOTES_2026-09-24.md`, 02:18 to 05:36.

- **epub.js adjusts the scroll whenever it changes what lies above the
  viewport**, read out of the bundled epub.js. Going forward, `update()`
  destroys the iframe of a section that has left the screen and enqueues
  `trim()` 250 ms later, and `trim()` erases the elements above with
  `erase(view, above)`, which scrolls back by each one's height:
  `this.scrollTo(0, scrollTop - height, true)`. Going back, `check()` prepends
  the previous section when the `scrollTop` it last heard is within its offset,
  500 px, of the top; the new view starts at height 0, and its `RESIZED`
  listener calls `counter()`, which scrolls on by the growth,
  `scrollBy(0, heightDelta, true)`, itself `container.scrollTop += y`.
- **iOS drops that adjustment while it moves the page itself**: under the
  finger, in a fling's momentum, in the bounce at either end. Forward, with
  section 2 (5,362 px) erased above at `scrollTop` 13,198, epub.js set 7,836 and
  read it back in the same frame; 57 ms later the position was 12,184, where the
  fling would have been without the adjustment, beyond the laid-out text
  (`scrollHeight` 11,106), and no section covered the viewport for 6 frames.
  The page settled 3,118 px further into section 5 than it had been. Back, four
  sections were prepended during the bounce at the top, 15,505 px of
  adjustment, and the next frame read −53: section 19's top instead of section
  23, its iframe still hidden, and nothing drawn for 29 frames while epub.js,
  working from the position it had set, destroyed it and displayed it again.
- **Before the change, the loop was red in every run**: ten flicks forward from
  section 20, 4 of 4, with 7 to 21 blank frames; ten back from section 60, 4 of
  4, with 182 to 248 blank frames, reaching 12 to 28 sections back; a single
  flick from 1,200 px before the end of section 20, 3 of 3. A recording of a
  forward run had 24 empty frames and showed the page skip from the middle of
  section 5 to its end.
- **The same boundary crossed from JavaScript kept every adjustment**:
  `scrollTop` set on every animation frame, faster than the flicks, 0 blank
  frames and 0 jumps in 4 runs, one of them with an erase above while the script
  scrolled. The page's own scroll loses only to iOS's.
- **A relative `Element.scrollBy()` is dropped the same way**: with the
  manager's two scroll methods replaced by it, 4 of 4 runs red.
- **Not every adjustment made in motion is lost**: in one run the first erase
  above was kept and the next lost. Every adjustment made at rest was kept.
- **Touches do not say whether the page is moving.** Listening on the reader's
  document and every section's, a probe heard 1 to 4 `touchstart`/`touchend`
  pairs from ten flicks: a touch that lands on a moving page is iOS's, to stop
  the scroll.
- **Neither does a quiet spell.** The WebView's scroll events stop for up to
  280 ms at a time while the page moves at 2 to 6 px/ms, whenever its main
  thread is laying a section out, and a drag reaches it in steps about 100 ms
  apart.

## The decision

The program wraps the manager's `trim()` and `check()` as it installs
(`holdStill` in `src/renderer/highlighter.ts`), so that nothing above the
viewport is added or removed while the page moves.

- A `trim()` called while the page moves is **parked** instead of run. The
  sections the page has left keep their elements, and so their height, with no
  iframe in them: `update()` destroys the iframes as before.
- A `check()` that would prepend while the page moves is run with the manager's
  `scrollTop` set to the offset for that one call, which prepends nothing, and
  a check is parked. Everything else it does, appending below and showing and
  destroying views, goes ahead.
- **Moving** is a scroll event under 200 ms old, or a position that differs from
  the one the last scroll event saw, which is iOS's newer position arrived ahead
  of its event.
- **At rest** is the position unchanged for 200 ms over at least 4 successive
  animation frames. A frame loop runs only while something is parked. A frame
  reads the position iOS last sent even straight after a long task, when a
  timer's reading could still be the one from before it.
- Parked work runs **through the manager's own queue**, as epub.js schedules its
  own trim, and through the wrappers again, so a fling that starts before the
  task runs parks it again.

It is the program's, not a `patches/` change to the library: the program already
reaches into the manager for `renderAhead` and the centring, and the rule it
states is about this app's page.

## Consequences

- **Forward costs nothing**: appending below needs no adjustment and is not
  held. Measured after the change: ten flicks forward from section 20 green in
  every run the probe watched to rest, 8 of 8, every erase above made at rest,
  and 0 empty frames in a recording.
- **Back, a fling stops at the top of the laid-out text**, bounces, and the
  section before is laid out once the page is still: 200 ms and one frame
  loop's worth after the bounce ends, then the prepend itself. Ten flicks
  without a pause never got past section 59 from 60; ten flicks 0.8 s apart
  reached section 56, about as far as ten flicks carry the page forward, 3 to 6
  sections. That is the cost design 0045 accepts.
- **A prepend made at rest still grows a few milliseconds later**, when the
  section has laid out: 6 to 19 ms from `prepend` to its `reframe` for sections
  epub.js had loaded before. A flick that starts in that window would lose that
  one adjustment. No run showed it.
- **A finger that stops the page and holds still for 200 ms is rest.** Whether
  iOS keeps an adjustment made under a still finger was not measured; touches
  cannot be used to tell, as measured above.
- **`check()` borrows the manager's `scrollTop` for one call.** With the
  laid-out text shorter than about two screens, the borrowed value can let it
  append a section epub.js would have appended a moment later anyway.
- **The empty frames of a long fling were this.** ADR 0043 counted 13 to 55
  empty dark frames per run of `white-flash.sh fling`, fifteen XCTest swipes
  each way, after #27, and put them down to epub.js outrunning itself. With
  parking, the same run had none in 3,854 frames, and recordings of ten flicks
  forward and ten back had none either.

## Alternatives

- **Make the adjustment relative.** Measured: `Element.scrollBy()` is dropped
  the same way.
- **Reserve empty space above the laid-out text**, so that a prepended section
  takes that space instead of pushing the text down and needs no adjustment.
  Back flings would never stop, but the owner would fling into empty space while
  the section loads, which is the empty page #58 is about; and `check()`, every
  display's `moveTo` and the scroll bar would all have to learn about the space.
- **Stop the fling before adjusting**, by switching the container's scrolling
  off for a frame. Not tried: the page would stop dead at every trim going
  forward, where parking costs nothing.
- **Tell rest from touches**, or from a timer since the last scroll event.
  Measured unreliable, above.
- **Patch epub.js in `patches/`.** The same rule in a 487 KB minified string
  the project does not own, with its own fact tests to keep.
- **Never trim.** A whole reading session's sections would pile up above the
  page; parking delays each trim only to the first rest.

## Tested

`test/renderer/rules.test.ts`, "nothing above the page changes while the page
moves": the library facts above, pinned in the installed epub.js's continuous
manager, and the program's wrapping, its test for movement and its rest loop.
The program half was seen failing before the change. The device is the only
place the defect exists: `test/manual-test/scrolling-and-theme/fling-jump.cjs`, red on the unchanged
tree in both directions and with the install line commented out, green on the
change.
