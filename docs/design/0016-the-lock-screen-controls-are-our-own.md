# The lock screen controls are our own, not the ones that came free

Most of this app's life is spent where nobody is looking at it: in a pocket, with
the screen off and a pair of earbuds in. What the listener touches then is not
the app. It is the lock screen, the panel that slides down from the top of the
phone, the tap on an earbud, the button on a car stereo.

On iPhone and iPad, all of that is driven by a piece of work of this project's
own. On Android, the version that came free is taken as it comes.

## What the free version would have shown the listener

It exists, it arrived with the machinery the app already uses to play sound, and
switching it on would have cost nothing. It was read closely first, and three of
the things a listener meets in the first minute are wrong in it.

**The lock screen would say the book was paused while the voice was speaking.**
Not sometimes. Always, and with no way to correct it from inside the app.

**A single tap on an earbud would do nothing.** That is how most people pause,
and it is what most car stereos send. The app would appear to ignore the
listener, and the only remedy would be to take the phone out and unlock it, which
is the one thing the lock screen exists to avoid.

**The time shown would be the wrong time.** This reader is used at one and a half
to three times speed. The phone is never told that, so the elapsed time it draws
is the time a slower reading would be at, and the gap widens the longer the
listener stays.

There is a fourth, smaller one. Skip-forward and skip-back buttons appear by
default. In a music player they move between tracks; in a book being read by one
long voice they point at nothing, and a dead button on a lock screen reads as a
broken app.

## Why not wait for someone else to fix it

Because nothing suggests anyone will. The worst of the three has never been
reported by anybody, the code has not changed in months, and the people who own
it list the feature as delivered with nothing further planned. A fault nobody has
noticed, in a feature nobody is working on, does not get fixed on its own.

Waiting also fails a specific test. The promise this app is built on is that what
the listener is told matches what the listener hears. A lock screen that says
"paused" over a speaking voice breaks that promise on the surface the listener
uses most.

## Why ours instead of ours alongside theirs

Only one thing can be in charge of those buttons. If two are, a single press gets
acted on twice and the two disagree about what the screen should say. So on
iPhone and iPad the free version is not merely ignored, it is never started at
all, and the division is exact: it keeps the sound, this project keeps the screen
and the buttons.

## What the phone itself decides

A real iPhone does not take the app's word for whether the book is playing. It
listens: while sound is going out, the lock screen says playing, whatever the app
tells it. That was learned the hard way. The app used to keep its sound running,
silent, through a pause, so after the listener paused, the lock screen went on
saying the book was playing and its button offered Pause for a book that had
already stopped. Pressing it did nothing visible, and resuming from the lock
screen took two presses.

So a pause now really stops the sound, and Play starts it again. The cost is
that a paused phone is free to put the app to sleep, which the listener never
sees: the lock screen's Play wakes it.

It also means the first of the three faults above was judged by the app's words,
which is what the simulator and a Mac go by. Whether the free version would have
shown "paused" over a speaking voice on a real phone was never tried there. The
other two faults do not depend on it.

## The picture beside the title

Next to the book's title the phone keeps a square for a picture, on the lock
screen, in the pill at the top of the screen and in the panel that slides down.
It is the first thing the listener sees in the pill. For a long time the app sent
nothing to put there, and the phone drew an empty grey square, which looks like a
picture that failed to load.

Now a book that has a cover shows its cover there: the same cover the Library
shows beside the book's name. A cover is tall and the square is not, so the whole
cover stands in the middle of the square with black either side. Cutting a
square out of the cover would have filled the space, but it takes the top and
the bottom, which is usually where the title is, and a cover is recognised by
all of it. Leaving the shape to the phone was the third choice; no one had seen
what it does with a tall picture, and what it does could change from one version
of the phone to the next.

The sides were left empty at first, in the hope that whatever was behind the
picture would show through. It does not: the phone fills them itself, white in
the pill at the top of the screen, which is black, and light grey on the lock
screen. The same picture goes to every place the phone shows the reading, so
the sides cannot be one colour in the pill and another on the lock screen. Black
was chosen for all of them, because the pill is black. The cost is on the lock
screen, where the cover now has two black bands beside it instead of light grey
ones.

A book without a cover shows the app's icon instead. Outside the app, the icon at
least says whose reading this is. It is the icon in its usual colours, even when
the Home Screen shows its dark or tinted version: the app cannot see which the
listener chose there, and following the phone's dark mode would only be a guess.
Inside the app nothing changes. A book without a cover keeps its book-shaped
placeholder in the Library, where the app's icon on every such row would say
nothing, since everything there is the app's.

The picture is there from the moment the reading appears on the lock screen. The
app waits the moment it takes to find the cover before it tells the phone
anything, rather than show the icon and then swap it.

## What it costs

Work of our own is ours to keep working. When the rules of the phone change,
nobody else's release fixes it for us.

And the two platforms are now deliberately unalike. Android keeps the free
version, because the Android half of it is the better-built one and does not have
these faults — but its defaults are the exact opposite of the other platform's,
so every control there has to be turned on one at a time. A button working on one
phone is not evidence about the other. Each has to be tried.

*The engineering half of this decision is
[ADR 0016](../adr/0016-now-playing-is-our-own-native-module.md).*
