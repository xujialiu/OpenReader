# The pauses between sentences and paragraphs are yours to set

_The engineering half of this decision is
[ADR 0047](../adr/0047-the-pauses-are-settings-and-a-paragraph-pause-is-whole.md).
Issue #60._

## What changed

General has two new rows under **Reading aloud**: **Pause between sentences**
and **Pause between paragraphs**. Each one opens the phone's own small menu of
lengths ([design 0035](0035-a-short-choice-opens-where-you-tapped.md)). The
sentence pause goes from none up to a second, and the paragraph pause up to two
seconds. The choice is kept when the app closes, and it applies from the next
time a book is opened.

Until now the app always added nothing after a sentence and a fifth of a second
where a paragraph began, and nothing could change either.

## Who it is for

Some voices leave almost no silence at the end of a sentence. Asked one
sentence at a time, the Fish Audio narrator the owner listens to leaves about a
tenth of a second between sentences. The other voices tried leave about four
tenths. With nothing added, that voice runs one sentence into the next.

The desktop plugin already lets its user set both pauses, and the owner uses
both. A pause set on the desktop now has a place on the phone as well.

## What the two numbers mean

- **The pause between sentences is added to the voice's own.** It comes on top
  of whatever silence the voice leaves by itself, so it lengthens every voice's
  pause by the same amount rather than making them all the same.
- **The pause between paragraphs is the whole pause at a paragraph.** Where a
  new paragraph, heading or list item begins, and at the end of the book, it is
  the pause that is added, in place of the sentence pause and not on top of it.
  The number on the row is therefore the pause heard there, with nothing to add
  up.
- **A paragraph pause shorter than the sentence pause is played as set.**
  Paragraphs then get the shorter pause.
- **Both are lengths at normal speed.** At a faster speed they shorten in step
  with the voice, so the rhythm of the reading stays the same. The rows do not
  say this: it is how the reading already behaved, and a line under the rows
  would describe something the owner hears anyway.
- **They start at none and a fifth of a second.** That is what the app did
  before, so nothing sounds different until the owner changes it.
- **Downloaded chapters change at once.** The pause is added as the reading
  plays, not saved with the audio, so a chapter saved earlier does not need to
  be downloaded again. The note under the bracket setting says the opposite
  about brackets, so the pauses have their own card and that note stays under
  the bracket setting only.

## What it costs

- **One pair for every voice.** A sentence pause chosen to slow Fish Audio down
  lengthens every other voice's pause too. Adding three tenths of a second
  brings Fish Audio to about four tenths and the others to about seven. An
  owner who moves a book to a different voice may want to change it back.
- **The pause is chosen away from the book.** Settings opens from the Library,
  so trying a new length means leaving the book, choosing it, and coming back
  to listen.
- **The desktop means something else by the paragraph number, for now.** There
  it is an extra on top of the sentence pause. The plugin has been asked to
  follow the phone. Until it does, the same two numbers give the same pauses
  on both only while the sentence pause is none.
- **Only set lengths are offered.** The menu offers ten lengths for each pause,
  not every number. The desktop can be set to each of them too.
- **Each phone keeps its own.** The pauses are not carried between devices, so
  a second phone is set by hand.

## Turned down

- **A pair for each voice service.** It would slow Fish Audio down without
  touching the others, but the same number would then mean different things on
  the phone and the desktop, which keeps one pair. If one pair turns out not to
  fit, it can still be split later.
- **Making every voice pause for the same total length.** The app would have
  to find the silence at the end of each sentence and trim or pad it. One
  voice's background hiss hides its pauses from exactly that kind of search,
  and moving the silence moves where each word falls, which is what the
  highlight is timed by.
- **Setting the pauses in the book's own panel, where they are heard as they
  change.** They are set once and then left alone. Changing them mid-reading
  would mean rebuilding sentences already lined up to play, and the panel would
  gain a row that is used once.
- **A paragraph number that is added on top, as the desktop has it.** The owner
  would have to subtract to get the pause they wanted. Changing the sentence
  pause would also quietly change the pause at every paragraph.
- **Raising a short paragraph pause to the sentence pause, or offering only
  longer ones.** The first would make the setting quietly do nothing. The
  second would quietly change it when the sentence pause went up.
- **A number field like the desktop's.** It brings up a keyboard to choose
  between a dozen lengths.
- **An on/off switch beside each, as the desktop has.** There, off falls back
  to the pauses of Zotero's own voices. The phone has nothing to fall back to,
  and none is already off.
