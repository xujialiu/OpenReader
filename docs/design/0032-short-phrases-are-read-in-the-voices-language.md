# Short phrases are read in the voice's language

_The engineering half of this decision is
[ADR 0032](../adr/0032-fish-sends-a-language-hint-with-a-short-speech-text.md)._

## What the owner heard

Books that print a character's stats on a line of their own — "100 exp",
"2/50 HP" — had those lines read wrong by an English voice from Fish Audio. The
text sent was right; what came back sounded like "cn xp" and "2/50 GP". Fish
works out which language to speak from the text itself, and two or three words
are not enough for it to be sure.

The desktop plugin met this first and fixed it: for a phrase of one to three
words it tells Fish, in front of the phrase, which language the voice speaks —
"Speak in American English" for the owner's usual narrator. The owner listened
to both stats before and after: wrong both times without the note, right both
times with it. The phone did not do this, so the same line in the same book was
read correctly at the desk and wrongly on the phone.

## What changes

The phone now does exactly what the desktop does. When a Fish voice is about to
read one to three words, the same note goes in front of them, in the same words,
named from the voice's own language and, for an English voice, its region. It is
not spoken, and nothing is highlighted for it. There is no setting: this is a
reading that was wrong being made right, not a preference.

Numbers count as words and punctuation does not, so "2/50 HP" is three words and
is helped, while "You gained 100 exp." is four and is left alone. The note is
never added for a voice that speaks several languages, for one whose language is
not known, or for Fish's own default voice, because there is no one language to
name.

## Chinese and Japanese are counted a little more strictly

The desktop finds the words in a Chinese sentence with a dictionary. The phone
has none, so it counts each character as a word. A heading of three characters
is helped on both; one of four characters is helped on the desktop and not on
the phone. The owner chose the stricter count over carrying a dictionary.

## How the phone knows the region

A voice's region is not part of how the phone remembers it; it is part of what
Fish publishes about the voice. The phone asks Fish for its voice lists as the
app starts (design 0033), and that is usually enough. If the list is not in yet,
the first short phrase waits for it. If the voice is not in any list, the phone
asks about that one voice, once. If even that fails, the phrase is treated like
any sentence that could not be fetched and is tried again, rather than being
read without the note — and perhaps saved to a download that way.

## What was given up

**Saying only "English".** The phone already knows a voice's language without
asking anyone, and "Speak in English" would have needed no extra question. It
was turned down because the owner tested the desktop's wording and wants that
wording, word for word.

**Fixing audio already downloaded.** A phrase downloaded before this change
keeps the reading it was downloaded with until it is downloaded again. The owner
has not downloaded anything yet, and the app has not been released.

## What it costs

At most one small extra question to Fish per voice per start, and only when a
short phrase comes up before the voice lists have arrived. A phrase whose voice
cannot be looked up waits and retries instead of being read at once.
