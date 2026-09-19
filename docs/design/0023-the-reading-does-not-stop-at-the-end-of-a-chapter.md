# The reading does not stop at the end of a chapter

The app reads a book aloud for hours without being watched. Until now it would
quietly stop — somewhere around the end of the first chapter or two — and give no
sign at all. The play button still said it was playing, the sentence stayed lit
where the voice had left it, and nothing happened again, ever.

On the owner's own book that meant about a hundred sentences of a two-thousand
chapter novel, and then silence. For an app whose one job is to read a long book
aloud, that is the worst failure it has.

It is fixed. The reading now walks from the first chapter to the last without
anyone touching the screen, and when it genuinely reaches the end of the book it
says so and stops.

## What was going wrong, in the terms of someone using it

The page shows the chapter you are on and a little of what is around it — enough
to scroll through, not the whole book, because a whole book of this size would not
fit. More of the book gets laid out as you scroll towards it.

While the app reads to you, the only thing that scrolls the page is the app
itself, moving the sentence being spoken into the middle of the screen. So the
page only ever scrolled as far as the last sentence it had. On a chapter that ends
well above the bottom of its own page — a chapter that is mostly a picture, a
volume title page, a chapter followed by a lot of blank space — the reading ran
out of sentences while the page was nowhere near the bottom, and so nothing ever
asked for the next chapter. The app was waiting to be scrolled, and the only
thing that would have scrolled it was the reading it had just run out of.

## What was chosen

**The reading asks for what it is about to read.** When the voice arrives in the
last chapter the app has laid out, the app lays out the next one — because the
reading needs it, not because anything was scrolled. It asks for one chapter, once
each, and only the one immediately after the voice.

**And the app says when there is nothing left.** If the reading ever does run out
of text it now says so on the player instead of sitting silent, and it starts
again by itself the moment more of the book arrives. When what it has run out of
is the book itself, it says *that* — "that was the last of this document" — and
stops.

Those two sentences are deliberately different. Telling someone they have reached
the end of the book when two thousand chapters are still ahead of them would be a
worse lie than the silence it replaces.

## What was turned down

**Laying out the whole book in advance.** It would remove the problem completely
and it would also make the app unusable on the book it exists for: the owner's
novel is two thousand chapters, and keeping them all laid out at once is the one
thing the app is careful never to do. It keeps three chapters laid out and puts
the rest away, which is what lets a two-thousand-chapter book take no more of the
phone than a short one and stay that way across an hour of reading. Trading this
defect for that one would be a bad trade, and the fix keeps the three-chapter
limit exactly as it was: the chapter that gets laid out ahead is allowed to be
put away again straight afterwards, because what the reading needs from it is its
*words*, and those are kept.

**Jumping the page forward a chapter whenever the reading gets close to the end.**
This is what the app does when the reading genuinely crosses into a chapter that
is no longer on screen, and it is right there — the reader is going there anyway.
Doing it *early*, before the voice has arrived, would move the page out from under
someone who was still reading with their eyes.

**Stopping and asking.** A reader listening with the screen off, or in a pocket,
cannot answer a question. An app that reads a book aloud must get to the end of
the book.

## What it costs

At a chapter boundary on a book with a lot of empty space in it, the page now
jumps to the new chapter rather than sliding into it, because the chapter it is
jumping to was put away again to keep the memory flat. On an ordinary book, where
the text fills the page, nothing changes: the page slides on as it always did and
the new mechanism never has to do anything.
