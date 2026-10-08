# Downloads across documents and voices: turned down

## What was decided

OpenReader does not get one place to manage Downloads across every Document
and Voice. Downloads stay where they are: each Document's own Download drawer in
the Reader starts, pauses, continues and deletes that Document's Offline
Narration, one Voice at a time.

## What was turned down

A full page, reached from the Library's menu, listing every Document that had a
Download or saved audio, in the Library's Folder order. From it the owner could
have started a Download for any Document without opening it, chosen its Voice
and chapters, and paused, continued or deleted audio for several Documents,
whole Folders, one Voice or a few chapters at once, seeing the space each took
and the space a deletion would free. Deleting the audio of the Document being
read aloud would have paused the Reading first and kept its Reading Position.

It was built in full and tried on the simulator and the owner's phone, and was
never released. The owner judged it too complex and removed it before it
reached the app.

## Why

Two places would have managed the same Downloads, and they had to agree on
everything: progress, pause, failure, saved space and what a deletion had just
removed, including while a Download was running or a Reading was playing.
After the first complete version, five more test builds went mostly on
keeping the two in agreement, and each fix uncovered another moment where
they could disagree. The page was a second way to do what the drawer already
does, and it cost more to keep right than it gave.

## What the owner gives up

To see or clean up Offline Narration in several books, the owner opens each
Document and its Download drawer in turn. A Download starts only from inside
the Reader. There is no single figure for the space all saved audio takes.

The request and its specification remain in
[issue 137](https://github.com/xujialiu/OpenReader/issues/137) and
[issue 138](https://github.com/xujialiu/OpenReader/issues/138), closed as not
planned.
