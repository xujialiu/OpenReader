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
chapter or continues a stopped download. While it goes on, the phone shows it
as a Live Activity, as it shows a delivery or a timer: on the Lock Screen and,
on a phone that has one, in the Dynamic Island. That display belongs to the
phone and not to the app, and nobody has seen it on the owner's iPhone yet. It
shows:

- the document's name, as the Library shows it;
- how many of the download's chapters are saved, for example
  `12 of 40 chapters`;
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
stopped until the owner finds it. **This is the owner's to confirm.**

## Only after the owner asks

The phone lets an app go on like this only straight after the person asked for
the work, and it may refuse or end work an app started on its own. So a
download goes on away from the app only after one of the taps above. Opening the
app is not such a tap. After a download was interrupted, it goes on by itself
while the app is open. If the owner then leaves the app without tapping
anything, it stops again within a minute, as before, until they tap Resume all
or a ring. A download the app picks up again when it starts is treated the same way.

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
