# Collapsing leaves the page and one button that brings the controls back

_The engineering half of this decision is
[ADR 0048](../adr/0048-the-bar-floats-and-the-page-keeps-room-for-it.md).
Issue #67. It revises "Collapsing leaves one button, and pausing brings
everything back" in [decision 0020](0020-the-player-and-knowing-where-you-are.md)._

## What changed

The arrow at the top right of the player folds it away, and until now that left
the bar across the top of the page where it was: the back arrow, the book's
name and the button for more actions. It now goes too. What is left is the page,
the phone's own clock and battery above it, and one round button at the bottom
right.

That button used to be the player's Play and Pause, and pressing it paused the
reading. It now does neither. Pressing it brings back the player and the bar,
and the voice carries on exactly as it was: reading if it was reading, silent if
it was paused. It carries the phone's own sign for sound that is playing, the
little waveform the phone shows beside a song that is on. The waveform moves
while the book is being read, stands still while it is paused, and turns into
the spinner while the next sentence is still on its way.

The bar and the player always come and go together. Anything that has always
brought the player back brings the bar back as well: a pause from the lock
screen, from Control Centre or from headphones, and anything the player has to
tell the owner, such as a voice that could not be reached. Swiping in from the
left edge still leaves the book while both are hidden, as the back arrow does.

## Who it is for

The owner collapses the player to have the page and nothing else, and a bar left
across the top was not that. And while the book was being read there was no way
to reach the controls again, to see the voice, change the speed or open the
contents, without stopping the voice first and starting it again afterwards.

## The text does not move

Nothing on the page moves when the bar and the player go or come back. The bar
now lies over the page the way the player always has, instead of standing above
it. While it is shown it covers the top line or two, the way the player covers
the last few, and when it goes those lines are simply there. Everywhere the app
puts something at the top of the page itself (the start of a book, a chapter
chosen from the contents, a book opened where it was left) it leaves room for the
bar, so none of those ever lands under it.

The cost is a strip of empty page as tall as the bar at the very beginning of a
book, which shows while the bar is hidden. Everywhere else the space is text.

## What was turned down

**Let the page grow into the space the bar leaves.** Each time the controls went
or came back, every line of the book would jump up or down by the bar's height.
The owner would lose their line on the page at exactly the moment they asked the
app to get out of the way.

**Keep the Play and Pause button, and bring the controls back only on a pause**,
as before. It was chosen in the first place so that someone reaching out to stop
the reading always has a button to press rather than tapping the page, which
moves their place. There is still always a button to press, so that is kept.
What is given up is that stopping the reading while the controls are hidden now
takes two presses, one to bring them back and one on Pause, where it used to take
one.

**Keep the Play and Pause picture on the new button.** A Play sign on a button
that does not play is a lie the owner would meet the first time they pressed it
while the book was paused.

**An arrow pointing up, the opposite of the one that folds the player away.** It
says what a press does, but it cannot also say whether the book is being read,
which the waveform does in the same space.

**Hide the clock and battery as well**, as some reading apps do. The owner keeps
the time, and the top of the page would then run up under the camera cut-out.
