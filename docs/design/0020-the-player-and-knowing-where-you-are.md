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

## The contents list is one list, and a volume title is a place you can go

The owner's novel has thirteen volumes and two thousand chapters, so the contents
cannot be one flat run of two thousand lines. It is one list with the volumes as
headings and the chapters beneath them — not a menu that makes you pick a volume,
then go back, then pick a chapter. Two thousand rows in one list is a single flick
of a thumb; two screens is two decisions before you have got anywhere.

**A volume title is itself somewhere to go**, not only a label. The book puts a
title page at the start of each volume, and if the heading were only a heading
that page would be the one place in the book the contents could not reach.

The two entries this book opens with — its cover and its description — have no
chapters under them, so they are plain rows rather than headings with nothing
beneath. A book with no volumes at all is simply one list with no headings, and a
book with volumes inside volumes indents the inner ones.

## The list can be certain where you are, and when it cannot, it is vague rather than wrong

Opening the contents at the chapter you are in is the whole reason the progress bar
could go, so it matters what happens when the book does not make that answerable.

On the owner's novel every chapter is its own piece of the book, so the answer is
exact: one row, the one you are reading. Two other things can happen in other
books, and in both the list is deliberately vaguer rather than confidently wrong.

**Some books put several chapters into one piece.** Then the list can tell which
piece you are in but not which of its chapters, and it marks the part rather than
guessing at the chapter. Guessing would mean sometimes saying "chapter four" while
you are reading chapter three — and a wrong answer to "where am I" is worse than a
broad one, because you would have no way to tell it was wrong.

**Some pages are not in the contents at all** — this book's copyright page is one.
Reading such a page marks the nearest thing before it that the contents does list.
Nothing is highlighted as if it were exact.

The related cost, in the same vein: when a book's contents points at a chapter
partway down a longer piece, tapping that row takes you to the start of the piece
rather than to the exact line. On the owner's novel this never happens. Where it
does, you land slightly early rather than somewhere unpredictable.

**And a book with no contents at all is normal.** Some have none; the list is then
empty and says so. It is not an error and nothing else stops working — tapping a
sentence still reads from there, which is the other half of knowing where you are.

## A tap has to land on the words, and the phone disagreed

Tapping blank space does nothing — that was decided above, and building it turned
out to need one more rule.

Asked where a tap landed, the phone does not answer "on nothing". It answers with
the nearest words. So a tap in the margin beside a chapter title came back as a tap
*on* that title, and the reading jumped to it. Nobody had pointed at anything.

The rule that fixes it is that a tap has to land inside the paragraph it would read
from. Between two lines of a paragraph still counts — that is the paragraph. Past
the end of a short last line still counts. The margin, the gap between two
paragraphs and the empty page below the last one do not, and there the tap does
nothing, which is what was promised.

**The alternative was to let the phone's answer stand** and read the nearest
sentence to wherever you touched. It was turned down for the reason the blank was
made inert in the first place: a gesture that is easy to miss must not move your
place in the book when you miss it. Reading something you did not point at is
worse than reading nothing.

## The player says what it is doing, and hiding it hides that too

The running status line below is superseded by
[the interface redesign](0026-a-coherent-reading-interface.md): the owner chose
to remove routine playback status and successful-resume messages. Failures and
missing setup appear when they need attention, without occupying space during
normal reading.

The strip carries one line saying which sentence is being read, of how many, and
whether the highlight is following the word or lighting the whole sentence —
because on some voices only the whole sentence can be lit, and a reader watching
that happen deserves to be told rather than left to wonder whether something is
broken. Anything that has gone wrong, or anything still missing before the app can
speak at all, is written underneath it in the same place.

Collapsing the player hides those too. That is deliberate and it is what collapsing
is for: it is the gesture for "I want the page and nothing else". The single button
that remains says nothing, because the moment there is something to say the reader
can press it and get everything back.

## What the voice line can say, and what it costs to say more

The presentation below is revised by [the interface redesign](0026-a-coherent-reading-interface.md):
the player now shows the voice name, remembers names already obtained, and does
not show internal identifiers. A list is still not requested merely to complete
a caption.

Above the play button is the service that is reading and the voice it is reading
with. What it cannot always add is the language that voice speaks — because half
the services do not say, and the only way to find out is to ask that service for
its list, which is a request made against the reader's own account.

So the language appears once you have opened the voice list for that service, and
not before. Asking on your behalf so that a caption could be complete would be
spending your money on a caption.

Choosing a voice from a different service switches to that service, because a voice
belongs to one service and choosing between them is the same act.

And a service that has been given its key but is still missing something else it
needs — a model, say — is **not** offered in the list. It could tell you its
voices; it could not then read with them, and offering it would be a trap: you
would choose, press play, and be told that something is missing. The list is a list
of things that will work.

## Tapping a chapter you have not been to takes a moment

The page goes there straight away. The reading follows a second or two later, once
the app has laid that chapter out and can tell where its first sentence is — there
is nothing to start reading from until then.

A volume's title page has no words on it at all. Tapping it takes you there, which
is what you asked for, and nothing is read: there is nothing to read. It is a place
in the book rather than a failure.

## What is deliberately not here

**Anything that rewrites your place without you asking.** Every control in this
strip either moves the reading exactly where you pointed it, or does not move it
at all.
