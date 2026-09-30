# A chapter chosen while listening only takes the page there

_The engineering half of this decision is
[ADR 0063](../adr/0063-a-contents-row-browses-while-playing.md). Issue #107. It
replaces the part of
[design 0044](0044-looking-at-another-chapter-keeps-your-place.md) that kept
"While playing, a chapter still moves the reading"; the rest of design 0044
stands._

## What changed

While the reading plays, choosing a chapter in the contents now takes the page
to that chapter and does nothing else. The voice carries on with the sentence
it was reading, the page stops following it, and the player shows **M**, as it
does when the owner moves the page with a finger. The contents still mark the
chapter being read, not the one on the page.

Paused, a chapter already behaved this way (design 0044). So a chapter in the
contents now means one thing whether or not the voice is speaking: look at it.

## What it replaced

Choosing a chapter while listening used to move the reading. The voice stopped
mid-sentence, read the chosen chapter's title and carried on from there, and
the saved place moved with it, to the Library and at the next sync to the
desktop. Getting back to the sentence that had been cut off meant finding it by
hand.

Design 0044 kept that deliberately. At the time the page always followed the
voice, so it could not stay on a chapter the voice was not reading, and the
advice was to pause first. Design 0050 removed that reason: since then a page
moved by a finger while listening stays where it was put. That left the
contents as the one way of looking elsewhere that also moved the reading, and
the owner reported it as a fault.

## Coming back

Exactly as after moving the page with a finger (design 0050, "Looking away
while listening"). The page comes back to the reading when the owner taps
**M**, taps a sentence, skips, puts the player away or presses Play after a
pause, or when the reading's place arrives from another device. It also comes
back by itself when the voice begins a sentence whose first line is on the
screen.

Two cases show what the last rule means for the contents:

- **The next chapter.** Near the end of chapter 5, the owner opens chapter 6 to
  see how long it is. The page waits at chapter 6's title. When the voice
  reaches that title, which is on the screen, the page follows again.
- **The chapter being read.** The page shows the top of the chapter. If the
  voice's next sentence begins where the owner can see it, the page follows
  again. If it is further down, the page stays at the top until the owner asks
  for the reading.

## What still moves the reading

Tapping a sentence, and the buttons that go back and forward a sentence or a
paragraph. While listening, a tapped sentence is read at once, so reading from a
chosen chapter is its title or any sentence in it, tapped after the page gets
there.

In a book that has never been read, a chapter still chooses where the reading
starts (design 0044). While listening, that holds only in the moment after the
first Play, before the voice has said anything: there is no sentence yet to
keep.

## What was turned down

**Pausing at the press.** The owner looks at another chapter to check a name or
see how far the chapter goes, and wants to keep listening while doing it.
Pausing would make every look cost the listening.

**Coming back only when asked.** A look through the contents would then follow
different rules from a look with a finger. Choosing the chapter being read would
leave the page stuck at its top while the voice read on a few lines below, in
plain view, with nothing to bring it back but **M**.

**A gesture on the row that jumps there and reads**, such as a long press.
Tapping the chapter's title does the same thing with one more tap, and a gesture
nothing on the screen shows is one more thing to learn.

## What it costs

- One more tap to jump to a chapter and hear it while listening: the chapter,
  then its title.
- The single "jump there and read it" gesture is gone. It survives only in a
  book that has never been read, before its first sentence.
- While the owner looks elsewhere, the voice reads on out of sight, and the
  saved place moves with it, as speech always moves it.
