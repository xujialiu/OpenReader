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

## Duo's side controls

On Duo, when the phone places navigation at the side, More actions joins those controls and the name sits near the top of the usable reading area instead of between two horizontal buttons. The same centered letters, second line and whole-word cut remain. It keeps ordinary edge space rather than reserving room for absent buttons. Showing or hiding controls still must not resize the page. This is the agreed exception in #362; the horizontal arrangement below remains on other windows.

## The same letters, on two lines

Both lines are in the phone's own title letters, at the same size and weight
as a one-line title, and centred.

A smaller size for a two-line name was turned down. It would fit more of a long
name, but the title would then change size from one book to the next, and a
name that only just needed a second line would look smaller than a name that
only just fitted on one.

The title grows when the owner makes the phone's text bigger, exactly as far as
the phone's own titles above a page grow, and so do the titles of every other
page in the app: from 17 points up to 21, and no further, however large the
text is made. At 21, two lines still fit above the page. The phone does not
shrink its titles when the text is made smaller, and neither does the app.

At first the title did not grow at all, on the belief that the phone's own
titles did not. Measured, they do (issue #100), so the app's did not match them,
and at the owner's larger text size the titles were the one thing on the
screen that stayed small.

## The page does not move

The strip the title sits in was already tall enough for two lines, so it keeps
its height and the page below it starts where it did. A taller strip for long
names was turned down: the page keeps room for the strip, so every book with a
long name would have started lower on the screen than every book with a short
one.

## Separating the name from the document

The agreed visual direction for #366 is a background in the reading page's own colour that completely hides document lettering behind the name. The background stays within the existing title bar's footprint: no fade, no larger covered area and no extra space above or below it. Text scrolling behind the bar is hidden rather than allowed to compete with the name.

This change applies to horizontal title arrangements. Duo's side-control arrangement keeps its existing page-coloured title background and position; it is not redesigned for this change.

The background comes and goes with the controls without itself moving the document's text or changing the space it is laid out in. The existing rule for putting away the Player while Browsing still holds: the page first returns to the Reading (decision 0050). The two-line title, its size and the phone's own Back and More actions buttons remain unchanged.

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
