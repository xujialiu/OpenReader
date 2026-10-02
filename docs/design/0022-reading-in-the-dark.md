# Reading in the dark

_The engineering half of this decision is
[ADR 0022](../adr/0022-the-theme-is-two-stylesheets-and-one-resolved-answer.md)._

Settings has always had an entry called General, and until now opening it led to
an admission that there was nothing in it. It now holds one thing, and it is the
thing that decides what the whole app looks like: **light, dark, or whatever the
phone is doing**.

## Dark has to reach the book, or it has not happened

This is the part that could have been got wrong cheaply. Everything around the
book — the shelf, the settings, the header, the player — is ours to colour, and
colouring it is a morning's work. The book is not ours. It is a file the owner
brought, made by someone else, with its own idea of what a page looks like.

A dark app around a white page is worse than no dark at all. The page is the
only part the owner is actually looking at, so what they would get is a black
frame around the one bright rectangle on the screen, at the exact moment — a dark
room, late — when that rectangle is the problem. So dark reaches the book, and a
book that ships its own colours is repainted.

## So the book's own colours lose, and that is the decision

It is worth saying plainly, because this app's habit is the opposite. How the
text is *set* — the face, the size — starts at "the document's own" and stays
there until the owner overrules it, on the argument that a publisher chose those
for that book and a reader that silently replaces them has decided something
nobody asked it to decide.

Colour is not that. Choosing black on white is not usually a statement about the
book; it is what a book is. And whatever it was, it was not a statement about the
room the owner is sitting in at two in the morning. Dark is a demand the room
makes, and demands from the room win.

**Light does not make the same demand**, so light does not repaint anything. A
book that ships a cream page, or one that was designed dark on purpose, keeps
exactly what it shipped. The two are deliberately not symmetrical: dark is
something the owner is asking for, and light is the absence of that asking.

The cost is that light cannot be used to rescue a book whose own colours are
unpleasant. That is a real gap and it is not filled by pretending: flattening
every book to pure white would take the cream page from the one book that chose
it well.

## Two things dark cannot reach, said rather than discovered

**A picture keeps its own colours.** An illustration or a diagram that was drawn
on a white background is still a white rectangle on a dark page, and it will
glare. Nothing short of altering the picture itself would change that, and
altering someone's picture is further than this goes.

**A book that uses colour to mean something loses that meaning.** If a book
prints one thing red to distinguish it from another, both become the same
colour under dark. Novels do not do this; a programming book or an illustrated
reference might. The honest position is that dark serves the book this app was
built for and costs the ones it was not.

## The highlight is repainted for dark rather than left

_Revised in [decision 0068](0068-the-highlight-colours-are-the-owners.md): the
mark is no longer repainted for dark. The owner chooses one colour and one
strength for the sentence and for the word, and they are the same on both
pages. The blue below is now the Blue preset, at amber's strengths rather than
solid, and it is the default on both pages. The checks and actions around the
book follow the word's colour rather than staying amber._

The mark that follows the voice is the reason the app exists, so it does not get
to be an afterthought of the theme. Its colour on a light page is tuned to be
visible against black text on white; the same colour against light text on a
near-black page is muddy, and the word being spoken — which is the smaller and
more important of the two marks — comes out close to unreadable. So dark gets
its own pair, and **on a dark page the mark is blue rather than amber**: the
sentence a muted blue-grey, the word a vivid blue, and the word's letters the
same light colour as every other letter on the page.

The first answer here kept the amber and made the word's mark solid, with its
letters set to the page's near-black so they could be read against it. It
worked, but it made the one word the owner was following the only dark word on a
light-lettered page, so it looked like a word that had changed colour rather than
the same text marked. The owner asked for the letters back. Amber cannot give
them: it is a bright colour, and light letters on it are nearly unreadable; an
amber dark enough to carry them is brown. Blue is seen as dark while it stays
vivid, which is how the reading app the owner compared this with marks its words
on a dark page, and the light letters read clearly on it.

The cost is that the mark is no longer the app's own colour in the dark. The
light page keeps its amber, and so do the checks and actions around the book in
both themes — the owner chose to change the mark and nothing else — so under dark
the page says "this is being read" in blue and the app around it says "this is
chosen" in amber.

## Neither black nor white, in either direction

Dark is not black and its text is not white. A page of pure white letters on pure
black is the pairing that makes a long reading tiring, which is the opposite of
what someone reading a novel for an hour needs. The page is very dark and the
text is a little short of white, and the app around the book uses the same two,
so the page and its surroundings read as one surface rather than as a document
pasted onto a screen.

## "Follow the system" is a real answer, not a way of avoiding one

A phone that switches itself at sunset is something the owner set up on purpose,
and an app that ignored it would be the one light window in their evening. So
following is offered, and it is the default — the only default that is not a
guess about a room nobody has seen.

It is offered **third**, after the two answers, because a list that begins with
"it depends" is a list that has to be read twice. And choosing Light or Dark
outright is honoured whatever the phone does afterwards: an owner who chose Light
does not get switched at sunset.

## Where it is, and where it is not

The theme is in General, with the other things that are true of the whole app.
How big the text is stays where it was, over the book, under Appearance: it is
judged by watching the book change size while you change it. The reading speed
stays in the player for the same reason — it is judged by listening.

The rule that separates them is whose question it is. How this book is set is a
question about this book. What the app looks like is a question about the room.

Nothing here is remembered when the app is closed, which is true of every setting
in the app today, and the screen says so rather than leaving it to be found out.
