# A book can be shared as it was added

_The engineering half of this decision is
[ADR 0059](../adr/0059-sharing-copies-the-file-under-its-library-name.md).
Issue #95._

## What the owner asked for

Once a book was in OpenReader, nothing in the app could send it anywhere. The
owner could not AirDrop it to the Mac, save it to Files, mail it or open it in
another reader. The copy the app keeps is not visible in Files either, so a book
that arrived in a message was only in OpenReader.

Now the drawer that the `…` opens, from a book's row in the Library and from
the reader, has a share button at the right end of its top line, beside the
book's name. It opens the phone's own share sheet with the book in it, and the
phone offers what it always offers there: AirDrop, Save to Files, Mail, and
other apps.

## Where the button is

It is at the right of the book's name, in a grey circle like the drawer's back
button. The phone's own panels put their buttons in the same place, in the
corners of the title line. A long name wraps to a second line before it rather
than running under it. The button stays beside the name's first line.

It is on the drawer's first page only. That page is titled with the book's name,
and the button shares what the title names. Appearance, Rename and Download are
titled with their own names, so a share button there would seem to share
Appearance.

A `Share` row in the drawer's list, under Rename and Download, was turned down.
The owner asked for the button beside the name, and there it sits next to what
it shares.

## What goes, and what stays

Only the book goes, exactly as it was added: not a converted copy, not a copy
with the owner's place written into it. Everything that belongs to the owner's
reading stays on the phone: the book's row in the Library, the place the reading
had reached and any narration saved for listening offline.

Because the book goes unchanged, OpenReader on another device, or the owner's
Zotero-TTS plugin on the desktop, recognises it as the same book. If the owner
sends it to their own iPad and adds it there, the place they reached on the phone
is already waiting for it.

## The name it goes under

The book goes under the name the Library shows for it, with its type after it,
and a rename is included. A book renamed to "Beast Master 3" arrives as
`Beast Master 3.epub`.

Two other names were turned down:

- **The name the app stores it under.** That name is made from the book's
  contents, so that two devices recognise the same book. It is a long run of
  letters and digits, and whoever received it would not know which book it was.
- **The file's name when it was added.** The app has never kept it, so every
  book already in the Library would have had no such name. It is also often
  worse than the book's own title: a downloaded file can be called
  `9780571364039.epub`.

A few characters cannot be in a file's name, or are shown as something else on a
Mac, so they become dashes. "Volume Three: The Long Road" arrives as
"Volume Three - The Long Road". A very long name is shortened to what the phone
allows for a file.

## The drawer stays open

The share sheet rises over the drawer, and the drawer is still there when the
sheet goes. That holds whether the book was sent or the sheet was cancelled.
Closing the drawer first was turned down: someone who cancelled would have lost
the drawer as well and would have had to tap `…` again.

## When it cannot share

The button is always there. If the book cannot be shared, the drawer says why,
in one line above its rows.

In practice that is almost never. A book's file is kept before its row is added
to the Library, and Files cannot reach it to delete it. Two things can still lose
the file: an update that renames the stored books and then fails to save the
Library, and changes made to the app's storage from a Mac during testing.
Hiding the button when the file is gone was turned down. It would mean checking
for the file every time the drawer opens, for something that almost never
happens. The failure line covers that case and every other reason sharing can
fail. The Library row already says when a book's file is gone.

## What it costs

- **The button is the app's own drawing.** The phone draws the share sheet
  itself, but the drawer and its button are the app's own, drawn the phone's way
  (decision 0042, second step). If the phone's share symbol changes, this one
  stays as it is until someone redraws it.
- **Room for one book.** To send the book under its name, the app puts a named
  copy aside and leaves it there until the next share, because an AirDrop or a
  mail may still be reading it after the sheet has gone. The phone clears that
  space itself when it needs it. At most it holds one book.
