# A download goes on when you leave the app

_The engineering half of this decision is
[ADR 0052](../adr/0052-a-download-runs-as-a-continued-processing-task.md).
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
That display belongs to the phone and not to the app, and nobody has seen it on
the owner's iPhone yet. It shows:

- the document's name, as the Library shows it;
- how many of the download's chapters are saved, for example
  `12 of 40 chapters`. Chapters the owner paused are left out while the
  download goes on, unless they are already saved: with most of a book paused
  it read `49 of 188 chapters`, a count the download was never going to reach.
  Once the whole download is paused, every chapter is counted again, so that
  as the phone takes it away it shows where the download stopped rather than a
  count that looks complete;
- a bar that fills as each sentence is saved.

When the download finishes, or the owner pauses all of it, the phone shows it
done for a moment and then takes it away. When it moves on to another
document's download, the name and the count follow it.

## Stopping it from the Lock Screen

The owner can stop it from what the phone shows, without opening the app. The
phone also ends it by itself when it needs the resources. The app is told only
that it has ended, never which of the two happened. Both are therefore treated
the same way: the download is interrupted, keeps everything already saved, and
goes on when the app is opened again. The drawer says
`Interrupted · continues when available`, as it always has.

The plan was that stopping it from the Lock Screen would pause the download, as
Pause all does. That cannot be told apart from the phone's own stop, and a
pause would mean a download the phone stopped for its own reasons also stays
stopped until the owner finds it. The owner chose on 2026-09-28 that both
interrupt. What is given up: a stop on the Lock Screen is not a pause. The
download goes on the next time the app is opened, and to stop it for good the
owner taps Pause all in the app.

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
When the phone ends it while the app is open, nothing more is asked of the
phone until the owner leaves and opens the app again: the phone has only just
ended it.

What is given up: the phone's maker says people do not expect work to start on
its own, and the phone may refuse or end work it takes to be unasked for.
Whether it treats opening the app that way has not been seen on the owner's
iPhone. Where it refuses, the download stops within a minute of leaving the
app, as before.

## Where it does not apply

On earlier versions of iOS, and in the simulator used for testing, nothing
changes: the download stops within about a minute of leaving the app and goes
on when it is opened again. The same happens when the phone refuses, which it
may do when it is busy. Closing the app from the app switcher ends the
download, and the phone does not tell the app.

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
  while the phone stays locked.
- Where a new chapter starts away from the screen, its text has to have been
  prepared while the app was open (#76).
- None of this has been measured on the owner's iPhone yet.
