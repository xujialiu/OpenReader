# One voice for every document

_The engineering half of this decision is
[ADR 0089](../adr/0089-one-voice-for-every-document.md). Issue
[327](https://github.com/xujialiu/OpenReader/issues/327)._

This replaces [decision 0010](0010-each-document-keeps-its-own-voice.md), under
which each document kept the voice it was started in.

The app has one voice. Every document is read in it, and choosing a voice
anywhere, in any book, changes it for every book. This is what the desktop plugin
the owner uses has always done.

## What the owner met under a voice per document

A voice chosen in one book never reached a book already opened. Trying a new
voice and liking it meant opening every book on the shelf and choosing it again
in each, and a book returned to after a while was read by whatever voice it had
last been given there. The speed and the Fish Audio model were already one
setting for the whole app; the voice was the only part of the reading that each
book kept for itself.

## What one voice costs, accepted knowingly

**Audio saved in one voice is not used while another is chosen.** Decision 0010
turned down one voice for exactly this reason. Saved audio is kept under the
voice that spoke it. After a change, a book downloaded in the old voice is read
in the new one, fetched from the provider again, which needs a connection and
costs what the provider charges. Its downloaded marks follow the new voice. None
of the old audio is deleted. Switching back to the old voice, for which the
Download page offers "Use downloaded voice", makes it play again.

A book with downloaded audio could have kept its downloaded voice. That was
turned down because it brings back a voice per book, with the same surprise:
a book read by a voice other than the one just chosen.

**Books in different languages share the voice.** A Chinese novel and an English
paper on the same shelf are read by the same speaker. A voice that speaks any
language serves both; otherwise the owner switches when moving between them.
Choosing a voice by language stays out, for decision 0010's reason: it means
guessing the language sentence by sentence.

## When the voice's provider is turned off

The voice stays. The app never moves to another provider's voice by itself.

Audio already saved in that voice still plays, with no connection and no charge.
The reading stops at the first sentence that is not saved, and the player says
the provider is turned off and to choose one that is on. In a book with nothing
saved in that voice, Play opens the voice list. A download in that voice stops
and says the same.

The alternative was to move to the most recent voice whose provider is still on.
Play would then just work, but in a different voice the owner did not choose,
paid for by a different provider, and audio saved in the turned-off provider's
voice could not be heard until it was turned back on. The extra choice the owner
makes after turning a provider off is the smaller cost.

## The Download page

The Download page shows the one voice, and downloads in it. "Use downloaded
voice" makes the voice it names the one voice, for every book, and the page then
shows that voice. If a book is being read aloud at that moment, whichever book it
is, it moves to the new voice as it would from the voice list: the old voice
reads on until the new one is ready. A voice whose provider is turned off cannot
be prepared ahead, so choosing one stops the reading. Play then reads what is
saved in it.

## On updating

Every book is read in the last voice chosen while its provider was on, even if
that provider has been turned off since. Nothing a book remembered about its own
voice is kept.
