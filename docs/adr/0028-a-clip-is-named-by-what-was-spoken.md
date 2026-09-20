---
status: accepted
---

# A Clip is named by what was spoken

The product agreement is [design 0028](../design/0028-reading-past-the-brackets.md). One Utterance now has two forms — the document's text and the **Speech Text** actually sent to a Provider (CONTEXT.md) — and this ADR is about which of the two names the Clip.

## The engine was already here and nothing called it

`core/speech-text.ts` arrived with the shared provider layer: `DEFAULT_BRACKET_PAIRS`, `validateBracketPairs`, `prepareSpeechText` and `restoreSpeechOffsets`, 179 lines, with `test/core/speech-text.test.ts` beside it. A search of `src/` for any of those four names outside the module returned nothing. It had been ported and never wired, and its own docblock described a seam that did not exist yet.

So this decision is not about the stripping, which was already written and already tested. It is about the three lines that connect it, and one of them is not obvious.

## `fetch()` in `clips.ts` is the only seam

`createClipFetcher`'s `fetch(utterance, text, speakable)` is where an Utterance's text becomes a Provider request and where the reply becomes a `PreparedClip` carrying its Word Timings. It is therefore the only place that can strip on the way out and restore on the way back, and both have to happen there or the two halves end up in different files with the cache between them.

`prepareSpeechText` runs on the text; the Provider is asked for the Speech Text; `restoreSpeechOffsets` runs on `result.timestamps` inside the `job.then(...)` that was already there. **Per caller and not inside `synthesize`**, and that is not a style choice: what comes back from the cache is in Speech Text coordinates and is shared by every caller who asked for that string, while `removed` belongs to this Utterance's own text. One synthesis, two Utterances — the existing comment already named the shape; the restoration has to sit on the same side of it.

## The cache key is the Speech Text

`clipCacheKey(provider, voice, text)` is given the Speech Text, not the document's.

A Clip is the audio of what was actually spoken, so what was actually spoken is its name. The consequence is the point: change either bracket setting and the key changes with it, so a Clip synthesized under one setting **cannot** be paired with offsets computed under another. The drift ADR 0012 exists to prevent is impossible here rather than guarded against.

The alternative was to key on the document text and store `removed` alongside the Clip. It keeps one Clip usable under both settings, and it was rejected: every read would then have to re-derive `removed` from the current setting and trust it matches what was stored, and a mismatch is a silent drift rather than a miss. A cache miss costs money once and is visible. A highlight one character to the left is neither.

It also pays for itself in the direction philosophy rule 4 cares about: two Utterances differing only in their brackets are now one paid synthesis.

## Offline Narration shares the key, so it shares the consequence

`offline/runtime.ts:121` is `[document, clipCacheKey(provider, voice, text)]`. Offline Narration is keyed through the same function, so a setting change re-keys the saved audio too, and every already-downloaded chapter stops being found.

**The files stay.** Switching the setting back restores the old key and they are immediately playable again, so deleting them on a toggle would spend the owner's money to re-download something they still had.

But `occupied()` sums the inventory **by voice and never looks at the text** (`runtime.ts:280`), so the orphans keep counting towards the reported space while the chapter list reports nothing downloaded. That combination — megabytes saved, zero chapters, and a per-chapter delete that cannot reach them — is not a state the owner can act on. So managing downloads gains one action that removes all saved audio for a document. The space stays visible and becomes recoverable, and nothing guesses what the owner meant by flipping a switch.

## Invalid settings strip nothing

`prepareSpeechText` returns the text unchanged when `validateBracketPairs` refuses the list, which is what makes it safe to persist a list that does not validate. `settings-storage.ts` therefore keeps `bracketPairs` exactly as typed: the owner edits it with the setting off, and a half-finished edit silently replaced on the way to disk would be an edit they never made. The guard is at the point of use, where a restored or synced list from another device also arrives.

Validation runs on the tick, not on each keystroke, and reports in place with `Note attention` — the same way `provider-screen.tsx` already reports a bad field. A modal for a typo is heavier than the typo.

## What is tested, and what is not

`test/core/speech-text.test.ts` already covers the stripping and the offset arithmetic; none of that is new. What is new is the order and the side of the cache, which is the part that can be wrong while both halves are right, so `test/playback/clips.test.ts` gains three cases: that the Provider is asked for `Log in` when handed `<Log in>` while the returned timings come back shifted into the document's coordinates; that the two settings produce two cache entries rather than one; and that nothing is stripped when the owner has not asked or when the list does not validate.
