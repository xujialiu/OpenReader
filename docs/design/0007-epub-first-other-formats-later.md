# EPUB first; PDF and web pages come later

The reader opens EPUBs. PDFs and web pages are expected, and the app is built so
that adding them later is an addition rather than a rebuild, but on the first
version neither one works. A document that is not an EPUB is not read at all.

## Who this serves, and who it does not

The owner reads long novels — in practice Chinese web novels, hundreds of
chapters in a single file — and those are EPUBs. That is the reading this app was
built for, and it is served completely on day one.

Anyone whose reading is mostly papers is served not at all, and that is the real
cost of this decision. It is stated plainly rather than softened, because the
alternative was worse: a PDF reader that technically opened the file and then read
it aloud badly.

## What reading a PDF aloud would actually have sounded like

A PDF does not know what its own sentences are. It records where each piece of
text sits on a page, not the order a person reads them in, so an app that speaks a
PDF has to work that order out by guessing — and every wrong guess is something
the owner hears.

Shipping PDF at the same time would have meant the owner listening to a running
header read out in the middle of a paragraph, then a page number, then a citation
marker spoken as a bare number. A sentence broken across a page would have ended
early and the next page would have started as though it were a new one. In a
two-column paper the voice would have finished the left column and jumped
somewhere unrelated. None of that would look broken on screen; it would simply be
wrong every few paragraphs, for hours, with nothing the owner could do about it.

Sorting that out is the single largest piece of work in the whole project, and
this decision does not solve it — it postpones it. The desktop plugin the owner
already uses refused the same work for the same reason, and could get away with it
because the program it lives inside had already done it. On a phone there is no
such program to lean on. Whenever PDF arrives, that work is still waiting.

## What keeping the door open costs

Parts of the app look more general than an EPUB-only reader needs: a document
records which kind it is even though there is only one kind, and the record of
where the owner stopped reading is deliberately meaningless to everything except
the part of the app that displays that kind of document. To anyone reading the app
later this will look like effort spent on nothing.

It is not, and it is written down here so that nobody helpfully simplifies it. The
thing being bought is that the second format does not require reopening the first
format's decisions. The price is a little unused machinery now; the alternative is
discovering, at the moment PDF is wanted, that every part of the app quietly
assumed there was only ever one.

## One thing EPUB gets for free

EPUB is the one format the phone and the owner's desktop plugin both already
handle, which is why the place the owner stopped reading can in principle be
understood by both of them. Whether it survives the trip intact is a separate
question, and it has its own decision — number 0008.

*The engineering half of this decision is [ADR 0007](../adr/0007-epub-first-formats-stay-pluggable.md).*
