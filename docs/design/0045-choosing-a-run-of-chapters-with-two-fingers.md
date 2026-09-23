# Choosing a run of chapters with two fingers

## What was decided

In the download drawer, dragging two fingers down or up over the chapter list chooses every chapter the fingers pass over, the way the phone's own lists do in Files and Reminders. It works the same in Manage downloads, where it chooses chapters to delete. One finger still scrolls the list, as before.

It behaves as the phone's gesture was measured to behave, not as it was remembered:

- The chapters chosen are the whole run from the row where the fingers came down to the row under them now. Moving back toward the start gives rows back, and moving past it extends the run the other way.
- Beginning on a chosen row takes rows out instead, so the same gesture undoes a run.
- Each drag adds to what the ones before it chose.
- Lifting one of the two fingers does not stop it; the other carries on.
- Holding the fingers at the top or bottom edge of the list scrolls it by itself, as fast as the phone does, and the run follows. Dragging past the list onto the button below counts as the bottom edge.

Some rows cannot be chosen by a tap, and a drag passes over them without changing them: a chapter already downloaded, one being downloaded, or a heading with no text of its own. A folded volume counts as every chapter folded inside it, as a tap on it does. An open volume heading counts for nothing of its own, because its chapters are rows of their own, which the fingers cross anyway; counting the heading would choose chapters below where the fingers stopped.

## Why

A long book is hundreds of chapters, and the list shows about five at a time. Before a trip the owner chooses a stretch, say chapters 40 to 90, and afterwards deletes a stretch already heard. Choosing all, or a whole volume, was already one tap; any other stretch cost a tap per chapter and a scroll every five rows. The owner already knows the two-finger drag from the phone's own lists, so it needs no explanation and nothing on the screen announces it.

## The phone draws its lists; the app copies the gesture

Decision 0042 says the phone should draw a control itself wherever it can. It can draw a list that has this gesture built in, and that was turned down here:

- **The rows would change.** The phone's list puts its own round selection marks at the start of each row. The drawer's marks, and the download rings that replace them while a chapter is downloading, sit at the end. The owner would have seen a mark on both sides of the same row.
- **It could not tell which rows may be chosen.** Downloaded chapters and chapters being downloaded would have been chosen along with the rest, and would have had to be unchosen after the fact.
- **It might not have worked at all.** In the way the app would have used the phone's list, the list could not switch itself into choosing, which is how the gesture starts. That could only have been found out after rebuilding the drawer.

So the list stays the app's own and the app draws the gesture the phone's way, the second step of decision 0042. What that costs is what the second step always costs: if the phone changes how the gesture feels, the drawer keeps the old feel until someone measures again.

## Where it is not the phone's

- **The run begins on the row the fingers touch.** The phone waits for the fingers to move a little before it starts, and a quick drag there begins on the next row down. The owner asked for the rows under the fingers, and that is what the drawer chooses.
- **There is nothing to switch on.** The phone's lists enter a choosing mode when the drag begins. The drawer's selection circles are always there, so a drag simply chooses.

## Turned down

- **The phone draws the list.** Explained above: marks on both sides of a row, downloaded chapters chosen by accident, and a gesture that might never have started.
- **A list of the app's own written for the phone alone.** The phone's exact gesture, and a way to refuse rows, but the most work of the three and more for the app to keep up, for a gesture the owner could hardly tell apart from the copy.
- **One finger sliding down the circles.** Mail offers this once it is choosing. The drawer's circles are always there, so a finger landing on them to scroll would have chosen chapters instead.
