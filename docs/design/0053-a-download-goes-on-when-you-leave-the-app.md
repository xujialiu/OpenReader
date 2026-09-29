# A download goes on when you leave the app

_The engineering half of this decision is
[ADR 0053](../adr/0053-a-download-runs-as-a-continued-processing-task.md).
Issue #77. It changes "Preparation continues beyond the drawer" and
"Agreement and remaining validation" in
[decision 0027](0027-whole-document-offline-narration.md)._

## What changed

The owner used to have to keep the app open for a download to finish. With
nothing playing, a download stopped less than a minute after they left the app
or locked the phone, and went on only once the app was opened again. A long
document at about a minute per chapter meant holding the phone awake for hours.

On recent versions of iOS, a download the owner starts or resumes now goes on
after they leave the app or lock the phone. They start it with Download
selected, Resume all or Retry failed, or with a tap on a ring that resumes a
chapter or continues a stopped download. A download still going on by itself
when the owner opens the app goes on after they leave it again, too. While it
goes on, the phone shows it as a Live Activity, as it shows a delivery or a
timer: on the Lock Screen and, on a phone that has one, in the Dynamic Island.
That display belongs to the phone and not to the app. There is one for every
download going on, and it shows them together:

- that the app is downloading, and how many books: `Downloading 2 books`, or
  `Downloading 1 book`. Two voices of one book are one book, and a book paused
  before anything of it was saved is not counted. It names no book;
- how many chapters of all those downloads are saved, for example
  `120 of 200 chapters`. A download that finishes stays in the count, so the
  count never goes back: with one book of 100 chapters finished and another at
  20, it reads `120 of 200 chapters`, and a third of 50 started meanwhile
  makes it `120 of 250 chapters`. A download the owner deletes leaves the
  count. Chapters the owner paused are left out while anything goes on, unless
  they are already saved, and so is the rest of a book the owner paused as a
  whole meanwhile: with most of a book paused, it read `49 of 188 chapters`, a
  count the downloads were never going to reach. Once nothing goes on any
  more, every chapter is counted again, so that as the phone takes it away it
  shows where the downloads stopped rather than a count that looks complete;
- a bar that fills as each sentence is saved.

When the downloads finish, or the owner pauses all of them, the phone shows
them done for a moment and then takes it away. A download started or resumed
while it is shown joins the count; the next time the phone shows one, it
counts afresh.

Until 2026-09-29 the display showed the one download being written: its book's
name, and its own chapters. With two books going on, the owner saw one book's
name and count, then the other's when the first finished, with no sense of how
much was left of both; the name was cut after about 25 characters; and the
phone's own question about continuing (below) named only the book being
written. The owner decided then to show every download together, counted as one, under a
title that says how many books: the phone's question now reads
`Downloading 2 books is 6% complete.` Turned down: counting only the downloads
not yet finished, which makes the count go back each time one finishes;
counting every download in the Library, paused ones included, a count the
downloads will never reach; and the titles `2 books`, which the phone's
question would read as `2 books is 6% complete`, the app's name, which the
display already shows with its icon, and `Downloading` alone, which hides how
many books.

## What the owner's iPhone showed

On the owner's iPhone the phone took the download on at once, both after
Download selected and each time the app was opened with a download going on.
With the phone locked and nothing playing, the download went on for more than
five minutes, saving sentences every few seconds, and moved from one chapter to
the next by itself. The Lock Screen read `2 of 15 chapters`, with a ring that
filled.

About five minutes in, with the download 16% done, the phone asked by itself,
on the Lock Screen, whether to keep running it in the background, with Continue
and Stop. The app does not cause that question and cannot prevent it. After
Continue, the download went on.

## It opens large at the top of the screen until it is swiped

When the owner leaves the app with a download going on, the phone shows the
Live Activity large at the top of the screen, in the Dynamic Island: the
title, the chapter count and the stop ring, over the Home Screen and
over whatever app they open next. It stays that way until the owner swipes it
up. After that it is the small one at the top. On the owner's iPhone it stayed
large for three minutes, until they swiped it, and every later time they left
the app it stayed small. A timer's or a delivery's Live Activity shows large
for a moment and then shrinks by itself; this one does not.

