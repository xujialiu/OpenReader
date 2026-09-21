# One size for every Document

_The engineering half of this decision is
[ADR 0030](../adr/0030-font-size-is-the-owners-and-scales-everything.md). It
revises the size half of
[design 0021](0021-changing-how-the-page-looks.md); the font half stands._

## What the owner saw

Tapping + made the text look much bigger than expected, and nothing on the
sheet said how much one tap had changed or which step the text was now on.
The steps also grew as they went up: a tenth at first, then more, then a
quarter at a time. And every Document started at whatever size its publisher
had chosen, so two Documents set differently never looked the same, whatever
the row said.

## One size, chosen by the owner, for every Document

The row now sets how big the body text is in **every** Document, and a
Document's own size is never used. It starts at 16, which is the size every
Document the owner has already shows, so nothing on the page changes until the
row is touched. The choice is kept on this device when the app is closed, and
it works the same on an iPad as on an iPhone.

Everything else in a Document keeps its proportion to the body text. Headings
stay larger than it and notes stay smaller than it, and that includes the small
print that used to stay the same size whatever the row said: the chapter numbers
in the owner's own novel now grow with the text around them.

## One step at a time, and the step is on the screen

From 12 to 24 each tap changes the size by one; above 24, by two, up to 32.
Near the sizes people actually read at, one is the smallest change that can be
seen; above 24 a change of one barely shows, and reaching the largest size one
at a time would take a dozen taps.

The number now sits between − and +. How far a tap moved the text is on the
screen instead of guessed, and it answers the question that started this
without anyone having to ask it.

## How the app knows which text is the body text

It is the size most of a Document's text is set in. That is worked out once per
Document, from the first pages with enough text on them — more than a title
page or a page of small print in front of the first chapter holds — and then
remembered for that Document. A title page decides nothing, because it is one
large line and a little small print. An appendix printed smaller than the
chapters stays smaller than them, because the Document was judged by its
chapters.

Working it out is a small fraction of what drawing a page costs, so it never
makes the reader pause. Until it is known, a Document is shown as if its body
text were the usual size, which it is for every Document the owner has today. A
Document that does set its own size redraws once, the first time it is opened,
and never again. One with too little text to judge is shown at the usual size
throughout.

## What was given up

**The publisher's size as the starting point.** Design 0021 argued that a
Document is made by someone and should be shown as it asks until the owner says
otherwise. That still holds for the typeface: every Document still starts in its
own. For the size, the owner chose one size everywhere. A Document designed with
deliberately large or small type is shown at the owner's size anyway.

**A size that is a proportion of each Document's own.** That kept each
Document's own character, but two Documents set differently would never match
at any setting, and moving between them would mean adjusting again. That is the
problem design 0021 raised against a separate setting for each Document: the
tenth one opening at a size the owner has already turned down nine times.

## What was turned down

**Deciding the body text page by page.** A title page would have had its title
shrunk to the body text's size, and a smaller appendix enlarged to match the
chapters.

**Reading the whole Document when it opens, to decide exactly.** The work grows
with the Document. The owner's novel has two thousand chapters, and the owner
ruled out anything that could make the reader freeze to find a number.

**Enlarging the whole page, pictures and margins included.** It was the first
way tried to make the size work on an iPad. On an iPad it still left the text
the same size; on an iPhone it widened the margins as the text grew, until the
column of text narrowed noticeably. Making the iPad's reader behave like the
iPhone's was what worked.

**Keeping the line that put a Document back to its own appearance.** The owner
had never noticed it was there. The font list already offers the Document's own
typeface, and with the number showing, the starting size is visible when the
text is back at it.

**Carrying over a size chosen under the old scheme.** The app has not been
released, so every install simply starts at 16.
