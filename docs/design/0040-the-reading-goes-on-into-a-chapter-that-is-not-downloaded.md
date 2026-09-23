# The reading goes on into a chapter that is not downloaded

_The engineering half of this decision is
[ADR 0040](../adr/0040-a-quiet-provider-connection-is-warmed-before-it-is-used.md)._

## What the owner saw

Reading a downloaded chapter and carrying on into the next one, which was not
downloaded, the reading stopped on the new chapter's first line and said "The
network connection was lost", with nothing wrong with the network. It did the
same on the first press of Play after a pause of a minute or two, and on the
first Play a minute or so after the app had opened. Pressing Play again got it
going.

The app keeps its line to a speech provider open between sentences, so that each
sentence does not pay for opening a new one. Something on the way — on the
owner's Mac, a proxy — silently forgets a line that has carried nothing for about
a minute. The next sentence sent down it waits about seven seconds and fails. The
phone notices a dead line and tries again on a fresh one, but only for a request
that merely asks for something; a request that sends a sentence to be spoken is
never tried again, and that is every request a reading makes.

A downloaded chapter is read from the phone itself and asks the provider for
nothing, so every downloaded chapter longer than a minute leaves exactly that
silence behind it. That is why the reading stopped where the downloads ended.

## What changes

**Before a sentence goes to a provider after half a minute of silence, the app
knocks first.** The knock is a tiny request that asks the provider for nothing,
carries none of the owner's keys, and costs nothing. If the line had died, the
phone opens a fresh one for the knock, and the sentence goes down that. The app
waits for the knock for at most fifteen seconds; whatever it hears back, the
sentence goes next. Two sentences sent together share one knock.

**While downloaded audio plays, the app knocks every twenty seconds or so**, so
the line never falls quiet long enough to be forgotten, and the first sentence of
the next chapter goes straight out.

Nothing is sent while the phone is offline, and nothing to a provider the app has
not already talked to since it opened: with no line open, there is nothing to
lose.

## What it costs

- **A short wait after a long pause.** The first sentence after half a minute of
  silence waits for its knock: a fraction of a second when the line is alive,
  about seven seconds when it had died — the same seven seconds the failure took,
  now ending in speech instead of an error.
- **A little traffic while downloaded audio plays.** One tiny request every
  twenty seconds or so, to a provider the owner already uses. It spends nothing
  and carries no key.

## What was turned down

**Sending the sentence again when it fails.** The simplest fix, and no slower.
But at the moment of the failure the phone cannot know whether the provider had
already received the sentence, and a provider that charges per sentence could
then charge the owner twice for one, without the owner ever knowing. The app
never spends the owner's money twice for the same audio.

**Knocking only while downloaded audio plays.** It fixes the chapter boundary,
but not a reading resumed after a pause, nor the first Play after the app has
been open a while.

**Switching off the kind of line that dies.** The app cannot choose it from where
it makes its requests, and doing so would make every sentence slower to protect
the one line that is idle.

## Who it is for

The owner, whose Mac sits behind such a proxy. Whether the owner's phone meets
the same failure depends on what stands between it and the provider, a proxy or
VPN app or a router, and has not been measured. A phone that never needed the
knock pays one tiny request after a long pause.
