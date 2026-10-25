# The reading can pause by itself

_The engineering half of this decision is
[ADR 0088](../adr/0088-a-stop-line-in-the-engine.md). Issue #326. It is the
one exception the owner asks for to
[decision 0023](0023-the-reading-does-not-stop-at-the-end-of-a-chapter.md):
the reading still goes on from chapter to chapter unless the owner has asked
it to stop._

## What changed

The player's top row has a moon, just left of the arrow that folds the player
away, opposite the tap lock's padlock ([decision 0087](0087-a-tap-on-the-page-can-be-locked.md)).
Tapping it opens the phone's own
small menu, as Theme and Alignment do ([decision 0035](0035-a-short-choice-opens-where-you-tapped.md)):

- When Current Chapter Ends
- 5 Minutes, 10 Minutes, 15 Minutes, 30 Minutes, 45 Minutes, 1 Hour

Choosing one sets the sleep timer, and the menu checks it. While it is set,
`Turn Off Timer` is the first line of the menu. Choosing a length again starts
it again from the whole length.

While it is set, the moon says so. For a length, the moon is replaced by the
time left, such as 29:41, counting down. For the chapter, the moon is drawn in
the colour of the app's checks.

## What it does

- **The chapter is the one the contents marks.** The reading pauses when the
  voice has finished the chapter's last sentence and would go on into the next
  chapter. If the owner moves the reading to another chapter meanwhile, it is
  that chapter's end. A page the contents does not list, such as a copyright
  page, belongs to the chapter before it. A book without a contents does not
  offer this choice.
- **A length counts only while the book is being read.** Paused, the count
  stops; Play carries it on from where it was. Twenty minutes means twenty
  minutes of listening, however long the owner paused in between.
- **When the length runs out, the sentence being read is finished first**, and
  then the reading pauses. The voice never stops mid-word, and the next Play
  starts with the following sentence, so nothing is heard twice.
- **It pauses once.** After that the sleep timer is off, and the next Play
  reads on without one.
- **The pause is like any other.** The player opens, the place is written down
  and sent to the owner's other devices, and the phone's lock screen shows the
  book as paused.
- **It belongs to the reading.** It goes on while the owner is in the library
  with the book still being read, and it ends when the reading ends. Closing the
  app forgets it.

## Who it is for

The owner falls asleep listening. Since the reading no longer stops at the end
of a chapter (decision 0023), a book left playing reads on for hours, and the
place written on every device is wherever the voice got to, chapters past the
last thing the owner heard. Finding that again means searching by hand, and a
voice service that charges by the character is paid for all of it.

## The lengths

The lengths run from five minutes to an hour, the range listening apps
commonly offer, with the chapter first because it is the one that leaves the
owner at a natural place to resume. There is no length to type in:
a menu of seven is one tap, and a sleep timer is set by someone about to stop
looking at the screen.

## What it costs

- **Room in the player**, shared with the tap lock and described there.
- **A chapter is only as exact as the book's contents.** Where a book's
  contents names only its volumes, the timer ends a volume. The contents and
  the timer always agree, because they use the same answer.
- **Finishing the sentence takes a few seconds past the length.** At an hour,
  that is nothing; it is chosen over a voice cut off mid-word.
- **In one rare moment it can run a few sentences long.** If the length runs out
  in the second or two while a newly chosen voice is taking over, the sentences
  already prepared in the new voice are read before the pause.

## Turned down

- **Pausing the moment the length runs out**, or fading the voice out. Both
  leave the owner mid-sentence, and the next Play repeats the sentence from its
  start.
- **Counting by the clock on the wall**, so that a pause uses up the length, or
  **turning the timer off at any pause.** Either makes a short pause to answer
  someone cost the owner the rest of their timer.
- **Setting the timer again by itself every time Play is pressed**, so that a
  nightly choice need not be made each night. It would stop a daytime reading
  without warning. A timer that is chosen once and then forgotten is the
  simpler promise.
- **Showing the time left on the phone's lock screen.** The lock screen shows
  what the phone draws for a book being read; the timer is the app's own.
