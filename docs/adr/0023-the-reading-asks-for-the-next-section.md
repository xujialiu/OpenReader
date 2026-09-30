---
status: accepted
---

# The reading asks for the next section, and the engine says when it has run out

**ADR 0036 corrects the cause given twice below.** `rendered` did not arrive
because the library's own `rendered` listener throws first, for every section
and however it was displayed — not because of the way a section was displayed.
The program now adopts every section through epub.js's content hook. The
measurements below stand.

Three changes to one chain, made together because none of them is a fix on its
own. The product argument is in
`docs/design/0023-the-reading-does-not-stop-at-the-end-of-a-chapter.md`.

## The defect

Found on 2026-09-20 during the first long backgrounded run
(`notes/NOTES_2026-09-20.md`, 04:43) and reproduced on demand the same morning
(05:03). **The reading stopped at the end of the Utterances the renderer had
reported and never started again** — `known` stuck at 108, the Utterance stuck at
107, for six minutes, in the background and in the foreground alike. The engine
behaved exactly as footgun 3 says a drained queue should: silence, still
`playing`, no crash, session held.

The chain closed on itself, and it had three links rather than the one the first
note named.

**Link one: only the scroll renders more.** ADR 0011 mounts the reader with the
`continuous` manager, whose `onScroll` enqueues a `check()`, and `check()` appends
the next spine item only when `scrollTop + bounds.height + settings.offset >=
container.scrollHeight`. `settings.offset` is 500. The only thing that scrolls
while a book is being read aloud is `centre()`, and `centre()` stops at the
sentence being spoken. Measured on the fixture at 05:03: one view, `scrollTop` 0,
`clientHeight` 758, `scrollHeight` 3,072 — and 758 + 500 = 1,258, which is less
than 3,072 for ever.

**Link two: a section could be on the page and never reported.** Measured on the
owner's book at 05:31, in the state the 04:43 reading died in: views
`[3, 4d, 5d]`, section 5 displayed and holding a live document, `known` still 108,
and section 5 **never adopted**. `liveContents` adopts the section it is asked
about, and nothing asks about a section the reading has not reached; epub.js's own
`rendered` event fires from inside its hook chain and does not always arrive.

**Link three: a longer list could not be applied.** `use-reading.ts` held new
Utterances back until the next Clip boundary, because the only way to hand the
engine a list was `load`, which clears the queue and re-anchors the clock and so
restarts the sentence being spoken. The boundary it waited for is a Clip
*starting*, and no Clip starts when the engine has nothing left — so the one
moment a longer list was most needed was the one moment it could never be
applied.

## What was decided

**The renderer renders the section the reading is walking into, driven by the Clip
cue.** `renderAhead` in `highlighter.ts`. It adds nothing to the bridge — the cue
already arrives once per Utterance and already drives the centring, which is the
property ADR 0011 states of the centring and the reason it states it. Three
guards:

- one section, the one after the voice, through the manager's own
  `section.next()` — the same call its `check()` makes, and the one that knows
  about a spine item that is not linear;
- only when that section is the manager's last view, because the view list is a
  contiguous run of spine items and appending out of order would put the wrong
  text under the reader's thumb;
- once per section ever, on `bySection` and a set of the ones already asked for —
  load-bearing rather than tidy, because the manager trims the view again within a
  second or two and without it the same chapter would be fetched and parsed once
  per Utterance.

**It appends through the manager's own queue**, and that is the whole difference
between it working and not. Measured at 05:09: appended and displayed straight
away, the view was taken apart by the `update()` a scroll had already scheduled
before its iframe had loaded — `displayed` false, `iframe` undefined, its
`display()` promise never settling, no Blocks ever reported. epub.js's own
`check()` appends, displays and updates inside one queued task, and the queue
holds the next task until the promise a task returns resolves.

**And it sweeps itself.** `rendition.on('rendered')` does not arrive for a view
displayed this way — watched for five seconds at 05:13 while the view reached
`displayed`, held a live document and a paragraph, and the program had not adopted
it. The program therefore sweeps on the Clip cue as well, which is the same
invariant the `relocated` sweep already keeps: **what is on the page has been
reported**. One `rendition.getContents()` and a WeakMap lookup per rendered view,
once a sentence; `adopt` is idempotent per document.

