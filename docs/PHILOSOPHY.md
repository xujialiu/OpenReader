# Philosophy

**A draft, carried over and adapted from the Zotero-TTS plugin. Edit it — it is
meant to be the author's own yardstick, not a summary of one.**

**I build this reader for the way I read, and it exists because the readers I
paid for each failed at one thing I could not work around.**

## Why it exists

I listen to books and papers every day. Speechify cannot keep my place across my
devices. ElevenReader can, but its highlight drifts out of sync with the voice
until it is useless. Both failures are unfixable from outside, so this is the
inside.

## The yardstick

- **My preference decides.** A feature is built because I want it.
- **Requests are welcome.** I build the ones I like that do not get in my way;
  when I will not build one, I say so and close it.
- **Bugs are fixed by severity, whoever hits them.**

## Rules

1. **Honest signals.** A voice that does not report word timings highlights by
   sentence; the app never invents, estimates or interpolates a timing. Network
   calls time out and report; they do not hang. A bookmark that might be wrong is
   worse than no bookmark, and says so rather than guessing.
2. **The highlight does not drift.** This is why the app exists. Playback
   position comes from the audio clock, never from a wall-clock estimate, and
   never accumulates error across a sentence.
3. **Bring your own provider.** No vendor is required or hard-coded; "OpenAI"
   means any server that speaks that API. Keys go only to the provider they
   belong to, and to nowhere else — there is no server of mine.
4. **No silent spending.** The app never spends your money without you knowing,
   and never re-spends it for audio it already had.
5. **A place kept is kept everywhere.** A position reached on one device is a
   position reached on all of them. Sync is not a feature bolted on; it is the
   reason this exists rather than a purchase.
6. **A setting must do something.** A setting that turns out to have no effect is
   removed.
7. **Correctness fixes need no user switch.**
8. **Your documents stay yours.** They are not uploaded anywhere to be read,
   indexed or processed, and removing the app leaves them untouched.

## What stays out

- **A library, a store, a catalogue, an account.** This reads documents you
  already have.
- **Anything that needs a server of mine to keep working.**
