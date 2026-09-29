# The owner's phone keeps a record of what the app did

_The engineering half of this decision is
[ADR 0054](../adr/0054-debug-mode-is-fixed-when-the-app-is-built.md). Issue #82.
The words are the glossary's: **Debug Mode** and the **Debug Log**._

## Why

When something went wrong on the owner's phone, the phone kept no record of what
the app had been doing. A fault could be looked into only if it happened again
while a Mac was attached and listening, so a fault met away from the desk, or
noticed an hour later, could not be looked into at all. The long press that
stopped looking words up was the example: the investigation waited until it
failed again with a Mac attached, and then for a special build made to watch it.
What the phone does keep of its own went back only half a day, and by then the
lines that mattered were gone.

## What was decided

The copies of the app the owner installs on their own phone now keep a record
of what the app did: the **Debug Log**. After the owner reports a fault, roughly
when it happened is enough: the Mac copies the record off the phone, and the
lines around that time are read. There is no button to mark the moment, and
nothing on the screen changes except one thing, the version at the foot of
Settings, which ends in `-debug` so the owner can see which kind of copy is
installed.

Whether a copy of the app has this is decided when that copy is made, not in
Settings. The owner's own copies are always made with it. A copy made without
thinking about it, which is what a released app would be, has none of it: it
records nothing, keeps no file, and its version has no `-debug`.

## What goes in it

One line for each thing that happened, with the phone's time to the
millisecond:

- the app starting, with its version, and each time it comes to the front or
  goes into the background;
- a document opened and closed;
- the reading: play, pause, a sentence chosen, a skip, and every note or error
  the reader showed;
- each request to a speech service while reading aloud: which service and
  voice, how long the sentence was and its first words, how long the answer
  took and whether it worked;
- downloads: each chapter being prepared and whether that worked, sentences
  that could not be spoken, and what the phone was shown while the download
  went on in the background. A download's own requests are not written one by
  one, only the ones that failed: a long download asks for tens of thousands
  of sentences, and they would push everything else out of the record;
- sync with the owner's own server: each attempt, what it found and what it did;
- looking a word up or translating a passage: what was asked, of which
  service, and the start of the answer;
- the warnings and errors the app already produced but kept nowhere.

Each line also goes to the phone's own log, so it can be read beside what the
phone itself recorded at the same moment.

The document's own words appear, because a fault is often about a particular
sentence or selection. They are cut to about a line: the sentence being spoken,
the words selected, a title, the address of the sync server.

## What never goes in it

No key to any speech or translation service, no password to the sync server,
and nothing the owner typed to get past a gateway in front of their own server.
None of these is ever written into a line. Where the app might pass one on by
accident, in an error it did not write itself, each key, password and gateway
secret the phone's secure storage has handed over is replaced by a marker
before the line is kept, as it was last saved or read. Anything shorter than
eight characters is not searched for, because searching for a few characters
blanks every word they occur in: typing a key once turned every letter s in the
record into the marker. A sync password that short is still never written into
a line by the app itself.

The record stays on the phone. Nothing is sent anywhere: it leaves the phone
only when the owner connects it to the Mac and copies it off.

## What it costs

At most 20 MB of the phone's storage. The record is kept in four parts of at
most 5 MB each; when the fourth is full, the oldest part is deleted, so the
record always holds the most recent 15 to 20 MB. Reckoned from the length of
its lines rather than measured on the phone, an hour of listening writes about
two thirds of a megabyte, so the record holds more than a day of listening,
and an idle reader left open writes about a tenth of that.

It is not in the phone's backup, and it is not in the Files app. The phone does
not delete it to make room, as it deletes the app's temporary files, so a fault
from yesterday is still there today.

The app gathers the lines and writes them together, at most once every two
seconds and at once when it is sent to the background, rather than one at a
time, so keeping the record does not slow the reading.

The same copies of the app also let the Mac look inside the page as the reader
shows it, and let the testing tools drive the app through a file on the phone.
A released copy has neither: its page cannot be looked into, and it ignores that
file.

## What was turned down

**A switch in Settings.** The owner would have had to remember to turn it on
before a fault, which is exactly when nobody knows a fault is coming, and a
released app would have carried the switch and everything behind it. The owner
chose to decide it when a copy is made: their own copies always have it, and a
release cannot be switched into it.

**Relying on the phone's own log.** The phone does keep a log, but it throws
the app's lines away unless a Mac is listening at the moment they are written,
and a day of ordinary use pushes out the lines of the phone's own that explain
a fault. The record the app keeps is kept for as long as its 20 MB allows.

**A crash and usage reporting service.** That would send what the owner reads,
and when, to someone else's server. Everything the app runs on belongs to the
owner, and the record stays on the phone for that reason.
