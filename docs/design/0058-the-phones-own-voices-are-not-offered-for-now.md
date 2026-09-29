# The phone's own voices are not offered, for now

_This decision is a product one, and has no ADR. It changes the plan in
[decision 0014](0014-the-phones-own-voices-come-later.md), which said the
phone's voices would come next. What was measured is in the engineering log for
2026-09-29._

## What was looked at

Decision 0014 promised the voices already built into the phone: free, working
without a network, needing no account, and able to say exactly where each word
falls in the sound. Before building them, the author checked what the phone
actually has and listened to it.

The owner's phone carries 193 voices in 39 languages, Chinese included, and
the technical promise holds for almost all of them: a sentence comes back many
times faster than it takes to say, and it comes with the place of every word.
The exception is one family of voices, the one with names like Grandma and
Reed, which in Chinese, Japanese and Korean marks only the first word of a
sentence, so those voices could only light up whole sentences.

## Why they are not offered

The owner listened to every kind of English voice the phone has: the ordinary
voices such as Samantha and Daniel, the older Siri voices, the Grandma and Reed
family, and Apple's old voices from the Mac. He also listened to the best voices
the phone could download, played from the Mac, since the phone does not have
them yet. **None of them sounded good enough to listen to a book with.**

A voice people will not listen to for an hour is not worth building. Offering
the phone's voices properly, as decision 0014 requires, means a new piece on
each platform, a place for them among the Providers, and rules for a book whose
voice the phone has since changed. All of that would go into voices the owner
would not choose.

## What was turned down

**Offering them anyway, as a free way in.** Someone without a provider account
could then hear a book at once. It was turned down for the reason above: the
first voice a new person hears would be one the owner would not choose to listen
to himself, and the app would look worse for it.

**Offering only the better voices a phone can download.** They were the best of
what was heard, and still not good enough, and the owner would have had to
download each one in the phone's settings before the app could use it.

## What it costs

The cost decision 0014 already named stays: there is still no way to hear a
sentence without an account with some provider, and no way to listen without a
network unless a book's audio was saved first.

## What would reopen it

A phone voice that the owner finds good enough to listen to for an hour. The
phone's voices do change: while they were being measured the phone quietly
replaced most of them with better copies of themselves. Whoever reopens this
should listen again first, then read decision 0014 and the engineering log. One
thing from the log is easy to miss: a replaced voice comes back under a new
internal name, so a book must remember its phone voice by the voice's name and
language.
