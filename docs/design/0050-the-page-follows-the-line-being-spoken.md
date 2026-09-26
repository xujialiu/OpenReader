# The page follows the line being spoken

_The engineering half of this decision is
[ADR 0050](../adr/0050-the-page-follows-the-line-and-glides.md). Issue #71. It
replaces the part of [design 0011](0011-the-page-follows-the-voice.md) that held
the sentence being spoken in the middle of the screen._

## What changed

The page used to move once a sentence, when the next sentence began, and all at
once: in the blink between two frames it jumped from the middle of one sentence
to the middle of the next, often two or three lines. Between sentences it did
not move at all, so the highlighted word walked down the screen and then the
page lurched. For someone listening for hours with the text in front of them,
that was a jolt every few seconds, and the eye lost its line each time.

Now the page follows the **line** the spoken word is on. While the voice reads
along a line the page is still. When the voice moves down onto the next line,
the page moves up by that line, straight away, in a quarter of a second, fast at
first and slowing as it arrives. A line and a paragraph break take the same
quarter second. A sentence that begins on the line being read moves nothing. A
sentence that begins a new paragraph starts moving as it starts, so its first
line is in place by the time its first word lights up.

The line is held in the middle of the part of the screen that can be seen: below
the title bar and above the player.

## Where this came from

The owner likes how another reading app does it, so it was measured on the
owner's own phone, with the same book, frame by frame. It moves a line at a time,
in about a quarter of a second, slowing at the end, and it has no setting for any
of it. Its smoothness does not come from moving slowly. It comes from moving
only a little at a time, and easing into place. That is the motion copied here.

Two things were deliberately not copied:

- **It waits.** The highlight steps down onto the next line and the page follows
  a fifth to three quarters of a second later, a varying delay that looks like
  its own timer rather than a choice. That is two movements where one will do,
  so here the page moves as the word arrives.
- **It holds the line a third of the way down the screen.** The owner asked for
  the middle, so the middle is the default, and the owner can choose another
  height (below).

## What else was decided with it

- **The owner chooses the height.** A setting in General, from a fifth to four
  fifths of the way down in steps of a tenth, the middle by default. It is
  measured with the player open, so putting the player away moves nothing. It
  sits under the two pauses because the page only moves while the reading is
  heard, in a box of its own because it is about where the eye rests and not
  about the sound. The row's name and its value are the whole of it, so it has
  no heading and no sentence under it.
- **The owner chooses how the page moves.** A line at a time, as above, by
  default; or continuously, the page drifting up as the words are read so that it
  is never still and never jumps. Continuous stops while nothing is being said,
  and it follows only what has actually been spoken. Nothing is guessed about when
  the next line will come.
- **The player says whether the page is following.** In the empty space to the
  left of the voice's name, a small **A** while the page follows and **M** once the
  owner has moved it by hand, as the desktop plugin shows them. **A** only says so.
  Tapping **M** brings the page back to the reading and follows again, and while
  the reading is paused it does that without starting to play. If the owner moved
  the page only a little and the line being read is still on the screen, the page
  goes back to following by itself when the next sentence begins, as on the
  desktop.
- **When the player is put away and the reading plays, the page only follows.**
  It cannot be dragged, and a tap on a sentence still reads from there. To look
  elsewhere, the owner brings the player back first.

## What was turned down

- **Keeping the sentence and making its jump smooth.** A smooth move of three
  lines every sentence is still three lines every sentence, and it would still
  move when a sentence begins on the line being read.
- **Moving only when the line leaves a band around the middle.** Fewer moves,
  each of them the large one this change exists to remove.
- **A continuous drift timed to arrive at each line as it starts.** The last line
  of every sentence would need to know when the next sentence begins before its
  sound exists, and that is a guess.
- **A setting for the speed.** Nobody asked for it, and it would be one more row
  on a screen where every row costs a line of the page.

## Why the height ignores the player's messages and the player being put away

The player sometimes shows a line of text above its buttons: that a voice is
still being fetched, that something failed. Each one makes the player taller for
a while. If the height were measured against whatever the player covers at that
moment, every such message would move the place the line is held, and the next
line would jump by half the message's height. That happened: a message shown
while paused made the page place the sentence higher. When the message went away
at Play, the page moved the sentence down again, by four lines, before a
single word was read.

So the height is measured against the player as it is when open with nothing to
say. A message comes and goes and the line stays where it was. Putting the player
away works the same way, as the owner asked: the line stays at the height it had
before, rather than moving to the middle of the now taller page. The cost is that
with the player put away, the line sits a little above the middle of what can
now be seen. The line does not move under the eye, and that is worth more.

The one place this can show is at 70 or 80 %: several messages stacked on the
player can reach the line being read, because the line no longer rises out of
their way. Messages are brief, and those two heights are the owner's choice.

## What it costs

- **A move can take longer, but it never jumps.** When the phone is busy laying
  out the next chapter, a move pauses with it and then finishes, instead of
  skipping to the end. Measured: a quarter-second move stretched to under half a
  second while a chapter was laid out.
- **A move further than the visible page still jumps**, as it did before: a
  sentence tapped far away, the reading coming back after the owner has looked a
  long way off, a chapter that has to be laid out first. Sliding a whole screen
  of text the owner has not read past their eye is worse than a jump.
- **A finger that lands without moving does not stop a move.** Any movement of
  the finger stops it at once. A finger held perfectly still lets the rest of one
  quarter-second move finish. The alternative was to listen for the finger coming
  down, which the reader deliberately never does, so that pressing and holding on
  text stays the phone's own.
- **With a voice that gives no word-by-word timing,** the whole sentence is held
  in the middle, since there is no word to follow. A sentence the owner taps while
  paused is first placed by its first line, which is right for the voices that do
  give timing. With a voice that does not, pressing Play moves the page once more,
  by half the sentence.
