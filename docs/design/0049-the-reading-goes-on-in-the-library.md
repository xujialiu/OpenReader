# The reading goes on in the Library

_The engineering half of this decision is
[ADR 0049](../adr/0049-the-reading-is-held-above-the-navigator-and-moved.md).
Issue #68. It revises "Back goes to the shelf; the reading stops" in
[decision 0019](0019-four-screens-and-a-way-back.md)._

## What changed

Going back from a book to the Library while it is being read no longer stops
the voice. It goes on, and the lock screen and headphones go on controlling it.
The same round button the collapsed player leaves behind
([decision 0048](0048-collapsing-leaves-the-page-and-one-button.md)) appears at
the bottom right of the Library, in the same place, with the same moving
waveform. Pressing it goes back into the book exactly as it was left: the
player shown or folded away as it was, and the page at the sentence being
spoken. Tapping the book's own row in the list does the same. Neither ever
starts or stops the voice.

Swiping in from the left edge counts as going back, as it always has, whether
or not the controls are showing.

The button stays for as long as the reading is held, even after it stops: a
pause from the lock screen or headphones, the end of the book, or a failure,
which the book then shows when the owner goes back into it. The list leaves
room at its bottom while the button is there, so the last book can be scrolled
clear of it.

## When the reading ends

The reading ends in three ways, and in each one the place is kept, as it always
has been:

- **Going back while it is paused.** Nothing is being heard, so there is
  nothing to keep going. No button appears, as before.
- **Opening another book.** One book is read at a time, so the one being read
  ends first and the other opens.
- **Deleting the book being read.** It ends before its saved audio is removed.

The button appears in the Library only. The settings pages under it do not
carry it; going back to the Library shows it again.

## Who it is for

The owner listens to long books for long stretches. Until now, looking at the
Library at all, to see how far another book had got or to manage the downloads
of one, meant stopping the voice and starting it again afterwards.

## What it costs

**The book stays in memory while it is being read in the Library.** On the
owner's longer books that is about 85 megabytes, which is given back as soon
as the reading ends. It is the cost of the reading going on at all: the page
the voice is reading from is also what prepares the next chapter, so it cannot
be put away while the voice continues.

**Two taps to stop from the Library.** The button there never pauses, so
stopping the voice from the Library is the button and then the player's Pause,
or the lock screen's own Pause, which works from anywhere.

## What was turned down

**Stop the reading when the owner leaves the book, as before.** That is the
problem this solves.

**A bar across the bottom of the Library with the book's name and its own
Pause**, the way music apps do it. It would say which book is playing, which the
owner already knows because they have just left it, and it would take a row of
the list on every visit. The owner asked for the button they already know from
the collapsed player, in the same place.

**Carry the reading on in a second, hidden copy of the book** and let the owner
open another book alongside it. Two long books open at once would double the
memory above, and the one being heard would have to be put away the moment the
other one is played.

**Keep only the voice going and put the page away.** The voice would stop at
the end of the chapter, because the page is what prepares the next one.
