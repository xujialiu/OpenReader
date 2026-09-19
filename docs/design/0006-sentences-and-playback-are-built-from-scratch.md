# The two hardest pieces do not exist yet, and cannot simply be copied

*The engineering half of this decision is [ADR 0006](../adr/0006-segmenter-and-player-are-new-work.md).*

This app is easy to describe as the phone version of a desktop reader plugin that
already works. Anyone who takes that at face value will get the size of the
project badly wrong, so it is written down here before it is planned around.

## What already exists, and what does not

What exists is the part that deals with providers: ask for a sentence, get audio
back, be told which word was said and when. It comes across nearly unchanged and
it is the most valuable thing being carried over, because it is where years of
catching providers misbehaving is recorded.

What does not exist anywhere in that work is the two things that decide whether
being read to feels right:

- **Deciding where one sentence ends and the next begins.** Harder than it sounds,
  and the app is only as good as this. Get it wrong and the voice pauses in the
  middle of a thought, or runs two sentences together, or reads a heading as the
  first words of the paragraph under it.
- **Playing the audio.** Not "play a file": keeping several sentences fetched
  ahead so there is never silence between them, changing the speed without making
  the voice sound wrong, and knowing exactly where in the audio it has got to so
  the mark can follow.

On the desktop, both of those belonged to the program the plugin was a plugin for.
Here there is no such program. They are this project's to build, and together they
are the bulk of it.

## They can be read but not taken

Working versions of both are public, and neither can simply be used.

The playback one is published under terms that would require this app to be
published under the same terms. The author wants that choice to stay open, so the
behaviour is studied and the app's own version written instead. That is slower,
and the slowness is the price of keeping the choice.

The sentence one has no licence attached to it at all, which means nobody has given
permission to copy it. That is not a technicality to be waved through on the way
to shipping.

What can be used is the piece underneath it: a separate, freely usable project
whose whole job is splitting text into sentences. The app uses that directly. Most
of the scaffolding the desktop built around it turns out to be unnecessary here
anyway, because the kind of document the app reads first already tells the app
where its paragraphs are — and the app never has to guess what language a document
is in, because the document says so, which also keeps a large lump of
language-guessing data off the phone.

## The trade-off inside that, in the owner's terms

That freely usable sentence splitter is deliberately used at an older release.
Its newer releases were rebuilt in a way that cannot run on a phone at all — not
slower, not needing work: the app would not start.

The older release handles thirty languages rather than every language, and it
disagrees with the newer one about a handful of abbreviations, in both directions.
So an owner reading in one of those thirty languages gets sentence splitting as
good as the desktop's. An owner reading outside that set will hear the voice break
where the text does not — a pause mid-thought, or two sentences run together — and
will see the mark cover the wrong stretch while it happens. That is a real limit
on who the app reads well for, and it is a smaller limit than the alternative,
which is an app that does not run.

## One consequence the owner may meet

Because the phone and the desktop split text into sentences with different
machinery, they do not always agree on where a sentence starts. So keeping a place
cannot be done the obvious way — counting sentences from the top of a chapter and
remembering the number — because the two would count differently and the desktop
would resume in the wrong spot. How a place is described instead is still open. It
does not change what the owner is promised: a place reached on one device is a
place reached on all of them. It changes only how that is built.
