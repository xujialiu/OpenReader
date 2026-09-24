# A fast scroll never skips text

_The engineering half of this decision is
[ADR 0045](../adr/0045-nothing-above-the-page-changes-while-it-moves.md)._

Flicking quickly through a document, the text slides the whole way. It never
jumps ahead or back by a chapter, and the page is never empty where there is
text to show. The one thing that waits: flicking backwards through several
chapters without a pause, the page stops at the top of each chapter until the
chapter before it is ready.

## What it replaced

The app does not prepare a whole document at once. It keeps a few chapters
around the one on screen, adds the next as you approach it and removes the ones
far behind. Each time it adds or removes a chapter above the text you are
looking at, everything below moves by that chapter's length, so it has to move
the page back by exactly that much, and the text on screen stays where it was.

The phone ignores that correction while it is moving the page itself: under
your finger, as the page coasts after a flick, and as it bounces at an end. So
as soon as a flick carried you past the text the app had prepared, which is the
end of the scroll bar, the text jumped by a whole chapter. Going forward, the
page went empty for a moment and came back four to seven screens further on,
past text you never saw. Going back, it could land a dozen chapters further back
than you had flicked, and stay empty for half a second at a time. Browsing a
long document by flicking, the ordinary way to look for a scene, lost your
place.

## What was chosen

Nothing above the text you are looking at is added or removed while the page is
moving. It waits until the page has been still for a fifth of a second, and then
the correction is kept, so you see nothing happen.

Going forward, that costs nothing. The chapters you have flicked past stay, as
empty space of the right length, until the page stops, and are removed then.
The next chapter is added below as before, which needs no correction at all.

Going back, the chapter before is added only once the page has stopped. A flick
that reaches the top of the text prepared so far bounces there, the way it does
at the top of a document, and about a quarter of a second after the page is
still, the chapter before is there and the next flick goes on into it. With a
second or so between flicks, the page goes back about as far as the same flicks
carry it forward; flicking back without a pause, it waits at the top of each
chapter.

## What was turned down

**Keep the page moving into the chapter before while it is being prepared.**
Backward flicks would never stop, but for as long as the chapter took to
appear, you would be flicking through an empty page: the very thing that was
reported.

**Stop the page dead whenever a chapter has to be added or removed.** Going
back it would stop a little earlier than a bounce does; going forward, every
flick would stop at every chapter it crossed, where waiting costs nothing.

**Never remove the chapters behind you.** Nothing would need correcting going
forward, but a long session would keep every chapter it had passed, and a whole
document can hold hundreds of them.

## Who it is for

Anyone moving through a long document by flicking: skimming ahead to see where
a chapter goes, or back to find a scene. Reading along with the voice moves the
page a sentence at a time, and it rests in between, so nothing there waits.
