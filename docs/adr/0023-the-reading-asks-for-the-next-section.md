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
only when its caller is about to bring the section on to the page. A Block nobody
reported, and a Block the rendered section no longer holds, are still reported;
`attach` asks without the flag, because a section that has arrived and still
cannot be highlighted is the real thing.

## What it cost

Measured on the fixture and on the owner's 2,077-section book; the figures are in
`notes/NOTES_2026-09-20.md` at 05:03, 05:09, 05:13, 05:16, 05:19, 05:31 and 05:53,
and the memory table is checked against ADR 0011's own.
