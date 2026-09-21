# Resuming where you actually stopped — and saying so when it can't

*The crossing between the phone and the desktop was measured and settled in
[decision 0031](0031-your-place-follows-you-to-the-desktop-and-back.md); the retreat
at the end was not needed.*

When the app saves the owner's place in a document it saves two things: where in
the document speech stopped, and a quotation of the words that were being spoken
there. Reopening the document goes to the place, then checks that the words found
there are the words that were written down. If the two disagree, the app searches
the document for the words instead. If it cannot find them, it says so, and offers
the start of the section rather than a place it has no confidence in.

## Who this serves

Someone who listens on a phone and reads the same documents on a computer. Keeping
one place across both is not a convenience feature here — it is the reason this app
exists rather than a subscription. A place reached on one device is a place reached
on all of them, or the promise is broken.

It matters most in exactly the case that is hardest to get right: a place written
by the phone and read by the desktop, or the other way round. The two were built
separately, by different people, and have never been pointed at each other, so the
crossing is the least trustworthy part of the whole arrangement and the only part
the owner actually cares about.

## What trusting the saved place would have felt like

Storing just the location is cheaper, simpler and right most of the time. It was
turned down because of how it behaves when it is wrong, which is not to fail.

The owner comes back to a novel after a week, presses play, and hears a paragraph
they have already heard — or one they have not reached. The highlight sits on a
sentence with complete confidence. Nothing is greyed out, nothing warns, nothing
looks broken. The owner scrolls back and forth hunting for the sentence they
remember, which is precisely the chore this app exists to abolish.

Do that a few times and the damage is larger than the lost place: the owner can no
longer tell a correct resume from a wrong one, so they start checking every time. A
kept place that is silently wrong now and then is worth less than no kept place at
all, because no kept place is at least honest. A resume that admits it is unsure is
annoying once. A resume that is confidently wrong poisons the feature.

## What counting sentences would have felt like

The obvious cheap alternative is to remember how far in the owner got — the two
hundred and fourteenth sentence, say. It was turned down because the phone and the
desktop do not agree about where one sentence ends and the next begins; they were
built on different sentence-splitting work and neither is going to change.

So the two hundred and fourteenth sentence is a different place on each side. The
owner would find that a place kept on the phone lands slightly off on the
computer — and the drift would grow the further into a document they were, so the
feature would be least reliable exactly where a long novel makes it most valuable.

## Coming back to the sentence, and not just to the page

For a while the app did half of this and looked like it did all of it. Opening a
book went to the right page, with the right paragraph in the middle of the screen
— and then pressing play started reading from the top of the chapter. Everything
the owner could see was right, so the failure only announced itself in the one
moment it mattered, out loud, in the wrong place.

Both halves are now done, and they are one thing rather than two: the app comes
back to the sentence it stopped on, shows it marked before anything is played, and
says in one line that it did. Pressing play reads that sentence.

## What this costs

Two things stored per document instead of one, and a slower resume in the case
where the check fails and the app has to go looking.

And a failure the owner will occasionally see: sometimes the app will say it is not
sure where they were. That is the decision working, not a defect, and it follows
the rule the whole project is held to — the app never invents a fact it does not
have.

There is one more, and it is a race rather than a refusal. A very long book takes
time to lay out the part the place is in — six seconds, measured on the owner's own
novel opened at a place a hundred chapters in, where this was once guessed at
twenty — and until it has, there is nothing to match the saved words against.
If the owner presses play, taps a word or picks a chapter before that, the app
reads from there and says that the saved place had not arrived yet. It does not
wait, and it does not quietly move the reading once the place turns up: being
dragged somewhere else a few seconds after you asked to start is worse than
starting where you asked.

## The retreat, if the crossing turns out not to work

If it becomes clear that a place genuinely cannot survive the trip between the
phone and the desktop even with the check, then places sync between the owner's own
phones and tablets, and settings continue to sync with the desktop. That is
written down as a retreat rather than a plan, so that nobody later mistakes it for
what was intended.

*The engineering half of this decision is [ADR 0008](../adr/0008-positions-are-cfis-verified-by-text.md).*
