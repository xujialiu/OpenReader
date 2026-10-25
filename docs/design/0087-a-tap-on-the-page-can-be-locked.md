# A tap on the page can be locked

_The engineering half of this decision is
[ADR 0087](../adr/0087-the-tap-lock-is-one-flag-in-the-page.md). Issue #325.
It adds to "Tapping a sentence reads from there" and "A link in the book moves
the page, and nothing else" in
[decision 0020](0020-the-player-and-knowing-where-you-are.md)._

## What changed

The player's top row has a padlock, just right of the A that says whether the
page is following the reading. Open and drawn like the player's other buttons,
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

- **The player changed shape to make room.** The padlock and the sleep timer's
  moon ([decision 0088](0088-the-reading-can-pause-by-itself.md)) first had a
  row of their own at the bottom of the player, and the player grew by about a
  line and a half of the book. The owner found it covered too much, and its
  bottom row sat in the phone's rounded corners, just above the home bar,
  where a thumb reaching for the lock could brush the bar instead. So the
  player is now a card, after the owner's other reading app, Speechify: a
  little in from the sides of the screen, rounded at every corner, and lifted
  clear of the home bar, with the page showing around it. The padlock sits
  beside the A and the moon beside the arrow that folds the player away, so
  the card has two rows instead of three. On the owner's phone the open
  player and the strip under it take less of the page than the player did
  before either button existed.
- **The voice's name has less room.** Between the two pairs of buttons it has
  room for about twenty letters on the narrower phones; a longer name goes on
  to a second line and the card grows by that line. At the largest text sizes
  the name has a row of its own, as it already did.
- **A strip of the page shows under the card.** Part of a line of the book
  can be seen in the gap between the card and the home bar. No sentence is
  read there: the line being spoken is held above the card.
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
- **A row of its own at the bottom of the player**, the first version. It made
  the player a line and a half taller, and it put the padlock and the moon in
  the screen's rounded corners beside the home bar. Making that row shorter
  and lower only moved the buttons further into the corner and closer to the
  bar.
- **The player across the full width, down to the bottom of the screen**, as
  it was. It is what let its buttons reach the home bar. As a card it keeps
  every button clear of it.
- **Opening the lock again when the book is closed.** It would be safer for an
  owner who forgets it is on, but the padlock is in plain sight whenever the
  player is open, and a lock the owner has to close again every evening is one
  they would stop using.
