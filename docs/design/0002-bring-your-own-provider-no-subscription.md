# Bring your own provider; there is no subscription and nothing of ours in between

*The engineering half of this decision is [ADR 0002](../adr/0002-bring-your-own-api-keys-no-backend.md).*

The owner brings their own account with whichever provider they want to be read
to by, and pays that provider directly for the speech it produces. There is
nothing to subscribe to here, no account to open with us, and no machine of ours
that anything passes through — not the documents, not the text being spoken, not
the credential that pays for it.

## Who it is for

Someone who already has, or is willing to go and get, an account with a speech
provider of their own. That is a real limit and it should be said plainly rather
than discovered: this is not a general audience, and most people will not do it.
The app is built for its author first and opened up afterwards, so the limit is
acceptable now. It would have to change before the app could be handed to
someone who only wants to press play.

## What was given up

The easy version. A subscription, where the owner pays us and we pay the
providers, would work for anybody and need nothing set up. It was turned down
three times over:

- It makes this something to be operated rather than something one person
  maintains, and the day it stops being operated it stops working for everyone
  who bought it.
- The documents and the text being read aloud would have to pass through a
  machine we own. The promise that the owner's documents stay the owner's would
  become a promise they have to take on trust instead of one they can see for
  themselves.
- Spending would stop being theirs to watch. As it is, the app cannot spend money
  the owner has not given a provider, and the bill arrives from the provider they
  chose, itemised by the provider they chose.

In exchange for the setup work, the owner gets an app that spends only what they
asked it to, keeps its promises visibly rather than contractually, and does not
stop working on the day someone else stops paying for something.

## Speech the app has already paid for is not kept

Audio lives only while the app is running. Close it and it is gone; play the same
chapter tomorrow and the app asks the provider for it again, at the owner's
expense.

The obvious objection is that this quietly wastes the owner's money. In practice
it does not, because the person this is built for almost never listens to the
same thing twice. Once that is true, keeping heard audio buys nothing and costs
room on the phone.

It also changes what keeping audio would be *for*. The thing actually worth
having is not avoiding a second charge for a re-listen. It is producing a whole
document in advance and then listening to it with no signal and no further
spending — on a plane, underground, abroad. That is a different feature, wanted
for a different reason, and it carries questions nobody has answered yet: how
much of the phone's room a document's worth of audio may take, and where audio
should be kept when what is wanted is "keep this until I say otherwise, and never
let it be swept into a backup."

So the halfway version — quietly hoarding what has been heard — is skipped
outright rather than half-built now, and listening ahead arrives later on its own
terms.

## One thing that will surprise someone

The credential the owner pastes in is kept where the phone keeps passwords, and
it stays usable while the phone is locked. It has to: the app is asking for the
next sentence while the screen is dark and the owner is walking.

Deleting the app does not delete it. The app therefore needs a visible way to
remove a stored credential, and "I deleted the app" must not be treated as one.

## Paying for reading aloud (2026-10-09)

Since decision 0075, reading aloud is bought once, after a free month. That is
not the subscription turned down above:

- It is a single purchase made through the store, not a payment that recurs.
- There is still no account to open with us.
- Nothing passes through a machine of ours.

The owner still pays their provider for every sentence spoken. The purchase
pays for the app, not for the speech.
