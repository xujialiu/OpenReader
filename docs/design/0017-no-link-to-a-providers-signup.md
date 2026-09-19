# No link to a provider's signup lives in the app

Nothing in the app takes the person to a provider: no "create an account" button,
no pricing page, no trip to the place a key is issued. No provider's prices
appear in the app or in its store screenshots. What the app has instead is plain
text saying what to go and get, and the walkthrough that holds the person's hand
lives on the project's own site, away from the app.

Anyone who later sets out to make setting up easier will read this as an
oversight and try to repair it. It is not an oversight. It is the one part of the
app that was designed by a rejection.

## Why

The store's rules forbid unlocking anything inside an app by a route other than
the store's own payment, and they name licence keys while doing it. Reviewers
have applied that to apps built the way this one is more than once — including
to a free app with nothing for sale at all, where the reviewer described the
person's own credential as "a paid key".

This app is free, sells nothing, and offers no second paid path a reviewer could
hold it up against. That posture is deliberate, and this decision is the rest of
it: what a reviewer is looking for is the ride to the till, and the app does not
offer one.

It is also what the nearest comparable product does. The closest analogue on the
store is a reader that has advertised using your own keys for cloud voices for
years, and it keeps its entire setup guide — the links to the provider, the
warnings about what it costs, all of it — on its own website rather than inside
the app.

## What this decision is not

The one rejection in this category with a documented ending asked for something
far narrower than it is usually remembered as. The directive it received was
*remove the "Get API Key" link from the binary* — the link, out of the thing
people download. That app deleted the link, put plain text where it had been, and
shipped, keeping the field the key is pasted into, the saving of it, the provider
picker, the voice picker, the checking, and every other piece of the machinery.

**The credential field was never the problem. The tappable route to the
provider's paid signup was.**

That sentence is the whole boundary, and it is the reason this file exists rather
than a one-line rule. Read backwards — as "asking for a key is the risk, so ask
for less" — it leads the next person to strip out something the store never
objected to, and to make the app worse in the name of a rule that was never
broken.

## What it costs the person setting the app up

The easiest possible first run. Elsewhere a first screen offers a button, the
person taps it, signs up, copies a key and comes back holding it. Here they are
told what to fetch and left to go and fetch it, in a browser, by hand, before
they have heard a single sentence.

For someone who has never obtained a key before, that is the hardest few minutes
in the product and it lands at the worst moment in it. The audience is therefore
limited to people willing to do it — the same limit that choosing to use the
owner's own providers already imposes, drawn a little sharper.

Keeping prices out costs something smaller and stranger: the app cannot tell
anyone what a voice will cost them before they pick it. That sits awkwardly next
to the promise that this app never spends the owner's money without them knowing.
It is accepted because the alternative is a price on a screenshot in a review
queue, and because the price list stays reachable where price lists are kept.

## What is still owed before this can ship

One thing, and it is not optional. Before the first sentence of a document goes
to a provider, the app has to say plainly what is about to leave the device and
who it is going to, and wait to be told yes — once for each provider the owner
uses. The store's rules were amended to name third-party AI services explicitly,
and an app in this category has already been told that burying this in a privacy
policy does not count.

It is not built yet. While the only person using the app is the person who would
be asked, the consent is being sought from the one granting it, and it is one
question on one path that can be added when there is somebody to ask. This is a
deliberate debt with a known price rather than something overlooked — and it is
the last thing standing between the app and a submission.

*The engineering half of this decision is
[ADR 0017](../adr/0017-no-provider-links-in-the-binary.md).*
