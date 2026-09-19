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
