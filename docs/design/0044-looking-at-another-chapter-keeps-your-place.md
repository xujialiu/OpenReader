# Looking at another chapter keeps your place

_The engineering half of this decision is
[ADR 0044](../adr/0044-a-paused-contents-row-browses.md)._

While the reading is paused, choosing a chapter in the contents takes the page
there and does nothing else. The sentence you stopped on keeps its highlight,
your saved place stays where it was, and pressing play carries on from that
sentence and brings the page back to it.

## What it replaced

Choosing a chapter used to move the reading as well as the page, whether or not
anything was playing. Paused, that looked like this: the page went to the
chapter, the chapter's title lit up, and the title became the book's saved
place at once. The Library showed it, and the next sync gave it to the desktop.
The next press of play read the chapter you had only opened to look at, and the
sentence you had stopped on was gone. In a book of hundreds of chapters,
finding it again meant searching for it.

That was deliberate. A chapter in the contents was treated like the buttons
that go back and forward a sentence, which move the reading while paused, as
the desktop plugin's do. The owner reported it as a fault, and the owner is
right about what the contents are for while the reading is paused. They are for looking at
another chapter: to check a name, to find a scene again, to see how far the
chapter goes. They are not for choosing a new place to read from.

## What still moves the reading

**While playing, a chapter still moves the reading.** The page follows the
voice, so it cannot stay on a chapter the voice is not reading. Choosing a
chapter while listening means "read this now", as it always has. To only look,
pause first.

**In a book you have never read, the contents still choose where to start.** A
book you have just added has no place to keep. If the contents only looked,
play would read the book from its first line and take the page back there, so
a chapter chosen in a new book is where the first play starts, and the latest
choice wins. It is not saved as the book's place: close the book without
playing and it opens at its beginning again. The book has a place once you
play it, tap a sentence in it, or one arrives from another device.

**Tapping a sentence still moves the reading**, and so do the buttons that go
back and forward a sentence or a paragraph. Those point at a sentence and mean
"read from here". The sentence becomes your place straight away, even before
anything has been read aloud.

## Looking, and coming back

Scrolling the page with a finger was always this kind of looking, and now the
contents are too. While you look, the page stays where you put it. Only four
things bring it back to your sentence: play, the sentence and paragraph
buttons, tapping a sentence, and a place arriving from another of your
devices. Choosing another voice, changing the speed or changing the size of the
text all leave the page on what you are looking at. Before, each of those took
the page back to your sentence without being asked.

To read from the chapter you are looking at, tap its title or any sentence in
it, then press play. That is one tap more than before, and it is the cost of
the change. Opening the contents, choosing a chapter and pressing play is no
longer enough while paused, because play now means "carry on".

The contents still mark the chapter your reading is in, not the one on the
page. The page already shows what you are looking at. The mark answers the one
question the page cannot answer while you look elsewhere: where play will
carry on.

Choosing the chapter your reading is in behaves like any other row. It shows
the top of that chapter, and your sentence may be further down. Getting back to
the sentence itself without playing needs a control of its own. The owner has
asked for one, and it will be built separately.

## What was turned down

**Keeping the old behaviour and explaining it.** The lit title did say
something true, "play starts here". But it said it about a place the owner had
not chosen to read from, and it cost the place they had.

**Moving the reading to the chapter, but lighting nothing until play.** Play
would still have read the chapter the owner only looked at, and nothing on the
screen would have warned them it would.

**Starting at the chapter's first sentence of text instead of its title.** That
was a complaint about which line lit up, not about the place moving. It would
also have meant never hearing a chapter's title.

**Marking the chapter on the page in the contents instead of the reading's.**
It would have been handier for looking through chapter after chapter, because
the list would open where you left off. But it would have stopped answering
"where do I carry on from", and the page already answers "what am I looking
at".

**Saving a chapter chosen in a new book as its place.** Reopening the book
would have landed on that chapter. It was turned down for one rule without an
exception: choosing a chapter in the contents never changes your saved place.

## What it costs

- One more tap to start reading from a chapter you opened while paused.
- The single "jump there and read it" gesture now works only while playing, or
  in a book you have not read yet.
- Until the control above is built, the only ways back to your sentence without
  playing are scrolling to it or tapping it.
