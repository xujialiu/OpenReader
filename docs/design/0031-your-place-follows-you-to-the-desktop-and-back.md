# Your place follows you to the desktop and back

*The engineering half of this decision is [ADR 0031](../adr/0031-positions-cross-products-by-document-id.md).*

Stop a novel on the phone, sit down at the desktop, press the resume key, and the
desktop reads on from that sentence. Stop on the desktop, pick up the phone,
press play, and the phone reads on from there. Two phones agree with each other
the same way. This is the promise the app was started for, and until now it was a
promise: the phone kept its place only for itself, and the desktop reader kept
its place only for other desktops.

## Who it is for

Someone who listens to the same book in two places and does not want to hunt for
the sentence they last heard. It matters most for a long novel, where "roughly
where I was" is a chapter away from the truth.

## One file, written by both

The desktop reader already keeps every computer's places in one file on storage
the owner runs themselves. That file cannot serve the phone: it names a book by a
number the desktop's library gives it, which a phone does not have, and it has
room for nothing else — an older desktop copy quietly throws away anything added
to it, on every computer, without a word.

So there is a file of its own, beside it, that both the desktop and the phone
write. It names a book by the book itself, the way the phone already does, so a
book the owner put on the phone by hand keeps its place between two phones
without ever having been near a library. And for every book it holds where the
reading stopped, the sentence that was being spoken there, and when and by which
device it was written. The desktop's old file stays exactly as it was, so
computers that have not updated go on agreeing with each other.

**What was turned down.** The first plan asked the desktop to publish a list
matching its library numbers to the book itself, so that the phone could read the
desktop's file. It would have let the phone find the desktop's places and never
write its own for the desktop, and it would have left a hand-added book with no
place to keep. A list was not needed once the file names the book by itself.

**What it is called.** The file carries the author's name rather than either
product's. Calling it after the phone app would have been a lie the day the
desktop reader keeps its own places there too; calling it something plain would
have risked overwriting some other program's file of the same name in a shared
folder, because a damaged file is repaired by writing over it. The owner will see
a file named after a person in their folder, once, and a line in the desktop
reader's release notes says what it is.

## The sentence is the judge

Both readers write down the paragraph the reading stopped in, in a form the two
were measured to agree on: for two ordinary novels, every one of over a hundred
and twenty thousand paragraphs named the same paragraph on both sides. But the
form is not trusted alone. Each side also writes down the sentence itself, and the
other side finds that sentence in the paragraph before it reads a word. If the
sentence is not there it looks for it through the whole book; if it is nowhere,
or in two places equally, the reader says it could not find the place rather than
guessing, and starts from the last place it knew itself. That is the rule the app
has always held to, applied to a place that came from somewhere else.

The measurement also found where the two readers disagree — books whose chapters
are written in a looser form that the phone reads differently from the desktop —
and there the sentence does the work the paragraph cannot. The owner does not see
a difference; the reading lands on the sentence either way.

## When your place moves, and when it does not

**The desktop had two blind spots and now has none.** It used to tell the folder
about its place only when a document was opened or closed or the program quit,
and it never looked at the folder before resuming. So a desktop paused with the
book still open told nobody, and a desktop resuming never asked. It now speaks
up a few seconds after the reading pauses, and it asks, briefly, before it
resumes.

**On the phone, the newest place wins while the book is paused.** Come back to a
paused book and, if the desktop has read further since, the highlight and the
page have moved to the desktop's sentence — quietly, because the moved highlight
is the message. Press play and the phone checks once more first, for at most two
seconds, then reads from the newest place. When the desktop's place is in a part
of the book the phone has not laid out yet, play waits for that part rather than
starting anywhere else. While the book is playing nothing moves it. A place that
arrives late is outranked by the one the phone writes once it reads on. When the
owner pauses before the phone has read past the sentence it started on, the phone
has nothing newer, and the late place wins then, as it would have if it had
arrived while paused.

**What was turned down.** The earlier rule, that once the owner had pressed play
the book's place was theirs until they closed it, was kept for playing and
dropped for pausing. Under it the owner's own case — pause the phone, read on at
the desktop, come back to the phone and press play — would have resumed at the
stale place. A line offering "continue from the desktop?" was considered and set
aside for now: it costs a tap and a sentence, and the highlight already says it.

Starting at once from the phone's own place, when the desktop's is in a part of
the book the phone has not laid out yet, is what play did until September 2026,
and it was turned down. The owner heard the old sentence instead of the
desktop's, and reading on from it wrote the old place over the desktop's newer
one, on both devices, so the place reached at the desktop had to be found again
by hand. A few seconds of waiting for the page is the price.

Forgetting a place that arrived during the first sentence, once the book was
playing, was turned down in September 2026 for the same reason. Before that
change, the owner could press play, wait out a slow server, and pause at once.
Pressing play again read the phone's old sentence while the phone's own list
of books already held the desktop's place, and reading on wrote over the
desktop's progress. The price of the fix is that the highlight can jump to the
other device's sentence at the moment the owner pauses.

**The phone speaks up more often than the desktop.** It tells the folder when it
opens, when it comes to the front, when a book is opened or added, the moment a
reading pauses or stops, when the reading page is left, and when the app goes to
the background. Not on a clock while reading: nothing on the phone is spent
keeping a server informed of every sentence.

## A switch that checks before it locks

Syncing on the phone is turned on with a switch, and turning it on does something:
the phone tries the folder with the address and the password the owner typed,
and only if the folder answers does the switch stay on. Then the address, the
name and the password are locked until the switch is turned off again, so a
place cannot stop following the owner because a character was brushed in a field.
A folder that does not exist yet passes — the password was accepted, and the
folder is made on the first upload. A failed check turns the switch back off and
says why, in the one line the screen has for saying anything.

The password is kept where the app keeps its other secrets, not in the folder it
opens.

## What the place knows about itself

The time a place was written used to be the time the owner last touched the
book — opening it, renaming it — because that is what orders the shelf. As the
time of the place it was wrong in the most ordinary case: read to chapter two
hundred on the desktop at night, glance at the book on the phone in the morning,
and the phone's chapter one hundred would have won. A place now carries its own
time, moved only when the reading actually stops somewhere new. The shelf is still
ordered by when the book was touched, and a book read further on the desktop
rises to the top of the phone's shelf when its place arrives.

There is no setting for the device's name. The desktop reader has one because it
keeps one settings backup per computer; the phone has no such need, and a name
the owner could change would change nothing they could see. The phone makes its
own once, from its kind and a few random characters, and it is there only so
that a person reading the file can tell which device wrote a line.

## What this costs

- A file named after a person in the owner's folder.
- The sentence the owner stopped on is written to their own server, where before
  only a bare location was.
- A paused book can move under the owner's eye. Deliberate, and quiet.
- Pressing play on a paused book can wait up to two seconds for the check, and
  then for the phone to lay out the part of the book the other device reached.
  In the owner's longest novel, with the desktop's place four hundred to five
  hundred chapters from the phone's, the reading started two to four seconds
  after the press.
- Sometimes the app will say it could not find the place the other device sent.
  That is the rule working.
- Papers stay on the desktop. Places in PDFs and saved web pages do not travel to
  the phone, and the phone does not read them; the owner reads papers on the
  desktop and novels on the phone, and said so. The desktop keeps its own file
  for them until the day the shared file can hold them too.
