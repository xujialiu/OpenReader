# The highlight must never drift

The author used ElevenReader and abandoned it for Speechify because its word
highlighting drifted out of sync with the audio. Not by much, and not at first: the
highlight would be on the right word at the start of a sentence and a word or two
behind by the end of it. That is enough. Once the mark on the page is no longer the
word in your ear, it is not helping you follow along, it is competing with you, and
a paid product became unusable because of it. This app exists because of failures
like that one, so the highlight not drifting is not a quality target here. It is the
product.

## What was decided

The app works out where it is in a sentence from the sound it is actually playing,
rather than by asking a player where it thinks it has got to and filling in the
gaps with a clock.

That sounds like an implementation detail and is not: it decided what the whole
playing half of the app is built on, and it cost real work that the ordinary choice
would have given away free.

## Who this serves

Someone listening at one and a half to three times normal speed, with the text in
front of them, for hours at a stretch, often on wireless headphones.

Every one of those conditions makes drift worse. The faster the speech, the more
words go past in the time the app is guessing. Wireless headphones mean the sound
reaches the ear a moment after the phone believes it played it. And an error that
would be invisible in one sentence is what matters over an afternoon, because it
accumulates: it grows through a sentence instead of cancelling out. A reader who
listens for ten minutes would not notice. This app is for the reader who listens all
day, and that reader notices.

## What the ordinary choice would have felt like

The ordinary choice is to hand each sentence to the phone's own audio player as its
own little file and let the phone get on with it. It is the default, it needs
nothing extra, and its behaviour is thoroughly known. Three things the owner would
have got with it.

**A highlight that lagged, worse the faster they listened.** A player of that kind
can only report where it believes it is, every so often, and the app has to guess in
between from the clock. Every source of error in that guess pushes the same way, so
the mark falls further behind the further into a sentence it goes. This is precisely
the defect that made a competitor unusable, arrived at by a different route.

**A gap or a click between every single sentence, in every document, forever.** The
audio a speech service returns carries a little silence at its edges as a
side-effect of being compressed, and the services do not say how much. A player that
switches from one file to the next plays that silence, out loud, at every sentence
boundary. The only way around it is to buy the speech uncompressed — several times
the size, on the owner's bandwidth and the owner's money — to fix an artefact the
owner never asked for.

**A phone that thought it was playing music.** Phones treat spoken audio and music
differently, and a reader wants the spoken behaviour. On the ordinary player the app
could not have said which it was.

## What was given up for it

The whole of the system integration, and this is the honest cost rather than a
footnote. The phone's own player *is* the system player, so it comes with the lock
screen, the controls in the pull-down, the headphone buttons and the car dashboard
already working, for nothing. Going the other way meant every one of those had to be
built by hand — enough work that it is a decision of its own, number 0016.

That was foreseen before the choice was made, not discovered afterwards, and it was
accepted because the lock screen turned out to be separable and the drift did not.
A reader with a perfect lock screen and a highlight that slides is the product the
author already threw away. A reader with a highlight that holds, and a lock screen
that had to be built by hand to get it, is the one worth building.

## What the owner gets

The mark sits on the word being spoken, and stays there — through a sentence, a
chapter, a novel, at any speed. Sentences run into one another with no seam. Nothing
about it needs to be turned on, tuned, or forgiven.

## One risk worth naming

What the app is built on instead is newer and less travelled than the phone's own
player, and it has had at least one serious fault of exactly the kind this app would
have run into. It was found, traced and fixed before this app adopted it, and the
engineering record has the specifics. Taking that risk is justified by this being a
requirement the author has already paid for twice in abandoned subscriptions — not
by a preference.

*The engineering half of this decision is [ADR 0012](../adr/0012-playback-engine-is-an-audio-graph.md).*
