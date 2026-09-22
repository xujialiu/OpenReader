# Azure's voices mark the word on the phone too

_The engineering half of this decision is
[ADR 0037](../adr/0037-azure-word-timings-come-over-a-hand-written-websocket.md)._

## What changed

Design 0005 said the phone could mark Microsoft's voices only a sentence at a
time. The reason it gave was that the one known way to learn where their words
fall was a piece of Microsoft's software that does not run on phones.

The desktop plugin, it turns out, never used that software. It talks to
Microsoft's speech service directly, the way that software does, and the service
answers with the time of every word. The phone can ask the same way.

So Azure, the name Microsoft sells these voices under, is now one of the
phone's providers, and its voices mark the word the way they do at the desk.

## What the owner gets

- **One setup, on the phone.** The key and the region are the ones the desktop
  uses, typed once on the phone. Nothing comes across from the desktop, because
  the phone keeps its keys to itself.
- **All of Azure's voices,** about 690 in the owner's region. Each is named as
  Azure names it, such as 晓晓 in Chinese characters or Ava Multilingual, and
  grouped by language. The voices that speak many languages are listed under
  "multilingual".
- **Word-by-word marking for almost all of them.**

## Where the mark is the whole sentence instead

**The voices called "MAI-Voice-2"** say nothing about where their words fall.
The phone marks the sentence, as it does for every OpenAI voice. They are
offered anyway, with no mark in the list, as on the desktop, because the owner
may like how they sound.

**The preview voices called "Dragon Latest"** time the words correctly for
about the first ten seconds of a sentence. After that they report every
remaining word at the same instant. The desktop passes that on: its mark jumps
to the end of the sentence and waits there while the voice catches up.

The phone notices the pattern and marks such a sentence whole instead. Short
sentences keep their word marks. If Microsoft fixes these voices, the phone goes
back to marking their words, with nothing to change.

## The free tier

The owner uses Azure's free tier, which allows 500,000 characters a month.
That is roughly ten hours of English at the voices' natural pace, or about
fifteen of Chinese, because Azure counts each Chinese character twice. When the
allowance runs out, Azure refuses. The phone then stops at the sentence it
could not get and says the allowance is used up, rather than skipping ahead.

Microsoft also documents a limit of 20 requests a minute on the free tier. The
phone asks once per sentence, so reading at two to three times the voice's pace
would often pass that limit.

Measured, the limit was not applied: forty requests in sixteen seconds were all
answered. So the phone does not slow itself down in advance. If Microsoft starts
applying the limit, the phone waits and asks again, and the reading pauses
between sentences instead of stopping.

Sending more text in each request, to stay under the limit, was considered and
set aside (recorded as issue 40). It saves nothing against the monthly
characters, and it would make every start and every jump slower.

## What was given up

**Marking Azure only by sentence,** which design 0005 had accepted as the
price. It needed nothing new. It was turned down because the way around it
turned out to exist, and to be in daily use on the desktop already.

**Hiding the voices that cannot mark words.** The list would be shorter. But
the owner would lose voices they might prefer, and the phone would be deciding
what a voice can do by its name, rather than by what it actually sends.

**Leaving the Dragon Latest mark to jump, as the desktop does.** A mark in the
wrong place is the one failure the app exists to avoid.

## What it costs

**Microsoft can change the way the phone talks to Azure without warning.** It
is the way Microsoft's own software talks, and Microsoft does not publish it. If
it changes, Azure stops working on the phone and on the desktop at once, and
both need fixing.

**Azure's audio arrives unpacked.** That is about eight times the data of the
compressed audio the desktop asks for, the same as the phone's other providers
send: roughly 170 megabytes per hour of speech at the voice's natural pace, over
whatever connection the phone has.
