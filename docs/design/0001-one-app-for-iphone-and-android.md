# One app for an iPhone and an Android phone, built on speech work that exists

*The engineering half of this decision is [ADR 0001](../adr/0001-react-native-rather-than-native-ios.md).*

The app is written once and runs on both an iPhone and an Android phone. It is
built on top of work that already exists — the part of the desktop reader plugin
that asks a provider for speech and gets audio and word timings back — rather
than started from nothing.

## Who it is for

The author, who reads on more than one phone and on a desktop, and for whom a
place kept on one device and not the others is the failure that started this
project. An app for the iPhone alone was never a candidate: it would have solved
the problem on some of his devices and left the rest as they were.

## What was given up

There is more than one way to write a single app for both phones, and the one
chosen is not the one best suited to this app's hardest job. One of the others
draws every character of text itself, which is precisely what an app whose
purpose is to paint a moving mark over words as they are spoken would want. It
was turned down anyway.

It was turned down because of what already exists. The desktop plugin's speech
code is not valuable for its size; it is valuable because it is a written record
of every way a dozen providers have been caught behaving differently from their
own documentation. None of that is written down as documentation. It is written
down as corrections inside the code, and each correction is there because someone
was listening one day and heard something wrong.

Building on a different foundation means writing that code again in another
programming language, and the corrections do not survive translation — they would
have to be re-found the way they were found the first time. In the owner's terms,
that is what would have happened:

- The mark under the words slides two lines away from what is being said and
  stays there for the rest of the page, because a provider read a number out as
  words and everything after it counted wrong.
- The mark races to the end of a sentence and waits there, because a provider
  reports where it is in the sentence in units other than the ones it claims.
- A sentence comes back as silence, or as nothing at all, and playback stops,
  because a provider answered in a form the app did not expect.

Every one of those is a bug that has already been found and already been fixed
once. Starting over puts all of them back, and the person who finds them the
second time is whoever is listening.

## The app asks for a recent iPhone on purpose

The app will not install on older iPhones than it strictly needs. That is a
choice, not something inherited.

The reason is the mark again. Recent iPhone systems can paint over a stretch of
text without taking the page apart. Older ones cannot: the only way to mark a
word on them is to rebuild the page around each word as it is spoken, which is
slow, visible as text shifting under the reader while they read, and a second,
worse version of the hardest part of the app — one that would then have to be
kept working forever alongside the first.

Asking for a recent system deletes that second version before it is written. It
costs nothing today. This is not a market being turned away; it is one person's
phone, and it is a recent one. If the app ever needs to run on an older phone for
a wider audience, adding that path to an app that already works is much easier
than having carried two of them from the beginning.

## What this means for how long the work takes

Writing one app for two phones usually means most of the work is shared. Here it
means less than usual, and that is better expected than discovered. The two
hardest pieces — controlling playback from the lock screen while knowing its
position accurately enough to keep the mark honest, and marking a word inside a
displayed document — are both places where the app has to be written separately
against each phone system. Anyone estimating this project from "it is one app for
both phones" will estimate it short.
