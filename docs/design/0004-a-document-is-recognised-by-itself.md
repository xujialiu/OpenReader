# A document is recognised by itself, not by a library it happens to sit in

*The engineering half of this decision is [ADR 0004](../adr/0004-content-addressed-document-identity.md).*

The app works out which document the owner has opened from the document itself. It
does not ask a library, a catalogue or an account which document this is, and it
does not need any of those to exist.

## Who it is for, and what it buys them

Someone who gets documents from wherever documents come from — a download, an
email, a colleague — puts one on the phone, and finds that the app already knows
it is the same document the desktop was reading. No account in between, nothing to
file it into first, nothing to set up before the first document can be opened.

## What was turned down

Identifying documents the way the desktop reader plugin does: by the key the
reference manager it lives inside gives them. On the desktop that is both less
work and exactly right, because the reference manager is already running there.

On the phone it would have meant the app could only read documents that came out
of that reference manager. In the owner's terms: install the app, and before
hearing a single sentence, go and set up a reference library and its own syncing,
and then put every document through it. A document downloaded on the phone with no
reason to be in a research library — a novel, something a friend sent — could not
be opened at all. A reading app that requires a research library first is a
different and much smaller product.

## Where the boundary falls

The phone recognises documents by themselves. The desktop plugin recognises them
by its library's key. The two can only be matched up for a document that is in
both places.

So a document the owner put on the phone by hand, which does not also live in
their library on the desktop, keeps its place across their phones and does not
carry that place to the desktop. That is the edge of what was designed, not a
defect in it, and it is written down here because otherwise it arrives as a bug
report.

## The trade-off that will look like a bug

A document's identity is made of two things at once: the file exactly as it
stands, and the identifier the document declares about itself inside.

The first is exact and brittle. Download the same title from a different shop, or
open and re-save it in another program, and it is not the same file any more — so
to the app it is a different document, starting at the beginning, with the place
the owner had reached still sitting under the old one.

The second survives all of that, and real documents in the wild often do not carry
one, or carry one that another document also carries.

Neither is enough alone, so both are recorded and the exact one decides when they
disagree. Each covers the way the other fails. What the owner sees is that their
place carries across a re-save far more often than it otherwise would, and that
when it cannot be carried the app starts them at the beginning rather than putting
them somewhere that might be wrong. That is deliberate, and it is the app's rule
everywhere: a place that might be wrong is worse than no place at all.

## Recognising it from its table of contents, rather than from every page

A book is recognised by reading a small part of it: the packing list every ebook
carries at the end, which names each piece inside it and records a small check
number for each one. Change a single sentence anywhere in the book and one of
those check numbers changes, so the packing list identifies the book without the
book having to be read through.

**The reason this was worth changing is a number the owner would have felt every
time.** Reading the whole of the owner's own novel to recognise it took **14.4
seconds**, during which the app was frozen — not slow, frozen, because the work
and the drawing happen in the same place, so not even a spinner could appear.
Reading only the packing list takes well under a tenth of a second. It is a
hundred and seventy times less work for an answer that is, in the way that
matters here, the same answer.

**What it buys beyond speed.** Ebooks get re-packed: a converter, a different
tool, a re-download from the same shop, all produce a file made of different
bytes holding exactly the same book. Reading every page said those were different
books, and the owner's place in one meant nothing to the other. The packing list
says they are the same book, so the place carries over. The engineering record
had already admitted this weakness in the old rule; it is now gone rather than
noted.

**What it gives up.** Two files that hold the same pieces are now the same book,
even if they differ in ways nothing in this app can see. In practice that is what
was wanted. The case where it would be wrong — someone deliberately building two
different books that claim the same pieces — needs intent, and the books here are
the owner's own.

There is also a smaller, duller cost: the few books already on the shelf were
recognised by the old rule and are not recognised by the new one. They are added
again, which takes a moment and loses nothing, and it happens once.
