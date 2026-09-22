# The mark follows the words, and that is what the app is for

*The engineering half of this decision is [ADR 0005](../adr/0005-word-level-highlighting-is-required.md).*

While the app is speaking, the word being spoken is marked — the word, not the
paragraph, not the sentence, and not a word that was the right one two seconds
ago. This is a requirement, settled once, and the rest of the app is arranged
around it.

## Who it is for, and why it is the requirement

The author, who listens every day and has paid for two readers that each failed
at one thing. ElevenReader, the second of them, does keep its place across
devices — and its mark drifts out of step with the voice as a chapter goes on,
until following it is worse than having no mark at all. That cannot be fixed from
outside the app, so the app exists. Shipping a reader whose mark drifts would be
shipping the product being replaced.

This is also, by a wide margin, the most expensive decision in the project, which
is why it is written down at all. Anyone arriving later will otherwise assume
word-level marking came free with something else and wonder why two large parts of
the app are shaped so strangely.

## What was given up

The cheap version: mark the whole sentence being spoken, and leave it there until
the next one. It is a fraction of the work. It needs no knowledge of where inside
a sentence the voice has got to, and it never looks wrong, because a
sentence-sized mark stays right for as long as the sentence lasts.

Choosing the word instead means the app must know where the voice is to a fraction
of a syllable, and must be able to mark any stretch of text inside a page it did
not lay out itself. Those two needs — not reading the document, and not producing
the speech — are what decided how audio is played and how documents are
displayed. Two of the biggest pieces of this app are the shape they are because of
one sentence in this file.

## Not every voice can do it, and that is not ours to choose

Whether the word can be marked depends on the provider, not on the app. Some
report which word they are saying and when; some hand back audio and nothing
else. Where a provider says nothing, the app marks the whole sentence and is
honest that this is the best that voice allows.

The app never fills the gap by guessing. It does not estimate or interpolate a
timing, because a mark in the wrong place is the exact failure the app exists to
fix, and an invented mark is in the wrong place by definition.

The bill that comes with this, stated plainly: the desktop reader marks word by
word with Microsoft's voices and this app cannot, because the only way to get word
information out of that provider is a piece of software that does not run on
phones. An owner moving from desktop to phone on those voices will watch the app
get worse at the thing the app is for. None of the ways out are attractive — route
those voices through a machine of ours, which decision 0002 forbids; spend unknown
time finding out whether that software can be made to run on a phone, which
nobody has reported doing; or accept sentence-level marking for those voices, as
the desktop already does for others.

_Since [design 0037](0037-azure-voices-mark-the-word-on-the-phone-too.md), this
bill is no longer paid. The desktop never needed that software: it asks
Microsoft's service directly. The phone now asks the same way, and Microsoft's
voices mark the word here too._

The compensation was not planned and is worth knowing. The voices already on the
phone, that came with it, do report their words — and they cost nothing, need no
account, and work with no signal. The cheapest voice available is in the group
that supports the app's headline feature.

## Why this one does not drift when others do

One thing worth a non-engineer's attention, because it is the whole difference
between this app and the one it replaces. The app does not work out where the
voice is by watching a clock. "Half a second has gone by, so it must be about
here" is exactly how a mark drifts: every estimate is slightly wrong and the
errors pile up over a chapter until the mark is a line away. The app instead asks
the audio how far through itself it is. The mark cannot slowly walk away from the
sound, because it is not being told where the sound ought to be by then.

And it has to hold at speed. The owner listens at two or three times the pace a
voice speaks at naturally, which is where a drifting mark comes apart fastest, and
it is the same requirement there as at natural pace.
