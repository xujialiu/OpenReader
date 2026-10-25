# A tap on the page can be locked

_The engineering half of this decision is
[ADR 0087](../adr/0087-the-tap-lock-is-one-flag-in-the-page.md). Issue #325.
It adds to "Tapping a sentence reads from there" and "A link in the book moves
the page, and nothing else" in
[decision 0020](0020-the-player-and-knowing-where-you-are.md)._

## What changed

The player has a new row at its very bottom. At its left end, under the
contents button, is a padlock. Open and drawn like the player's other buttons,
it changes nothing. One tap closes it and draws it in the colour of the app's
checks, the colour the owner chose for the spoken word; the next tap opens it
again. Nothing asks for confirmation.

While it is closed, a tap on the page does nothing:

- **A tap on the words does not move the reading**, whether the book is being
  read or is paused. Paused, it does not change where Play starts either.
- **A tap on a link in the book does not take the page away.** The page stays
  where it is, and the reading does not move.
- **The same holds with the player folded away** to its one round button,
  where a tap on the words would otherwise read from there.

Two things still work, because neither is a tap:

- **Dragging the page** to look further on or back. The reading stays where it
  is, as it always has, and the M beside the voice's name brings the page back.
- **Pressing on a word to look it up** or to translate a passage. Looking up
  has its own switch in Settings for anyone who wants it off.

The lock stays closed until the owner opens it, across books and after the app
is closed, on this phone only. It is never sent to the owner's other devices.

## Who it is for

The owner listens with the phone in hand, in bed or on the move. A tap on the
words is how the reading is pointed at a sentence, and a stray tap is
indistinguishable from a meant one: the voice jumps to wherever a thumb
brushed, and the sentence that was being read has to be found again by hand.
Paused, a stray tap silently changes where Play will start. Decision 0020 made
the blank space between paragraphs do nothing for this reason; the lock does
the same for the words, when the owner says so.

## What it costs

- **The player is a little taller while it is open.** The sleep timer shares
  the new row ([decision 0088](0088-the-reading-can-pause-by-itself.md)), and
  the owner chose a row at the bottom over squeezing both buttons into the
  rows already there. The first version simply added the row, and the player
  grew by about a line and a half of the book; the owner found it covered too
  much.
  So the row sits low, on the line just above the phone's home bar, and all
  three rows stand closer together, with the same room for a finger on each
  button. On the owner's phone the open player is now taller than before the
  row by about a third of a line of the book.
- **With the player folded away, a locked tap does nothing and nothing says
  why.** The round button left on the page shows only whether the book is
  being read. To see the lock, the owner opens the player.
- **Locked, the only way to point the reading at a sentence is the player**:
  the sentence and paragraph buttons, and the contents.

## Turned down

- **Locking the whole page**, dragging and looking up included, as the folded
  player already stops dragging. A drag or a press on a word is deliberate in a
  way a brushed tap is not, and the owner wanted to keep reading ahead and
  looking words up while listening.
- **Locking only the words, and still following links.** A tap on a link is a
  tap, and a link followed by accident takes the page somewhere else just as
  surely. A lock that lets some taps through is not one.
- **A mark on the folded player's round button, or a flash where a locked tap
  lands.** The lock is said once, by the padlock. The round button says one
  thing, whether the book is being read, and a flash would be a second way of
  saying what the padlock already says.
- **Moving the lock and the moon in from the screen's rounded corners** so that
  the row could go lower. At the height chosen, the corner's curve is still
  about twenty points from either of them, so moving them would only have
  taken them out of line with the contents button and the speed above.
- **The row lower still, into the band of the phone's home bar.** It would
  save a few more points, but that band is where the phone's own swipe home
  begins, and the phone's own buttons keep above it.
- **Opening the lock again when the book is closed.** It would be safer for an
  owner who forgets it is on, but the padlock is in plain sight whenever the
  player is open, and a lock the owner has to close again every evening is one
  they would stop using.
