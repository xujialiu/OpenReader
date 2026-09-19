# The player, and knowing where you are without a progress bar

_The engineering half of this decision is
[ADR 0020](../adr/0020-the-player-rides-the-existing-seek.md)._

The reader had two controls: play, and a speed. Everything else a person does
while being read to — go back a sentence because they missed it, jump to a
chapter, change the voice, get the controls out of the way — had nowhere to
happen. This is the strip along the bottom that holds all of it.

## There is no progress bar, and that is the decision everything else follows from

A progress bar answers "how far through am I", and on the owner's own novel —
one file, over two thousand chapters — the honest answer is a number so small it
tells you nothing. Dragging it is worse: a hair's movement of a thumb crosses
forty chapters. The bar would be decoration that occasionally destroys your
place.

So it is gone, and two things replace it, because a reader still has to know
where they are and still has to be able to move.

**Tapping a sentence reads from there.** Not a percentage — the actual words you
are pointing at. It is more precise than any bar could be, because you are
aiming at content rather than at a position.

**The contents list opens at the chapter you are in, with it highlighted.** That
one gesture answers both "where am I" and "where do I want to go". A list that
opened at the top of the book would answer neither.

The cost is real and worth stating: **there is no longer anywhere to glance and
see how far through the book you are.** For a long novel that is a small loss;
for a short document it is a slightly larger one. It is accepted because the
alternative was a control that lies on the one book this app was built around.

## Tapping blank space does nothing

An earlier version of this had tapping empty space hide the player. It was
dropped, and the reason is worth keeping: in a Chinese novel the text runs nearly
edge to edge, so "empty space" is a few thin gaps between paragraphs. A gesture
that is meant to be easy would have been a game of hitting a target, and missing
would have moved your place in the book.

## The player floats over the page rather than pushing it up

If the player took its own space, every time it appeared or disappeared the text
would reflow and the reading would jump. Floating means the text never moves; the
price is that the player covers the last few lines while it is open, and the
sentence being spoken is held above it rather than in the middle of the glass.

## Collapsing leaves one button, and pausing brings everything back

There is a way to get the controls out of the way, and what remains is a single
play button — nothing else, no arrow to tap. Pressing it pauses, and pausing
opens the player again.

That is one behaviour doing two jobs, and it was chosen over the obvious
alternative (a small arrow that restores the player) for a specific reason:
**while the controls are hidden, tapping the page moves your place.** Someone
reaching out to stop the reading, finding no pause button, would tap the text —
and lose where they were. A button that is always present and always pauses
removes that trap without adding anything to look at.

The assumption underneath it: pausing usually means you are about to do something
else — go back a sentence, change the voice, open the contents. So the controls
arriving at that moment is convenient rather than intrusive. If that turns out to
be wrong, the player can simply stay shut.

## Going back a paragraph restarts the paragraph you are in

The desktop plugin this is modelled on does something different, deliberately:
pressing "previous paragraph" halfway through a paragraph takes you to the
paragraph _before_ it, treating a paragraph as a single thing to skip over.

That is not copied. A sentence lasts a second or two, so going back one costs
nothing and gives you context. A paragraph in this novel can run half a minute,
and the most common reason to press the button — "I lost that, read it again" —
would be impossible in one press. Going back a sentence keeps the desktop
behaviour; going back a paragraph restarts the current one, and pressing again
goes to the previous. One rule applied to two units whose lengths differ twentyfold
would have been wrong at one end.

## The voice list shows only the voices you can actually use

Choosing a voice means choosing among the services the owner has set up. A
service that has not been given its key or its address cannot say what voices it
has, so it is not listed at all — and if none has been set up, the list is empty
apart from a line pointing at the settings.

**The alternative was to list everything and grey out what is not ready**, so
that someone could see that other services exist. That was turned down: this app
is for the owner, who knows what they have signed up for, and a list mostly full
of things that cannot be picked is a worse list than a short one that works.

The cost is that nothing in the reading screen advertises a service you have not
configured. Discovering what is supported happens in the settings, which is where
it belongs.

## The speed is a stepper, not a menu

Two arrows and a number, in small steps. It goes slower than natural speech as
well as faster — a dense paragraph or an unfamiliar language is a reason to slow
down, and the reading machinery costs nothing to run slowly.

A menu of five or six preset speeds was rejected because people settle on a pace
that is theirs and it is rarely one of the presets. Holding an arrow moves
quickly, so a large change is still about a second.

## What is deliberately not here

**Anything that rewrites your place without you asking.** Every control in this
strip either moves the reading exactly where you pointed it, or does not move it
at all.
