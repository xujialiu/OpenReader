# Changing the reading speed is free

Speech is always fetched at the speed the voice speaks at when nothing asks it to
hurry. The owner's reading speed is applied afterwards, as the audio is played, by
the app itself — pitch kept, so the voice does not turn into a chipmunk. The
speech service is never asked to speak faster or slower.

The result the owner sees is that the speed control is free. Moving it takes effect
on the next word, costs nothing, and can be moved back just as cheaply.

## Who this serves

The owner pays the speech service directly, out of their own pocket, per word. The
app is not allowed to spend that money twice for words it has already bought. Every
part of this decision follows from that one sentence.

## What asking the service to speak faster would have cost the owner

It is the obvious route. The services have a speed setting; using theirs means the
app does no work at all. Three things the owner would have lived with.

**The control would have lagged.** The app fetches several sentences ahead so that
speech never stalls waiting for the network. Those sentences are already spoken at
the old speed. Moving the control would have done nothing for a few sentences and
then jumped — which reads as a broken control, and invites the owner to move it
again, which makes it worse.

**Every nudge of the control would have thrown away audio already paid for.** Audio
is kept so that re-reading a passage costs nothing and a whole novel can be
prepared in advance, and it is kept under which words were spoken and by which
voice. Put the speed into the request and the audio bought at one and a half times
is not the audio needed at one and six-tenths: a single nudge discards all of it and
buys it again. Someone who had prepared a long novel — hours of paid speech — could
destroy the lot with a moment's curiosity about whether slightly faster felt better.

**The control would have meant different things to different people.** The services
do not agree on what their own speed setting does. Some ignore it. Some genuinely
re-speak the text at a new pace, which changes how the voice sounds and not merely
how fast it talks. At least one simply stretches the finished audio — the same
thing the app would have done anyway, except billed. So the number on the owner's
slider would not have been a speed; it would have been a request whose meaning
depended on which company they had chosen to pay. A setting that does something
different, or nothing at all, depending on a choice made elsewhere is the kind of
setting this project deletes rather than documents.

## What this costs

The app has to change the speed of speech itself, without making the voice sound
wrong, on both kinds of phone. That is genuine, unglamorous work that cannot be
borrowed or skipped, and it is the whole price of this decision.

It is worth it because of what comes with it: speed stops being a property of the
audio and becomes a property of playing it. It can be changed mid-sentence, in
either direction, as often as the owner likes, and nothing is ever bought twice.

*The engineering half of this decision is [ADR 0009](../adr/0009-synthesize-at-natural-pace.md).*
