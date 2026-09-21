# Voice lists are ready when you open them

_The engineering half of this decision is
[ADR 0033](../adr/0033-voice-lists-are-fetched-at-start-through-one-loader.md)._

## What the owner saw

Every time the app had been started afresh, the first tap on the voice list —
or on a language in it — sat waiting while the app asked the provider what
voices it had. Fish Audio's answer takes several requests, so the wait was long
enough to notice every time, and every later tap in the same session was
instant.

The wait was a rule, not an accident: the app asked a provider for its voices
only when the owner opened the list, on the grounds that opening it was the
request, and that nothing should be fetched for a provider the owner was not
looking at.

## What changes

As the app starts, it asks every provider the owner has switched on for its
voices, in the background and all at once. By the time the owner opens the
list, it is normally already there, for every provider in it. If the list is
opened while the answer is still on its way, the list waits for that same
answer rather than asking again.

A failure at start is not reported, because nobody is looking at a list yet.
Opening the list asks again and says what went wrong, exactly as before.

Coming back to the app from the background fetches nothing: the lists are still
there from the start.

It also lets a short phrase read by a Fish voice be named in the right language
without a question of its own (design 0032).

## What was given up

**Fetching nothing the owner did not ask for.** The app now talks to every
switched-on provider as it starts, including a server at home that may be
switched off, which then fails quietly. The owner asked for this in exchange
for the wait.

## What was turned down

**Only the provider in use.** The first list the owner opens would be ready,
and every other provider's would still wait on its first tap.

**Keeping the lists from one run to the next.** They would be ready even before
the start-up answer arrives, but they go stale, and refreshing them needs the
same request anyway.