The app cannot change this. Showing it large is the phone's own announcement
that it has taken the download on, not something the app asks for, and the
phone gives the app no say in how it is shown. The count changing while the
owner was away never made it large again. The one the phone shows when a
download finishes goes away by itself after a few seconds.

The owner decided on 2026-09-29 to accept it, and to report it to Apple.
Nothing the app could do instead would help: a display of the app's own would
add a second card beside the phone's rather than replace it, and giving up the
phone's taking the download on would bring back the download stopping within a
minute of leaving the app.

## Stopping it from the Lock Screen

The owner can stop the download from what the phone shows. Stopping it there
now pauses it, exactly as Pause all does: everything already saved is kept,
and opening the app neither starts it again nor asks the phone to show it
again. The drawer offers Resume all, which starts it again and shows it on the
Lock Screen once more. Downloads that had already stopped, paused or finished
are left as they were.

The stop takes a moment. On the owner's iPhone, tapping it briefly opened the
app, which then went back behind the Lock Screen, and the phone ended the
download 4 to 10 seconds later. It is paused whether the app is open or
not when that happens.

The first version treated the stop as an interruption: the download kept what
it had saved and went on the next time the app was opened. On the owner's
iPhone that meant the stop stopped nothing. Twice, the owner stopped it, opened
the app, and saw the download going again and the phone showing it once more.
Pause all in the app was the only way to stop it.

The phone also ends the download by itself when it needs the resources, and the
app is told only that it has ended, never which of the two happened. Both are
now treated as the owner's stop. What is given up: when the phone ends a
download for its own reasons, it stays paused until the owner taps Resume all,
where the first version would have gone on the next time the app was opened.
The owner accepted this on 2026-09-28, unless the two can one day be told apart
reliably. So far only the owner's stops have been seen, and the app now notes
what it can see at each end so that a stop the phone makes itself can be
compared with them.

## When the owner asks, or opens the app

The phone lets an app go on like this only straight after the person asked for
the work, and it may refuse or end work an app started on its own. At first a
download went on away from the app only after one of the taps above. After a
download was interrupted, it went on by itself while the app was open, but if
the owner then left the app without tapping anything, it stopped again within a
minute until they tapped Resume all or a ring.

The owner decided on 2026-09-28 that opening the app counts as asking. So when
the app is opened, or comes back to the front, while a download is going on by
itself, it goes on after the owner leaves again without a tap. That includes a
download that was interrupted and one the app picks up again when it starts.
A download the phone has ended is paused (above), so opening the app does not
start it again; Resume all does.

What is given up: the phone's maker says people do not expect work to start on
its own, and the phone may refuse or end work it takes to be unasked for. On
the owner's iPhone it took the download on each time the app was opened. Where
it refuses, the download stops within a minute of leaving the app, as before.

## Where it does not apply

On earlier versions of iOS, and in the simulator used for testing, nothing
changes: the download stops within about a minute of leaving the app and goes
on when it is opened again. The same happens when the phone refuses, which it
may do when it is busy. Closing the app from the app switcher ends the
download, and the phone does not tell the app. The phone then leaves a card
reading `Task failed` on the Lock Screen, beside the card of the next download,
until the owner clears it with the ✕ beside Background Activities. It is not a
second download, and nothing already saved is lost. On the owner's iPhone one
such card was still there ten minutes later; another went away by itself after
about half a minute, for a reason the phone does not record. The app cannot
clear it: the phone gives it no hold on a card it has stopped.

## What was turned down

- **Playing silence to keep the app awake.** It was already refused for
  downloads in decision 0027. The App Store's rule is that playing in the
  background is for sound the person hears.
- **Handing each sentence to the phone to fetch as a file.** Every speech
  service's request would have to be rebuilt that way, Azure's word timings
  could not come back through it, and the result would look the same to the
  owner.
- **The phone's maintenance time.** The phone gives that time when it chooses,
  usually overnight while charging, not when the owner leaves the app.

## What it costs

- A long download now uses the network and the battery while the phone is
  locked, which is what the owner asked for.
- The phone may still end it early, and a long document is not promised to finish
  while the phone stays locked. After about five minutes the phone may ask the
  owner whether to keep going.
- When the phone ends it for its own reasons, the download is paused, and the
  owner has to tap Resume all to go on.
- Where a new chapter starts away from the screen, its text has to have been
  prepared while the app was open (#76).
