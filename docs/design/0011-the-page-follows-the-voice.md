# The page follows the voice

As the app speaks, the words light up as they are said and the text moves itself so
that the sentence being spoken sits in the middle of the screen. The owner never
touches the screen to keep up.

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

**Opening that very large book sometimes shows an empty page.** Two opens out of
three; the third was fine. Nothing is lost — pressing play, or moving to anywhere in
the book, brings it back and reading works normally from then on — but the first
thing the owner sees can be nothing at all, and why is not yet understood. It is
recorded as unexplained rather than guessed at.

*The engineering half of this decision is [ADR 0011](../adr/0011-epub-renders-in-a-webview-via-epubjs.md).*
