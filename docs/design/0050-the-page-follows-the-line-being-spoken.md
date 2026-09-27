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
  measured with the player and the title bar open, so putting them away moves
  nothing. A change reaches a reading that is still going on behind the library
  straight away, so the page is already there on the way back. It
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
  the reading is paused it does that without starting to play. If the first line
  of the next sentence is on the screen when the voice begins it, the page goes
  back to following by itself, as on the desktop; otherwise it stays where the
  owner put it (below, "Looking away while listening").
- **When the player is put away, the page only follows**, whether the reading is
  playing or paused. A page the owner had moved comes back to the reading as the
  player goes, it cannot be dragged, and a tap on a sentence still reads from
  there. To look elsewhere, the owner brings the player back first.

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

## Looking away while listening

Before this, moving the page while the reading played lasted only until the next
sentence. Then the page jumped back to the reading from wherever the owner had
taken it, whether they had moved it one line to re-read something or ten
chapters to look something up. Nothing said which of the two the page was doing.

Now the page stays where the owner puts it, and the player says so: **M** in the
place beside the voice's name, where **A** stood while the page followed. The
page comes back in one of three ways:

- **The owner asks for it.** Tapping **M**; pressing Play after a pause; tapping
  a sentence, or skipping, which move the reading and bring the page with it; the
  reading's place arriving from another device. **M** moves the page and nothing
  else: a paused reading stays paused, and a playing one goes on with the word it
  was on. This is also what #53 asked for, a way back to the reading's sentence
  that does not start playback.
- **By itself, at a sentence the owner can see begin.** If the first line of the
  next sentence is on the screen when the voice starts it, the page takes the
  reading back and follows again — the owner only looked a little way off and
  has come back into the reading's reach. If it is not on the screen, the page
  stays away, sentence after sentence. This is the desktop plugin's rule, so the
  two behave the same, and like the desktop it has no setting. Pausing changes
  neither way. Only a sentence the voice actually begins counts: changing the
  speed or the voice in the middle of a sentence restarts nothing the owner can
  hear, and leaves the page where they put it.
- **The player is put away.** With the player down to its one button there is no
  **M** to tap, so a page left away from the reading would be a page nothing on
  the screen could bring back. Putting the player away therefore brings the page
  back to the reading first, and from then on the page only follows: a finger
  cannot drag it, and a tap on a sentence still reads from there. This holds
  while paused too, which the owner confirmed: one rule for the put-away player,
  rather than a page that is locked or not depending on whether the voice happens
  to be speaking.

**A** is only a mark. Tapping it does nothing: the page is already following,
and there is nothing to ask for.

Turned down with it:

- **Tapping A to stop following on purpose,** as the desktop allows. On a phone
  the finger that drags the page already says it, and a tap that silently locks
  the page away from the reading is easy to make by accident on a mark that small.
- **Coming back after a few seconds without a touch.** It would take the page
  from under the owner while they were still reading the part they went to look
  at.
- **Letting the page be dragged with the player put away.** The owner would have
  moved it and then had no way back but to bring the player out again, with
  nothing on the screen saying the page had stopped following.

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

## Continuous, the other way to follow

General's **Scrolling** row offers two ways: **By line**, everything above, and
the default; and **Continuous**.

In Continuous the page is never still while a sentence is read. As the voice
moves along a line, the page rises with it, so that by the time the voice reaches
the end of the line the next line has arrived where this one was. The eye can
stay at one height and the text passes through it, the way credits roll, except
that it rolls only as fast as the voice reads and stops when the voice stops:
between sentences, at a pause, and when the owner presses Pause — then at once,
on the same instant as the sound, rather than easing on for the second the
rolling would otherwise take to settle. The owner chose that: a page that keeps
moving after the voice has stopped looks like a page that has not heard.

It is driven only by the words that have actually been spoken. Each word says how
far along its line the voice has got, and the page eases towards that, a word
behind at most, so that the separate words run together into one movement instead
of a nudge per word. Nothing is predicted about when the next word or the next
line will come, which is why this was chosen over rolling at a steady speed timed
to meet each line: that would have had to guess, at the end of every sentence,
when the next one would start.

Two moves are still the quarter-second glide of By line, because rolling through
them would be slow and pointless: crossing into a new paragraph or a heading, and
anything else more than a line away, such as a sentence tapped elsewhere. A new
paragraph glides however little space a book leaves between its paragraphs, so
that every paragraph starts the same way. Anything
further than the visible page still jumps, as it does By line.

A finger stops the rolling as it stops a glide, and moving the page by hand is
browsing, in either way.

### What Continuous costs

- **It moves in the smallest steps the page allows.** The page can only be
  placed on whole points, and a reading moves it only five to ten of them a
  second, so the rolling is a step of one point — three of the screen's own
  pixels — five to ten times a second. Whether that reads as smooth rolling or
  as a fine tremble is the first thing to look at on the phone.
- **Its speed follows the words.** A long word or a short one, a quick phrase or
  a slow one, changes how fast the page rises, a little. The easing keeps that
  gentle, and it is the price of following the voice rather than a clock.
- **It trails the voice slightly.** The line being spoken sits a few points below
  the chosen height while the page rolls, and settles onto it when the voice
  stops. A few points, against a line of twenty or more.

### What changed for both ways

The app clears away chapters the reading has left behind, so that a long book
does not fill the phone's memory. It used to wait for the page to be completely
still before doing so, because clearing while the owner's finger is flinging the
page made the text jump by a whole chapter (#58). Continuous is never still while
a sentence is read, so under that rule nothing would ever be cleared until the
owner paused. Now the app tells its own movement of the page from the owner's: it
clears while the page is moving by itself, which is safe, and still waits
whenever the page is moving under the owner's finger or coasting after it. By
line benefits the same way, and nothing the owner does by hand has changed.

### Telling a drag from a tap

Moving the page by hand is how browsing begins, and the app used to decide it
had been moved by how far the finger travelled across the words under it. But
once the phone takes a finger's movement for a scroll, the words travel with the
finger, and the finger hardly moves across them at all. So whether a drag
counted turned on a hair's breadth of how soon the phone started its scroll, and
a drag the owner plainly made could leave the page following, to be pulled back
at the next line. The app now measures how far the finger travelled on the
screen, which is the same whether or not the words went with it.
