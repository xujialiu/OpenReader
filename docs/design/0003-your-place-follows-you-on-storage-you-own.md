# Your place follows you, through storage you already own

*Revised by [decision 0031](0031-your-place-follows-you-to-the-desktop-and-back.md): the
folder now holds one file that both products write, and the list the desktop was
asked to publish is not needed.*

*The engineering half of this decision is [ADR 0003](../adr/0003-sync-over-the-owners-webdav.md).*

Where the owner stopped listening, and the settings they have chosen, are kept in
one folder on storage the owner runs themselves. Every device they read on reads
and writes that same folder. Stop mid-sentence on the phone on the way home, open
the desktop reader, and it carries on from where the phone left off.

## Who it is for, and why this comes first

This is not a feature added to the app. It is the reason there is an app.
Speechify, which the author paid for, did everything except keep his place across
his devices, and that one failure is what made building something new worth it.
Anything that cannot keep one place everywhere is not this product.

The owner it is for is therefore someone who already runs storage of their own, or
will. That is the same audience limit as bringing your own provider, and it has
the same answer: acceptable while the app is built for its author, and a blocker
before it could be handed to anyone else.

## What was turned down

**The phone maker's own syncing.** Far less work, and more reliable than anything
we would write. It was turned down because it does not reach an Android phone.
The owner would have had their place kept perfectly between an iPhone and an
iPad, then picked up the other phone in their pocket and found the chapter back
at the beginning — the exact failure they left the last reader over, reintroduced
on purpose to save effort.

**Somewhere of ours to sync through.** Then the record of what the owner reads,
where they stopped and when they were reading it would sit on a machine we own.
They would have to trust us with it rather than check, and their place-keeping
would stop working on the day that machine is switched off. This is the same
objection as the subscription in decision 0002, and it gets the same answer.

## The folder now belongs to two products, and that costs something visible

The folder used to be one product's private business. Now the phone app and the
desktop reader plugin both write to it, which makes it a promise between two
products rather than an internal detail — because the owner feels it directly when
it goes wrong.

The failure looks like this. The phone, being the newer of the two, writes
something into the folder that the desktop copy on the owner's laptop was built
before and does not understand. The desktop copy's rule when it meets something
it does not understand is to leave it alone, which is the right rule: it quietly
stops syncing that file until its owner updates the desktop copy. Nothing tells
them. What they notice is that their place has stopped following them, with no
message anywhere saying why.

There is a worse shape of the same failure. Instead of stopping, an older copy
carries on writing and drops the parts of the file it does not recognise — every
time, on every machine, silently, so that a device that had understood the
newer information loses it again without anyone touching anything.

That is why anything new goes into a file of its own rather than being added to
an existing one. A file an old copy has never heard of is ignored harmlessly; a
change inside a file it believes it already understands is what breaks people.
And it is why this has been raised as a request against the desktop product: the
shape of that folder needs to be written down and agreed, rather than being
whatever the two programs happen to do this month.
