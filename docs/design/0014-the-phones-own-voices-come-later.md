# The phone's own voices come later, and arrive properly

_Since 2026-09-29, [decision 0058](0058-the-phones-own-voices-are-not-offered-for-now.md):
the owner listened to the phone's voices and they are not being built for now.
What follows is still how they would arrive._

The first working version reads only through providers the owner has an account
with. The voices already built into the phone — free, offline, no account, no
spending — are not in it.

They are coming. When they do, they arrive as a full member of the app: a
sentence is asked for, the sound comes back, the app keeps it, prepares the next
ones before they are needed, and knows where each word falls inside it. That is
the shape every other voice already has. Building it that way is real work on
both platforms rather than an afternoon on either.

## Who pays for the wait

Everybody who does not already have a provider account, which for now is
everybody except the author. Until the phone's own voices land there is no way
to hear a single sentence without signing up somewhere and pasting in a key, and
no way to listen at all once the network is gone.

That is the largest cost in this decision. It was still the right way round: the
first version had to prove that the highlight does not drift, and the providers
that already exist could prove it immediately.

## The afternoon version, and what it would have felt like

There is a cheap way to use the phone's voices. Hand the text over and let the
phone speak it. It works today, it reports which word it is saying as it says
it, and on a good afternoon it would be finished.

What the person would get is a second, worse reader hiding inside the first one.
A phone speaking out loud is not something the app holds: there is no sound to
keep, so nothing can be prepared in advance, nothing can be heard again without
being spoken again, and nothing the app does to sound — its speed above all —
reaches it. Worse, the marks saying which word is being spoken arrive *while* it
is spoken instead of travelling with the sound. Pause, skip back a sentence, or
replay one, and the words and the highlight part company.

A reader whose highlight comes loose is the exact product the author left. It
would be strange to ship one inside this one, for free, as the voice a new
person tries first.

There would also be two of everything to keep working — two ideas of what
playing means, two sets of faults — and the cheap half would be the one
eventually thrown away.

## Why the long way is worth more than the shortcut

Done properly, the phone's own voices are not the poor relation. They are the
most exactly timed voices in the app, better than anything paid for: a remote
provider reports the words it believes it spoke, while the phone reports where in
the sound each word begins. And because those marks travel with the sound rather
than arriving as it plays, they still line up after the sound has been kept,
paused, skipped through and replayed.

Free, private, works on a plane, and carries the best highlight in the product.
That is worth waiting for, and not worth faking with the afternoon version in
the meantime.

## One more thing that was turned down

Someone has already published a ready-made piece that does exactly this. It is
weeks old, has one author and effectively no users, and the place it would sit is
the place that has to be most exact. It is worth reading closely. It is not worth
depending on.

*The engineering half of this decision is
[ADR 0014](../adr/0014-os-voices-arrive-as-a-native-module.md).*
