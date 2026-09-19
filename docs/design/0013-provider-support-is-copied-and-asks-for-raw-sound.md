# Provider support is copied from the desktop plugin, and asks for raw sound

The desktop plugin this app keeps its place in sync with — the Zotero-TTS
plugin — already knows how to talk to every speech provider the author pays
for: which voices each one offers, how each one wants to be asked, and, this
being the valuable part, what each one gets wrong. None of that was written from
documentation. It was found by sending real text to real services and listening
to what came back.

The app takes a **copy** of it. Not a share: the two products each keep their
own, and neither waits for the other.

The copy changes one thing on the way in. Where the desktop plugin asks a
provider for a finished audio file, the app asks for raw sound — the voice with
nothing wrapped around it.

## Who this is for

One person who reads on a phone and at a desk, and who is using the desktop
reader today, every day, while this app is still being built. Most of what
follows is about not disturbing that.

## What sharing would have cost

Sharing looks free. One copy of the provider knowledge, fixed once, used twice.

In practice the bill would have been paid by the desktop reader, which is the
half that already works. Every change made for the phone — starting with the
change to raw sound, which is an improvement on a phone and a pure loss on a
desktop, where a finished file is exactly what is wanted — would have had to be
proved harmless on the desktop before it could ship anywhere. The person who
notices that is the author, mid-paper, on the tool he already relies on:
provider fixes arriving slower than they were found, and the occasional evening
spent on a fault the desktop reader had no part in causing.

An app that did not exist yet was not owed that.

## What the copy costs instead

Two copies of the same knowledge. Every provider quirk found from here on has to
be fixed twice or it is only fixed once, and when a provider quietly changes its
behaviour the two products can disagree about it for as long as it takes someone
to notice.

That is the real price and it was paid deliberately. What keeps it survivable is
that the copy is held apart from the rest of the app rather than stirred into it,
so if the two products ever do want one shared copy, that is a move rather than a
rescue.

## Why raw sound rather than a finished file

A finished audio file does not begin exactly where the voice begins. Packing
sound into a file leaves a sliver of silence at each end, and unpacking it does
not take the sliver away.

This app asks for one sentence at a time — a sentence is the unit it requests,
keeps and resumes from. So the sliver does not land once at the start of a
chapter. It lands at every sentence, for as long as the person listens. It
is not loud enough to complain about and not quiet enough to miss: the voice
keeps almost stopping. Asking for raw sound removes it, and removes a step
between the provider and the ear that could have gone wrong on its own.

## What is kept anyway, and for whom

Not every provider can hand over raw sound. Someone running a speech server on
their own machine — which this project treats as an ordinary way to use it
rather than an edge case — may only be able to send a finished file, and the app
takes one and unpacks it rather than turning them away.

So the app carries both paths: the good one it asks for first, and the one it
falls back on. That is a second thing to keep working, and what it buys is the
promise that no particular provider is required.

*The engineering half of this decision is
[ADR 0013](../adr/0013-provider-layer-is-copied-and-returns-pcm.md).*
