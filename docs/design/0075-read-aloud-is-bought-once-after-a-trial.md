# Read-aloud is bought once, after a thirty-day Trial

*The engineering half of this decision is
[ADR 0075](../adr/0075-read-aloud-is-bought-once-after-a-trial.md). Issue #148;
the author's decisions of 2026-10-09 are its plan comment.*

## What was decided

OpenReader stays a free download. Everything that turns a Document's text into
sound costs money after thirty days: playing a Reading, preparing Offline
Narration with a Download, and playing Offline Narration already saved. Before
that the Trial lets the owner use all of it for nothing. After it, the Unlock is
one purchase, US$4.99 for now and the store's local equivalent elsewhere, made
once and kept for good on every device signed in to the same Apple Account.

Everything else stays free:

- the Library and its Folders
- opening a Document and Browsing it
- Appearance
- Word Lookup, Text Translation and a dictionary's Pronunciation
- sync
- Share

### When the Trial starts

The Trial does not start when the app is installed, or when it is first opened.
The app offers it the first time the owner actually asks it to speak, by
pressing Play or starting a Download once a Provider is ready to use. Getting a
key from a Provider can take a day or two: an account to open, a payment method
to add, a key to find. None of that time comes out of the thirty days.

Before the Trial begins, the phone's own alert says three things: reading aloud
is free for thirty days, after that reading aloud and offline narration need a
one-time purchase at the price shown, and reading documents stays free. The
owner chooses Start Free Trial or Not Now. Nothing speaks until they start it.

Each Apple Account has one Trial. Deleting and reinstalling the app does not
start another, and neither does moving from an iPhone to an iPad.

### When it ends

A Reading that is playing when the thirty days run out is not cut off in the
middle of a sentence. The next time the owner presses Play after pausing, or
starts a Download, the alert says the Trial has ended. It offers the Unlock at
the local price, Restore Purchase, and Not Now. A Download that is running when
the Trial ends pauses where it is, and carries on once the Unlock is bought.

Offline Narration saved during the Trial stays on the phone. It does not play
until the Unlock is bought, and then it plays as before.

Nothing reminds the owner as the end approaches. The front page of Settings has
one row that shows how many days are left, or that the app is unlocked. From
it the owner can buy the Unlock early, or restore it on a new phone.

### Where it stays free

OpenReader is open source, and two other ways of getting it never ask for money:

- **The TestFlight beta.** The test copies the author sends out through Apple's
  beta service are the same app as the store's, with the same Trial and the
  same Unlock. Apple charges nothing for a purchase made in a test copy, so a
  tester can unlock read-aloud for free.
- **Building it yourself.** Someone who builds the app from its source can turn
  the lock off with one setting at build time. The lock is on unless the setting
  turns it off, so a copy the author builds for the store cannot go out unlocked
  by mistake.

Those two ways are written down on the project's page on GitHub, and nowhere
else. The App Store page says the app is open source and where its source is.
The app itself never mentions a free way to get read-aloud: not in its alerts,
not in Settings, not in the row that counts the days.

## Why

**Why the store's copy is paid.** Most people will get the app from the store,
and it is the copy that does the work for them: no beta to join and no build to
make. That convenience is what the Unlock pays for, and it is the one way the
project can fund itself. Anyone who would rather not pay can still join the
beta or build the app themselves.

**Why there is a Trial, and why it waits for the first Play.** Read-aloud does
nothing until the owner has an account with a Provider, a key and a voice they
like, and the Provider charges them for every sentence. Asking for money before
they have heard their own book read would be asking them to pay for a promise.
That invites refunds and angry reviews. Thirty days, counted from the first
time they ask to hear something, is enough to set up a Provider, listen in
earnest and decide.

**Why reading stays free.** What the app sells is the voice. Opening a book,
looking up a word and keeping one's place across devices are what any reader
does. Locking them would make the app useless before it had shown what it is
for.

**Why saved narration falls silent too.** Otherwise the Trial would be a month
in which to download every book the owner has, and listen to them for ever
without the Unlock.

