# A long name in the Library ends before its button

_Issue #87. A product decision only: it has no ADR._

## What the owner asked for

In the Library, each book's row has a `…` button at its right end, which opens
the book's actions. A name long enough to take two lines ran under it. The
button was drawn over the letters, and the three dots at the end of the cut
name sat on the button's own three dots.

Now the name, and the line under it that says how far the reading got, end
before the button, with a small gap. A name that fits on one line looks as it
did.

## Where a long name is cut

A name that does not fit on two lines is cut after a whole word:
"Master, Volume Three: The…", not "Master, Volume Three: The Lo…". A comma,
colon or dash that would be left in front of the three dots goes too.

Two kinds of name are still cut after a letter, the way the phone cuts: a
single word longer than the line, and a name in a language written without
spaces between words, such as Chinese, where a cut after any character is
already a cut between words.

VoiceOver still reads the whole name.

The name above the page in the reader is cut the same way.

## Straight on the left, uneven on the right

The name is set flush left, as the phone's own lists set theirs. Justified
text, with both edges straight, was tried and turned down. To fill a line of
three or four words, the phone spaced out the letters inside the words as well
as the gaps between them, so "Legendary" on the first line looked stretched
next to the second line.

## The button stays where it was

Moving the `…` to the bottom right corner, beside the progress line, was turned
down. The name would have kept the whole width, but the row would have looked
different from before, and the owner kept it as it was.

## What it costs

- **Less room for every name.** The words are about a ninth narrower. Some
  names that just fitted on one line now take two, and some that fitted on two
  are now cut.
- **The app cuts the name itself.** The phone can only cut after a letter, so
  the app lays each long name out again, unseen, to learn where its lines
  break, and then once for each cut it tries, keeping as many words as the
  three dots leave room for. The first time a row is drawn, and after a
  rename, the phone's own cut can show for an instant before the app's
  replaces it.
