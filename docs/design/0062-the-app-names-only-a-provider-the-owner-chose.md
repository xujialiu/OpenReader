# The app names only a provider the owner chose

_This decision is a product one, and has no ADR. It follows from
[decision 0026](0026-a-coherent-reading-interface.md), which took away the
default voice and made the player the one place a voice is chosen._

## What went wrong

On a new phone, before any book was added, the Library said: _OpenAI is
disabled. Choose an enabled provider. Set up a voice in Settings to listen._

Every part of it was wrong. The owner had never chosen OpenAI; it was only the
provider the app happens to start with. Nothing was enabled, so there was
nothing to choose from. And voices are not set up in Settings: they are chosen
in the player, one book at a time. Enabling a provider did not help either,
because enabling one does not pick it, so the Library went on blaming OpenAI
until the first book was added. Opening that book said the same thing again, and
its voice button read _OpenAI · choose a Voice_.

## What the app says now

- **No provider enabled.** The Library and the player both say _No provider is
  enabled. Enable one in Settings to listen._ This is true whichever provider a
  book used before, because enabling one is the only way on.
- **Some provider enabled, empty Library.** Nothing about listening. There is no
  default voice, so until a book is opened there is nothing more to say that
  would be true.
- **A book with no voice yet.** The voice button reads _Choose a Voice_ and no
  note is added: the button already says it, and pressing Play opens the voice
  list.
- **A book whose own provider was switched off while another is on.** Unchanged:
  _Fish Audio is disabled. Choose an enabled provider._ Here the provider is the
  owner's own choice, so naming it says which choice stopped working.

Each sentence appears once in the player, even when two parts of the app arrive
at it at the same moment. With no provider enabled, the voice list says
_Enable a provider in Settings to choose a voice._ and is only a line tall, so
the player's own sentence stood just above it saying the same thing; while the
list is open the player leaves it to the list.

## What was turned down

**Keeping the Library's check with better words.** It checked the provider of
the last voice chosen, a leftover of the default voice that decision 0026
removed. A first-time owner could never make it say anything but a complaint,
since the only thing that would have satisfied it, choosing a voice, needs a
book.

**A note saying _Choose a voice._ in the player.** It would sit above a button
that says the same thing.

**_Fish Audio is disabled. Choose another voice._** The voice list is grouped
by provider, so _choose an enabled provider_ describes what the owner actually
does there.