**Why the app never mentions the free ways.** Apple's terms allow its beta
service only for testing, and they forbid using it to hand out copies so that
people can avoid the store. Its review rules also require every part of an app
to be visible to the reviewer. An alert that told the owner, thirty days in,
that a free copy waits in the beta would end one of two ways:

- **The reviewer sees it.** An app on the store telling people to go elsewhere
  so as not to pay is refused.
- **The reviewer never sees it,** because no reviewer waits thirty days. That
  is the kind of hidden behaviour that can end a developer account, not just
  one app.

The project's page on GitHub can say what the author likes; the app cannot.

**Why test copies are not unlocked outright.** To the app, a beta copy, the
reviewer's copy and a copy built at the author's desk all look alike: it cannot
tell a reviewer from a tester. A copy that unlocked itself for testers would
unlock itself for the reviewer. The reviewer would never see the purchase, and
would refuse the app for it. Sending testers a separate copy without the lock
would mean uploading every version twice, and that is the very use of the beta
service its terms forbid. The beta charges nothing anyway, so one copy serves
both.

## Alternatives turned down

- **The Trial counted from the day the app is installed.** Nothing to tap to
  start it. But the thirty days would run while the owner was still getting a
  key from a Provider. Test copies are also told the app was installed in 2013,
  so to every tester and reviewer the Trial would look as if it ended years
  ago.
- **A subscription.** Design 0002 turned this down for what it would make of
  the project, and nothing here changes that. The Unlock is bought once, from
  the store. There is no account with us, and nothing of ours stands between
  the owner and their Provider.
- **Locking Word Lookup and Text Translation as well.** They reach services on
  the network too. But they are part of reading, not of reading aloud, and the
  line the owner can see, that the voice is what is paid for, is the one that
  holds.
- **Letting narration saved during the Trial play for ever.** Kinder to someone
  who downloaded a book in the last week. But a month of Downloads would then be
  a lifetime of listening.
- **Stopping a Reading the moment the Trial ends.** Exact, but it stops someone
  mid-sentence, perhaps mid-walk, over a few more minutes of audio.
- **A full page for the purchase, or a drawer.** Room for more words. But the
  phone's own alert is what the app already uses to ask for Consent. It says
  the three things the store requires before a Trial, and one tap dismisses it.
- **A reminder in the last days of the Trial.** The days left are already in
  Settings. A reminder would interrupt the listening it was meant to protect.
- **Saying on the App Store page, or in the alert, that the beta is free.** See
  "Why the app never mentions the free ways".
- **Separate unlocked test copies for the beta.** See "Why test copies are not
  unlocked outright".
- **Sharing the Unlock with the owner's family.** Generous, but the store lets
  it be turned on and never turned off. It stays off for now and can still be
  turned on later.
- **Guarding the Trial against a phone clock wound back.** That is possible
  only by asking a time service on the network, which the app does not use, and
  it is pointless while the free ways exist.

## What the owner gives up

- **The voice costs money after a month.** US$4.99 for now, once, in the
  store's local equivalent.
- **Two alerts.** One the first time they ask to hear something, and one each
  time they ask after the Trial without the Unlock.
- **One more row on the front page of Settings.**
- **Narration downloaded during the Trial stays silent** until the Unlock is
  bought.
- **Each member of a family buys their own** while sharing stays off.

## What it costs the project

- **The app no longer sells nothing.** Design 0017's argument partly rested on
  there being nothing for sale, so a reviewer had no paid path in the app to
  hold the owner's own key up against. Now there is one. What still holds is
  the rest of 0017: nothing in the app leads to a Provider's signup or prices.
  Now nothing leads to a free copy either.
- **One question is left open.** The app's first version is in review as a free
  app. If it reaches the store before this ships, the author decides after its
  approval whether the people who installed it then keep read-aloud for good.
- **Contributions need terms of their own.** The store copy is safe under the
  project's licence while every line in it is the author's. Issue #149 covers
  what an outside contribution must allow.
