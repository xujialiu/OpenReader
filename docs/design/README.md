# design

Why OpenReader is the way it is, written for someone who does not read code.

Every file here is one decision: what was chosen, what was turned down, and what
that costs the person using the app. You should be able to read any of them end
to end without knowing what a WebView or a sample rate is. If you hit a sentence
that needs one, that is a defect in the file — the engineering half of the same
decision lives in [`../adr/`](../adr/) and that is where such a
sentence belongs.

## What the app is

A reader for EPUB — later PDF and HTML — that **speaks the text aloud** through a
text-to-speech provider the reader's owner chooses and pays for directly, and
that keeps its place across the owner's phones, tablets and their desktop copy
of Zotero-OpenReader.

Everything the app runs on belongs to the owner: the provider is the owner's, the
keys are the owner's, the sync server is the owner's, and the documents stay the
owner's.

## The one claim

From [`../docs/PHILOSOPHY.md`](../PHILOSOPHY.md), which is the yardstick
everything here is measured against:

> **The highlight does not drift.** This is why the app exists. Playback
> position comes from the audio clock, never from a wall-clock estimate, and
> never accumulates error across a sentence.

The author listened to books on Speechify and on ElevenReader and left both —
one could not keep its place across devices, the other's highlight slid out of
time with the voice until it was useless. Most of the hardest decisions recorded
here are downstream of refusing to repeat the second failure. When a file here
explains a cost being paid, that is usually what it is being paid for.

## How to read a decision

Each file is numbered, and the same number in `../adr/` is the same
decision written for engineers. Not every decision has both halves: a purely
technical one has no file here, a purely product one has none there. A number is
spent on a decision, not on a file, so a gap is not a mistake.

Three other places hold things that are deliberately **not** here:

| | |
| --- | --- |
| [`../docs/PHILOSOPHY.md`](../PHILOSOPHY.md) | The yardstick. What the app is for, and what stays out of it |
| [`../CONTEXT.md`](../../CONTEXT.md) | The glossary. What each word means, and which words to avoid |
| [`../notes/`](../../notes/) | What was measured, and when |

The glossary is worth ten minutes before anything else. The words in it are
used strictly — a **Document** is one file the owner reads, an **Utterance** is
one sentence sent to a provider, a **Clip** is the audio that comes back, a
**Word Timing** says where one spoken word falls inside a Clip. Files here use
those words and no synonyms, because the same words are used in the code.
