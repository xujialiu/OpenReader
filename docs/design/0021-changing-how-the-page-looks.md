# Changing how the page looks, without losing your place in it

_The engineering half of this decision is
[ADR 0021](../adr/0021-appearance-is-one-stylesheet-the-page-already-has.md)._

The reader's header has always had a control on the right for how the page
looks, and until now it opened onto an admission that there was nothing there
yet. It now holds two things: which font the book is shown in, and how big the
text is.

## Both start at "the document's own"

A book is made by someone. Its publisher chose a face and a size and, in a book
that was made with care, chose them for that book. So neither row starts on a
value of ours: both start on **the document's own**, and the book is shown
exactly as it asks to be shown until the owner says otherwise.

That is a choice with a cost, and the cost is the first impression. A reader
that picks a comfortable size for you out of the box looks better on the first
book you open — and it also silently overrules a designer on every book after
that, including the ones where it was worth keeping. The owner is one person
with one pair of eyes who will set this once; making them set it once is a
smaller price than never showing them what the book actually looks like.

It is also why "the document's own" is a **choice sitting in the row** rather
than a reset button somewhere else. It is the state both rows start in, so it
has to be visible as the thing currently chosen. A reset is a verb you have to
know to look for.

## A size is a percentage, not a number of points

The size row offers "a quarter bigger", "half again", "twice" — not "eighteen
points". What the owner is saying is *bigger than this book set it*, and that
sentence only makes sense against what the book set. A book that was typeset
small and a book that was typeset large both become comfortable at the same
percentage and would need two different point sizes.

The consequence is stated rather than hidden: a book that fixes the size of its
own paragraphs in a way that cannot be scaled from outside will not move. Neither
of the two books this was built against does that, and if one turns up the row
will do nothing on it — which is a thing to fix then, not to pretend about now.

There is no "100%" in the row. It would be a second way of saying "the
document's own": something that looks like a choice and changes nothing, which
the project's own rule says to remove rather than ship.

## The setting belongs to the owner, not to the book

Which voice reads a book belongs to that book. How big the text is does not: it
belongs to the owner's eyes, and their eyes do not change between books. So a
change made while reading one book applies to every book.

The alternative — per book — was turned down because of what it feels like on
the tenth book: every new book opens at a size the owner has already rejected
nine times, and there is no way to say "this, always" except by saying it again.

Nothing is remembered when the app is closed, which is true of every setting in
the app today and is said on the sheet itself rather than left to be discovered.

## Why it rises over the page instead of replacing it

A size is judged by looking at the text, so covering the text defeats the
judging. The panel slides up over the bottom of the page and the book stays on
screen above it, at whatever size has just been chosen. Nothing has to be
confirmed: the page changes as the choice is tapped, and the button at the
bottom is there to get out of the way rather than to apply anything.

## What happens to the sentence being read

Changing the size of every word in a book moves every line in it. If the app did
nothing about that, the sentence being spoken would slide off the screen the
moment the owner made it bigger — and it would slide *further* the bigger the
book, so the change would be least usable in exactly the book that needed it.

So after a change the page is brought back to the sentence being read, the same
way it is brought there when a new sentence starts. Measured on the owner's own
novel, the sentence stays within a pixel of the middle of the visible text
across a change that makes the book nearly three times taller. Without it, that
same change left the sentence more than two screens below where it could be
seen.
