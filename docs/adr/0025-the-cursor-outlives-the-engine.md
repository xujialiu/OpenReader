---
status: accepted
---

# The cursor outlives the engine, and Play with no cursor means the top

Where the reading is pointed is a property of the **Document**, not of the audio
graph. Throwing the engine away — for a new Provider, a new Voice, a new address,
or a credential that has just been saved — changes who is speaking and leaves the
cursor exactly where it was.

There is no design file for this number. The product promise it restores is
already written: `docs/design/0020` keeps "anything that rewrites your place
without you asking" out of the player, and this was that, arriving from
underneath.

## The defect

Found in the first end-to-end walkthrough (`notes/NOTES_2026-09-20.md`, 07:45),
and reproduced exactly: 仙逆 open at Utterance 212 of section 104, chapter 100.
Change the Voice from the player's sheet; press Play. **Utterance 3 of 336,
section 4** — chapter one, with the page dragged back to it.

`use-reading.ts` rebuilds the engine on
`${engineIdentity(settings)}@${writtenAt}`, and the work is all in the cleanup,
because the cleanup is the one place the audio session is given back. That
cleanup also did `atRef.current = null`. `play()` then found a loaded Utterance
list and no cursor, and `build()`'s `engine.load(loadedRef.current, atRef.current ?? 0)`
started the book from its beginning.

Three things make it worse than it looks:

- **The same cleanup runs for a credential write.** `writtenAt` is the shell's
  count of saved credentials (ADR 0019), so pasting an API key while reading did
  it too — and pasting a key while reading is exactly what an owner does when a
  Provider starts refusing.
- **It was already recorded as a fact and filed as harmless.** 03:02 noted that a
  Provider or Voice change "discards where the reading was pointed" and recorded
  it rather than fixing it. Nobody had pressed Play afterwards.
- **On a 2,000-chapter novel there is no way back.** The Reading Position is
  rewritten every ten seconds while the reading runs (`reading-view.tsx`), so
  chapter one is written over chapter 100 within seconds of the reading starting.

## What was decided

**`atRef` is not cleared by the rebuild.** It is cleared in exactly one place:
`adopt`'s renumbering branch, where `samePrefix` has established that every index
now means a different sentence and clearing is the whole point.

**Nor is `status.utterance`, nor `status.section`.** The player goes on saying
where the reading is, because that is where it is. What the cleanup does clear is
`level` and `reportsWordTimings`: both are claims about the Provider that was
speaking, and after a rebuild there is no Clip and no Provider that has answered.

**And the highlight follows the cursor rather than the engine.**
`bridgeRef.current?.clear()` — "nothing is being read, both highlights go" — is
now reached only when there is no cursor. With one, the cleanup calls
`show(at)`, which paints the Utterance whole at utterance level and replaces the
Word Timings the *previous* Voice was cued with. Those timings are the one thing
in this state that would have been a lie left on the page: they were computed for
a voice that is no longer reading.

**`play()` with no cursor still means the top**, and `?? 0` stays. It is now
reachable only for a cursor that never existed — a Document opened with no stored
place and not yet pointed anywhere, where the top *is* where the reading starts.
That was always the intended reading of `?? 0`; the rebuild was falling through
it.

## What this does not change

The cleanup still disposes the engine and still gives the audio session back, in
the same order, on the same dependency. The Clips of the old Voice are not
reused, because a Clip's cache identity includes the Voice (ADR 0009); the
rebuild re-fetches the sentence at the cursor in the new Voice, which is the
point of changing it.

## One consequence worth naming

`reading-view.tsx` publishes the lock screen while `status.utterance !== null`,
which now stays true across a rebuild. That flag was never "we hold an audio
session" — a word tapped before Play was ever pressed already sets it — and
nothing appears on the lock screen until the session is active, measured at 04:05.
So the rebuild window publishes an item iOS does not show, and a press on it
arrives at `reading.play()`, which builds the engine and reads from the cursor.

## Why not a pending-cursor of its own

A second ref holding "where to resume after a rebuild" was the smaller diff and
the worse answer: two places would then know where the reading is, and the one
`readingPosition()` reads — the one that writes the Library — would be the one
that was cleared. The Reading Position written to the Library is built from
`atRef` (ADR 0008), so a cursor cleared at the rebuild also meant
`readingPosition()` answering null for the whole gap between the rebuild and the
next Clip.

## Amendment (2026-09-23, #46)

"It is cleared in exactly one place: `adopt`'s renumbering branch, where
`samePrefix` has established that every index now means a different sentence and
clearing is the whole point" no longer describes a renumbering. Clearing there
was this ADR's defect arriving from another side: the next Play found no cursor
and read from the top, and the stored place was written over within seconds
(`notes/NOTES_2026-09-23.md`, 13:35). `adopt` now carries the cursor to the same
sentence in the new list (`carryUtterance`; ADR 0023's amendment of the same
date). The one place the cursor is still cleared is a renumbering that cannot
find its sentence at all, because that sentence's own section reported different
text; `test/app/player-rules.test.ts` still pins it to one line.
