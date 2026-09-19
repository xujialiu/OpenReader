# Each document keeps the voice it was started in

A document remembers its own voice. Opening one for the first time gives it
whatever the overall default is at that moment, and from then on the document keeps
it. Changing the default later steers the next new document and leaves everything
already underway exactly as it was.

## Who this serves

Someone reading one long novel while also reading other things.

A novel wants one narrator from the first chapter to the last. A paper does not
care who reads it. Those two wants only conflict if there is a single voice for
everything — and then every idle experiment on a paper re-narrates the novel
halfway through, so the owner has to choose between keeping a book's narrator and
ever trying a new voice again. Binding the voice to the document means there is no
choice to make: try anything, anywhere, and the novel keeps its narrator.

## This is the opposite of what the desktop plugin promises

The plugin the owner already uses on their computer advertises one voice and one
speed everywhere as a feature, deliberately, in place of the per-language choice the
program it lives in makes for it. Anyone arriving here from that plugin will expect
the same behaviour, so the reversal is on the record rather than left as a surprise.

## What one voice everywhere would have cost the owner

Its appeal is real: one setting, nothing to manage per document, no way to end up
wondering why this book sounds different from that one. Two things the owner would
have met instead.

**Changing the voice would have thrown away every sentence of speech already paid
for, everywhere.** Audio is kept under which voice spoke it, so a new voice means
none of it can be reused and all of it is bought again, in every document at once.
Someone who had spent real money preparing a long novel in advance would lose all
of it by auditioning a voice for ten seconds on something else.

**A voice tried out and abandoned would have quietly taken over a book in
progress.** The owner would return to chapter forty of a novel and find a stranger
reading it, with no indication of when or why the narrator changed.

## What is deliberately not built

A voice per language. The reader the owner uses on their computer picks a voice by
the language of the text, and this app does not.

A document with two languages in it is read in one voice, and whatever that voice
makes of the other language is what the owner hears — for a Chinese novel with
English words scattered through it, that is a compromise accepted knowingly rather
than an oversight. The alternative is working out the language sentence by
sentence, which means shipping a large piece of language-guessing machinery the
project has already decided to do without, and which would also mean a narrator who
changes in the middle of a paragraph. Neither is an improvement.

This is a decision to build nothing, and it is written down so that it does not get
filed later as a gap.

## What this costs

One more thing remembered per document, and a settings screen that has to be honest
about the fact that the default applies to documents not yet opened. That is a small
price; the alternative was the owner's own money.

*The engineering half of this decision is [ADR 0010](../adr/0010-voice-is-per-document.md).*
