# The page follows the voice

As the app speaks, the words light up as they are said and the text moves itself so
that the sentence being spoken sits in the middle of the screen. The owner never
touches the screen to keep up.

_Since [design 0050](0050-the-page-follows-the-line-being-spoken.md) it is the
**line** being spoken that is held there, and the page moves up a line at a time,
smoothly, rather than jumping once a sentence. Where this file says the sentence
is held in the middle, read the line._

The reader scrolls, continuously, the way a long web page scrolls. It does not turn
pages.

## Who this serves

The owner reads long Chinese web novels — hundreds of chapters in one file — and
reads them by listening, with the text in front of them rather than in front of
their attention. For that reader, following along means the eyes rest in one place
and the text comes to them.

A page turn breaks that. Even when the app turns the page itself, the whole screen
is replaced at once and the eye has to go back to the top and find the line again.
At a few hundred words a page that is an interruption every minute or two, for
hours. Continuous scrolling, with the spoken sentence held in the middle of the
screen, is what following along actually means to someone who is listening rather
than reading.

## What turning pages would have felt like

Pages are what this kind of reader does by default, and for someone reading with
their eyes they are the right choice: a page is a stable thing to look at, and
turning it is a deliberate act.

Under it the owner would have watched the highlight walk down a still page, reach
the bottom, and then be thrown back to the top of a screen that had changed
completely underneath them. Nothing would have been broken. It would simply have
felt like being handed a book that closes and reopens itself every minute, which is
the opposite of the thing being sold.

## What the better-maintained alternative would have cost the owner

There was a more actively maintained way to display these documents, and it was
turned down. Two things the owner would have lost.

**The highlight would not have moved on its own.** That technology can only mark
text the reader has selected with a finger. A voice cursor has no finger; it moves
by itself, several times a second. So the owner would have had either no highlight
at all — listening with the text sitting there, inert, giving no clue where the
voice had got to — or the absurdity of dragging it along by hand.

**Their place would have stopped matching their computer.** The way this app
describes where the owner stopped reading is the way their desktop plugin already
describes it, because both are built on the same underlying reader. Switching would
have meant the two describing places in different dialects, so a novel left at
chapter forty on the phone would open somewhere else on the computer. That is the
promise the whole project rests on, and no amount of better maintenance buys it
back.

## What this costs

**The thing doing the displaying is old.** It has not had a proper release in
years. That is accepted with open eyes, because the well-kept alternative failed the
one requirement that matters here and being well-kept does not help with that.

**Continuous scrolling keeps more of the document in play at once.** Turning pages
lets the app forget the page it just left; scrolling does not, so more of the book is
being held at any moment and a phone has a finite amount of room to hold it in. That
was measured on one of the owner's own novels — thousands of chapters in a single
very large file — rather than estimated, and it came back cheap: the app holds three
chapters at a time and lets the rest go, and half an hour of reading moved the
memory it uses by a few percent. What does grow is something else, and it is not
caused by scrolling: the app keeps every chapter's text it has ever seen and re-reads
all of it each time a new chapter appears. Page-turning does the same, only more
slowly, because it reaches new chapters later.

**The word-by-word highlight has now been proved under this layout.** It was made to
work, and the reasons it had not worked were found and fixed, under page-turning; and
because continuous scrolling changes the thing it was proved against, the whole of
that was run again on the owner's own book. The word lights up as it is spoken, the
sentence being read sits in the middle of the screen to within the width of a hair,
and both of the two reasons the highlight had once painted nothing were reproduced
deliberately and confirmed still to be the reasons.

**Opening that very large book used to show an empty page, and the reason was
found.** It happened two opens out of three. Nothing was lost — pressing play, or
moving anywhere in the book, brought it back — but the first thing the owner saw
could be nothing at all. It was recorded here as unexplained rather than guessed
at, and it is explained and fixed in the section below.

*The engineering half of this decision is [ADR 0011](../adr/0011-epub-renders-in-a-webview-via-epubjs.md).*

## Sometimes a book opened to an empty page, and now it does not

For a while, opening a book — usually the owner's long novel, occasionally a tiny
test one — sometimes gave an empty page. Not an error, not a crash: a white screen,
with the strip along the bottom cheerfully reporting how many sentences were ready
to be read. Going anywhere in the book brought it straight back, so nothing was lost
except the trust that opening a book works.

The cause turned out to be a moment no one thinks about. When a book is opened, the
screen settles into its final shape a beat after the words start being laid out —
the title bar at the top arrives late and everything below it shifts. The part of
the app that lays out the book throws the whole page away whenever the space it has
changes, and rebuilds it from wherever the reader was. If the shape changes before
it has worked out where the reader is, it throws the page away and has nowhere to
rebuild from, so it rebuilds nothing.

It is rare because it is a race: on a short book the reading position is worked out
long before the screen settles, and on a two-thousand-chapter one it often is not.

**The fix is to rebuild the page ourselves in that one case**, rather than to stop
the screen from settling. Stopping this particular shift would have left the next
one — turning the phone, or any future thing that changes how much room the book
has — to find the same hole. The page has to survive all of them.

The cost is small and worth naming: when the page does have to be rebuilt this way,
you are put back at the **top of the chapter you were in** rather than at the exact
line. Nothing that knew the exact line still exists at that moment. If something is
being read aloud, the next sentence puts you back precisely; if not, you are a
little above where you were, in a book you can see, which is the whole of what
changed.
