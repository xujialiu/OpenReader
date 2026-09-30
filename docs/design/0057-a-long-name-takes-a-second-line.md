# A long name takes a second line

_The engineering half of this decision is
[ADR 0057](../adr/0057-the-readers-title-is-drawn-by-the-app.md). Issue #85._

## What the owner asked for

Above the page, between the back button and the button for more actions, the
reader shows the name of the book. It used to stop at one line: a longer name
was cut off with three dots, so a book called "The First Legendary Beast Master,
Volume Three: The Long Road Through the Northern Mountains and Beyond" was shown
as "The First Legendary Beast M…". The part that was cut was usually the part that told
two volumes apart.

Now a name that does not fit on one line takes a second, and only a name that
does not fit on two is cut, with the three dots at the end of the second line.
The cut falls after a whole word, "Volume Three: The…" rather than
"Volume Three: The Lo…", as it does in the Library (decision 0060). A name that
fits on one line looks exactly as before.

## The same letters, on two lines

Both lines are in the phone's own title letters, at the same size and weight
as a one-line title, and centred.

A smaller size for a two-line name was turned down. It would fit more of a long
name, but the title would then change size from one book to the next, and a
name that only just needed a second line would look smaller than a name that
only just fitted on one.

The title does not grow when the owner makes the phone's text bigger, because
the phone's own titles above a page do not either. At a bigger size two lines
would not fit above the page.

## The page does not move

The strip the title sits in was already tall enough for two lines, so it keeps
its height and the page below it starts where it did. A taller strip for long
names was turned down: the page keeps room for the strip, so every book with a
long name would have started lower on the screen than every book with a short
one.

## What it costs

The phone draws its own titles on one line only, and there is no way to ask it
for two. So this title is the one part of the strip the app draws itself,
copied from the phone's own (decision 0042, second step), and measured against
it: how big its letters are, and how close to the two buttons it may come. When
the phone's look changes, the back button and the button for more actions
change with it, and the title does not until someone measures it again.

The space it may take is a little narrower than the phone's own title's. The
phone lets a long title drift towards the narrower of the two buttons to gain a
few points; this title stays centred, so it keeps clear of the wider button on
both sides.