**Nothing keeps the rendered-ahead section alive.** The Block records survive the
view being destroyed — that is what `blocks.ts` is for — and when the voice
arrives there, `follow()` displays it exactly as it already did for text that is
not on the page. So the manager goes on holding three views: measured
`views=[9-, 10d, 11d]` at the end of the fixture run, and `[3-, 4d, 5d]` and
`[6-, 7d, 8d]` through the owner's book.

**The engine grows its list without restarting.** `PlaybackEngine.extend`. The
caller has already established that the new list continues the old one rather
than renumbering it (`samePrefix`), so every index the queue, the timeline and
the WebView are holding still means the sentence it meant before; the read-ahead
simply has further to go. Nothing is cleared, no generation is bumped, so it is
also safe to call from inside the renderer's message handler where `load` was
not. The Clip-boundary deferral in `use-reading.ts` is gone with it, and with it
the deadlock.

**And the engine says when it has run out.** `onOutOfText`, decided by
`hasRunOut` in `read-ahead.ts` on four conditions — playing, everything enqueued,
the queue consumed, nothing in flight — because anything less is a Provider being
slow, which is a stall the reader hears and which ends by itself. Said once;
armed again by a longer list, a seek or a load.

The app turns it into one of **three** sentences (`outOfTextSentence` in
`src/app/segment.ts`), and they are not the same event. At the last spine item the
book has finished and the reading **stops**. Anywhere else the reading has
outpaced what the document rendered, and it is left running, because the engine
picks up by itself the moment another section reports.

## The third sentence: a Provider failure is not the end of a book

Added 2026-09-20 after the first end-to-end walkthrough
(`notes/NOTES_2026-09-20.md`, 07:48). Fish Audio answered "cannot reach
api.fish.audio … The network connection was lost" for the last clips of a
document. The reading stopped at Utterance 17 of 18 and the player said **"That
was the last of this document. The reading has stopped at the end of the book."**

**None of the four conditions can see a Clip that was refused.** A rejected fetch
leaves `inFlight` in its `finally`, `drain` steps over the Utterance rather than
blocking the queue behind it, and `nextToEnqueue` passes it — so `playing`,
everything enqueued, the queue consumed and nothing in flight all hold exactly as
they do for a book that finished. The state is indistinguishable from the inside,
which is the same shape as the defect this ADR is about.

**A fifth condition was refused.** Suppressing the announcement when something has
failed would put the reading back in the state of 04:43: silent, `playing`, and
saying nothing — and `docs/design/0023` names the lie the announcement replaced as
worse than the silence *because it is a lie*, not because it is a sentence. The
reading genuinely has run out; what was wrong was the reason given for it.

So the engine reports what it already tracks. `onOutOfText` now carries an
`OutOfTextReport` — how many Utterances it holds, how many were **never spoken**
since the last `load` or `seek` (`failed.size`), and the last refusal that left one
unspoken, unconverted. `outOfTextSentence` takes the count and the reason and says
that the reading stopped because synthesis failed, names the refusal in the words
it arrived in, and says that going back to those sentences is how they are asked
for again — because nothing is retried out of sight (ADR 0002, philosophy rule 4).

`ended` is deliberately untouched by a failure: it decides whether the engine is
**paused**, and at the last spine item there is nothing left to play whatever the
reason. Before it, more text is still coming and the reading is still waiting for
it. The failures are behind the cursor either way.

## The one thing that must not change

`centre()` still goes through `rendition.manager.scrollBy(0, move, false)` with
epub.js's `ignore` flag **off**, so it reaches the continuous manager exactly as a
finger scroll does. That is still what appends the next section on an ordinary
book, and `renderAhead` is a no-op whenever it has already happened. Turning the
flag on would take the ordinary path away and leave only the new one.

## A section not on the page is not a highlight that failed

