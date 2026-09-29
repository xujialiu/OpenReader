# The space at the sides of the page is yours

_The engineering half of this decision is
[ADR 0056](../adr/0056-margins-replace-the-renderers-twelfth.md). Issue #84.
It adds a fourth row to the panel [design 0021](0021-changing-how-the-page-looks.md)
describes; everything that file says about the panel rising over the page and
about keeping the sentence in view stands._

## What the owner asked for

Every book used to be shown with an empty strip down each side of the page, a
twelfth of the screen's width: about a third of an inch on each side of an
iPhone. The owner found it too wide and had no way to change it. The book did
not ask for it; the reader put it there.

The panel that changes how the page looks now has a row called **Margins**,
between Font Size and Alignment. It works the way Font Size does: a minus, the
number, and a plus. Each tap moves both sides of the text by four points, from
8 to 48, and a button goes grey at the end it cannot pass. Every book starts at
16, about half of what it was, which is also how far the phone keeps its own
back button from the edge of the screen.

## The same number of points on every screen

The old strip was a share of the screen's width, so it grew on a bigger
screen. The Margins are a number of points instead, and 16 is 16 on a phone and
on a tablet.

The share was turned down because the owner judges this by looking at the page
on their phone, and a number that means the same distance everywhere is easier
to judge than one that means a different distance on each screen. What it costs:
on a tablet the lines are much longer than on a phone at the same setting, and
the owner has to set a wider margin there to get a comfortable line length. It
is one setting for every device, so a tablet and a phone cannot keep two
different margins.

## A stepper and a number, like Font Size

Two other controls were turned down:

- **Named widths in a menu**, such as Narrow, Medium and Wide, as Alignment has.
  Quicker to choose, but three or four widths are too coarse for something the
  owner wants to set to exactly what looks right.
- **A slider**, as some reading apps have. Fine-grained, but it says nothing
  about how far it moved, and it is easy to nudge when reaching for the row
  below.

The stepper shows the number because it is the one thing the page behind the
panel cannot show: how far the last tap moved it. The page itself shows the
rest.

## The owner's, in every book

Like the size and the alignment, the Margins belong to the owner rather than to
a book: one choice applies to every book, it is kept on this device when the
app is closed, and it does not travel to the owner's other devices.

A book's own margin around its whole text does not add to the owner's. A book
that indents part of its text, such as a quotation or a list, keeps that
indent on top of the owner's margin, so it still stands out from the paragraphs
around it.

## Changing it does not move your place

Changing the Margins moves every line in the book, as changing the size does,
and it is handled the same way: the sentence being read stays where it was on
the screen, the place in the book does not change, and a reading that is
playing goes on playing.
