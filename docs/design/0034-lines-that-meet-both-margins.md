# Lines that meet both margins, in every book

_The engineering half of this decision is
[ADR 0034](../adr/0034-text-alignment-passes-over-what-the-document-placed.md).
It adds a third row to the panel [design 0021](0021-changing-how-the-page-looks.md)
describes; everything that file says about the font, about the panel rising
over the page and about keeping the sentence in view stands._

## What the owner asked for

The panel that changes how the page looks has a third row, **Alignment**, under
the size. Tapping it offers two choices, **Left** and **Justify**, and every
book starts on Justify.

Left sets each line against the left margin and leaves the rest of the line
empty, so the right edge of a paragraph is ragged. Justify spreads that space
across the gaps between the words, so both edges are straight.

## Justified from the first page, in every book

The font starts on whatever the book asked for. The alignment does not: every
book is justified until the owner chooses Left, and then every book is set
left.

That is the owner's choice, and it gives something up. A book whose publisher
set its paragraphs ragged on purpose is shown justified, and there is no third
choice that puts the publisher's lines back. None was asked for. Books set their
ordinary paragraphs one of these two ways, and the owner has said which one
they want to read; a third choice would only matter for the book whose
publisher disagreed with the owner.

Like the font and the size, the choice belongs to the owner rather than to a
book. One choice applies to every book, it is kept on this device when the app
is closed, and it does not travel to the owner's other devices.

## Only the paragraphs move

What follows the choice is the text a book is mostly made of: its paragraphs,
its list items, the words in its tables.

What does not is everything the book placed on purpose: its headings, and any
line it centres or pushes to the right. Chapter titles, the three stars between
two scenes, a centred verse, the signature at the end of a letter and a column
of numbers all stay exactly where the book put them, under either choice.

This matters most under Justify, which is where it would otherwise go wrong in
the most visible place. The last line of a justified paragraph is set against
the left margin, and a one-line title is its own last line. If Justify reached
the titles, every centred chapter title in every book would jump to the left
margin, on the first page of every chapter.

Two alternatives were turned down:

- **Everything follows the choice.** Every centred title moves to the left
  margin, for the reason above.
- **Paragraphs follow, headings do not.** Many readers do this. It keeps the
  titles, but a book very often centres a paragraph too: the stars between two
  scenes, a line of verse, an inscription. Each of those would move to the left
  margin.

What is kept is a limit worth knowing about: a book that centres all of its
text, as some collections of poetry do, looks the same under either choice.
And a heading the book set against the left margin keeps that too; only the
paragraphs change.

On the owner's own novel, the title page, the chapter titles and the chapter
numbers stayed centred under both choices, while its paragraphs changed.

## Switching does not move your place

Justifying a line spreads the space inside it. It does not change which words
are on the line, so no line moves up or down when the owner switches. Measured
on the owner's novel and on a book built to test this, every chapter was
exactly the same height under both choices: the sentence being read stays
where it is, and the highlight stays on the same words.

## Chinese books change less

Chinese is set in characters of one width, so most lines of a Chinese paragraph
already meet both margins. The difference shows only on a line that ends with
punctuation, a number or an English word. The owner will see less change in
the novel than in an English book.

## Not included: breaking words at the ends of lines

On a narrow phone at a large size, justified English can leave wide gaps
between the words of a line. Breaking long words at the end of a line, with a
hyphen, would narrow those gaps. It was left out: it changes where lines break,
puts hyphens into the text, and the owner declined it.