Since `renderAhead` this happens at **every section boundary** of a document whose
sections are taller than their text: the cue arrives, the section has been trimmed,
`follow()` displays it, and `attach()` paints the highlight a fraction of a second
later. Reporting that moment as a highlight that could not be drawn left the
sentence "Block 11.0 is in section 11, which is not on the page" standing on the
screen while the highlight was, in fact, drawn — seen at 05:16 at every one of
eleven boundaries. `showUtterance` is therefore silent for that one reason, and
only while the page is following the reading, which is what brings the section
on to the page (the amendment below extends this to the word, #50). A Block
nobody reported, and a Block the rendered section no longer holds, are still
reported; so is anything `attach` cannot highlight, because the section it asks
about has arrived, and a section that has arrived and still cannot be
highlighted is the real thing.

## What it cost

Measured on the fixture and on the owner's 2,077-section book; the figures are in
`notes/NOTES_2026-09-20.md` at 05:03, 05:09, 05:13, 05:16, 05:19, 05:31 and 05:53,
and the memory table is checked against ADR 0011's own.

## Amendment (2026-09-23, #45, #46 and #49)

**A press of Play asks again for every refused Utterance (#45).** "How many were
**never spoken** since the last `load` or `seek`" above is now since the last
`load`, `seek` or `play`. `play()` in `engine.ts` asked again only for the
Utterance at the cursor, while the read-ahead refuses two at a time: measured on
2026-09-23 (`notes/NOTES_2026-09-23.md`, 13:30), 279, 280 and 281 were refused
together, Play asked again for 279 alone, and the reading stopped at 280 with no
request sent for it and the old refusal still on the screen. `retryOnPlay` in
`read-ahead.ts` now answers with an empty failed set, and moves `nextToEnqueue`
back to the cursor only when the cursor's own Utterance was refused — `drain`
never steps over a refusal, so otherwise the cursor's Clip is already queued —
and `play()` clears `lastRefusal` with them. "Going back to those sentences is
how they are asked for again" stays true of a seek; a press of Play is the other
explicit act, and nothing is asked for again without one.

**A renumbered list carries the reading across (#46).** `extend` above is for a
list that continues the one the engine holds. The other case, a section reported
above sections already reported, shifts every later index, and it stopped the
reading: `adopt` paused the engine, cleared the highlight, loaded the engine at
0, set the cursor to null and said so, and its docblock called it "the one case
that still needs the destructive `load`, and it is the case where destroying is
the point". It is not rare. epub.js's continuous manager renders the section
above whatever it displays near the top of its scroll, and on the owner's book
(`notes/NOTES_2026-09-23.md`, 13:35) a Contents jump reported sections 1 and 2,
then 5 and 6, then 3 and 4 above them; a reopen at a stored place in section 6
was renumbered after the resume had landed; Play then read the book's first
line, and after six seconds and a pause the Library's place was "9kafe.com" with
a new Stamp.

`carryUtterance` in `src/app/segment.ts` now finds each held sentence in the new
list by its first Block's id (`sectionIndex + '.' + i`, `highlighter.ts`), its
start offset in that Block and its text. That is exact rather than an estimate:
the Blocks stay in spine order (`withSection` in `blocks.ts`) and `rejoin.ts`
never welds across a section, so every other section's Utterances are segmented
as before. `adopt` carries the cursor, the sentence a resume landed on and a
seek still in its debounce — but not a cursor its caller, a landed resume or a
Contents row, has already pointed into the new list — and loads the engine again
at the carried index without pausing it. Playing, the reload's first cue is the
reading's own, and the page follows the voice as always. Paused, the reload is
quiet (`LoadOptions.quiet`) and nothing is shown: a renumbering while paused is
what scrolling up does, and a `show` or the reload's first cue — a cue carries
the renderer's `reveal`, which centres the page on its sentence — would pull the
page back to the reading while the owner scrolls away from it. The first cue
waits for `play()`, which cues the front before it corrects, and nothing reads
the bridge's old number before then: corrections arrive only while the node
renders (react-native-audio-api 0.13.5 advances its position dispatcher only
while `isPlaying()`). Nothing is said. With no cursor the engine loads at 0,
silently. `load` is still the destructive call, because the queue, the timeline
and the WebView hold old numbers, so a playing reading restarts the sentence it
was on. The stop, the clear and the note remain only for a sentence that is not
in the new list at all, because its own section reported different text; that
reload is quiet too, so the page stays under the note. The old list's own Blocks
are kept beside it (`loadedBlocksRef`), since `UtteranceSpan.block` indexes into
them and `blocksRef` has already moved on by the time the new list is adopted.

**"The third sentence" above is out of date (#45, #49).** It says `drain` steps
over a refused Utterance, so that a reading runs out of text with refusals behind
it. Since ADR 0027 `drain` blocks on a refusal instead: it waits for the queue to
empty, stops the reading on that Utterance and reports the refusal. With #49,
`failed` never holds an index behind `nextToEnqueue` either. So a reading no
longer runs out of text with refusals behind the cursor, and the "synthesis
failed" sentence of `outOfTextSentence` is kept as a guard only. The measurements
of 2026-09-20 stand as the record of what happened then.

## Amendment (2026-09-23, #50): the centring waits for epub.js, and the word waits like the Utterance

**Play with the page scrolled away from the reading painted the sentence and
then scrolled away from it.** Measured on the owner's book on 2026-09-23 at
19:28 (`notes/NOTES_2026-09-23.md`). The reading was paused on Block 6.13 and the
page scrolled until section 6 was trimmed. On Play, `follow()` displayed the
Block's CFI, and the section arrived 585 ms later. Inside epub.js's content
hook, `attach()` painted the Utterance and the word and then centred them,
scrolling 725 px. epub.js's own `DefaultViewManager.display` then carried on in
the same task with its `moveTo` to the CFI target, 958 px more. The sentence
ended 724 px above the top of the screen.

The order is epub.js's, read out of the bundle. `IframeView.display` calls
`onDisplayed`, which leads to the content hook, before it resolves the promise
`add()` returned, and the manager's `moveTo` hangs off that promise. The content
hook therefore always runs before the `moveTo` of the same display. The error
equals the Block's own offset in its section. That is why it went unnoticed at
the section boundaries this ADR is about, where the first Block sits at the top
of its section.

**So a section `follow()` asked for is centred on the next frame, through
`settle()`.** `follow()` marks on the Utterance's state which section it asked
for (`state.awaiting`). When that section arrives, `attach()` paints at once,
exactly as before, and hands the centring to a `requestAnimationFrame`. The
`moveTo`, `views.show()` and the rest of that display run in the same task
before the frame. `settle()` then keeps the Utterance in the middle until the
layout has held still for three frames, while `fill()` lays the neighbouring
sections out around it. Measured afterwards: `moveTo` 958 px at +20 ms,
`settle()` −281 px at +29 ms, and the Utterance at y 283..342 of 758. A section
that arrives any other way has no scroll of epub.js's behind it and keeps
`centreOnce`: the manager rebuilding a view, or the owner scrolling back to the
reading. `settle()` would fight such a scroll for up to a second.

**And the word is silent for the same reason as the Utterance.** `play()` in
`engine.ts` corrects straight after it cues, so the first thing to meet a
section on its way was the word. `showWord` reported unconditionally, and the
screen said "Block 6.13 is in section 6, which is not on the page" under a
highlight that was drawn half a second later. One predicate, `awaited()`, now
covers both: every Block known, its section not rendered, and the page following
the reading. It replaces the `coming` flag `showUtterance` took from the `speak`
branch. That flag was always the Utterance's own `follow`, so it could not
disagree with the word.

Three things were weighed and not done:

- **Centring when `rendition.display()` resolves.** That promise is resolved as
  the section's iframe starts loading, not when the section arrives.
  `@epubjs-react-native/core`'s `onShouldStartLoadWithRequest` answers the
  iframe's `about:srcdoc` with a `goToLocation` of it, and `Rendition.display`
  resolves the display in flight whenever another is asked for. Measured: at
  491 ms in the 19:28 run, 94 ms before the section, and 6 ms before it on a
  cached one.
  `displayed` would come only after `fill()`, with the page sitting at the
  Block's top meanwhile.
- **Displaying the section by index, so that epub.js has no `moveTo` to make.**
  If the centring could not run, the page would then land at the top of the
  chapter rather than at the Block.
- **Holding the voice until the page is there**, so that the highlight is drawn
  from the first word spoken after Play. It needs a message from the WebView and
  an engine that waits on the page, which is the dependency ADR 0005 keeps
  pointing the other way. What is left instead is the time a section takes to
  arrive: 17 ms cached, 585 ms in the first run. During it the voice speaks with
  nothing to highlight, the same gap this ADR accepts at every boundary.

The plan posted on #50 also had `follow()` ask for a section only once while it
was on its way. It came out, because the hazard it answered does not exist.
`Views.find` matches only displayed views, so a second display of a section
still loading clears the half-built view and starts again; it never reads the
location of a document that has not loaded. The only signal that could have told
the guard to lift is the promise above.


## Amendment (2026-10-01, #112): away from the screen, and after a clear

`renderAhead` asked for the next section through the manager's queue, and so
waited for what that queue waits for. The owner's phone showed two defects,
one after the other, and the simulator reproduced both
(`notes/NOTES_2026-10-01.md`, 02:52 to 03:25;
`test/manual-test/place-and-following/background-crossing.md`).

- **Away from the screen, nothing is rendered ahead.** epub.js's `Queue.run()`
  runs each task on `requestAnimationFrame`, and a page the app has left draws
  no frames. The request for the next section, and every `display()` that
  `follow()` asked for, waited until the app came back. That happened at 5 of 5
  chapter crossings made with the phone locked. A Reading heard with the phone
  locked therefore stopped at the end of every chapter until the phone was
  unlocked.
- **Coming back could stop the manager's queue for good.** When the voice
  reaches a section whose view epub.js has unloaded, `follow()` asks
  `rendition.display(cfi)`, and `manager.display()` then `clear()`s every view.
  If the manager's queue was displaying the next section at that moment, that
  view was removed half-built. An `IframeView` removed before its iframe loads
  never settles its `display()`: `destroy()` does nothing to a view that is not
  displayed, and the iframe, out of the page with its element, never loads. The
  queue task waiting on that display never ended, and nothing queued after it
  ran, `renderAhead` included. The rendition's queue then waited on the
  manager's, through `fill()`. The reading ran out of text with the note
  promising it would carry on, and nothing could make it.

**Decided:** two guards in the program, `src/renderer/epub-guards.ts`,
installed beside `holdStill`:

- **A display whose view is taken off the page before it finished ends then**
  (`settleRemovedViews`). The manager's `View.prototype.display` returns a
  promise the removal can reject, and `manager.views.destroy`, through which
  `remove()` and `clear()` pass, rejects it with `removed before its display
  finished` for a view that is not displayed. `check()` and `update()` already
  absorb a rejected display. `renderAhead`'s rejection path already forgets the
  section and asks again at the next cue; for this rejection it no longer
  reports a problem, because a clear is a race and not a failure.
- **Both queues tick without frames** (`tickWithoutFrames`). The next task runs
  on the first of a frame and a 100 ms timer (`FRAMELESS_MS`). On the screen the
  frame comes first, as before. Away from it, the timer runs whenever WebKit
  lets the page run.

Measured on the simulator: 5 of 5 crossings away from the screen rendered the
next section 0.1 to 0.2 s after the voice arrived; before the fix, 4 of 4 did
not until the app came back. The race forced on demand now ends in
`rejected: removed before its display finished`, with both queues idle; before,
it ended in `pending`, with the manager's queue `running` for good.

**Not settled here.** A real iPhone suspends the page's process in the
background and wakes it for a median of 7 ms at a time, about 700 times in #112's
17 minutes. The simulator does not. Whether the next section renders while the
phone is locked, rather than only once the voice's own `follow()` display runs,
needs the owner's phone.

**Also affected.** The download Indexer installs the same program, so its
`rendition.display(index)` no longer waits for a frame either.

**Considered and not done:**

- Keeping `follow()`'s display off a busy queue. The display is what brings back
  a section epub.js unloaded, and waiting for an idle queue that itself waits
  for a frame deadlocks away from the screen.
- Rendering two sections ahead. This narrows the window and leaves both defects.
- Preparing the next section's text outside the WebView, which would redraw
  this ADR's whole chain.
