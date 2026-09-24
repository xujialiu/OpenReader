/**
 * The four skip targets, as arithmetic over the Utterance list.
 *
 * ADR 0020's whole argument is that six controls are six ways of naming one
 * Utterance and all of them end in `engine.seek(utterance)`, which already
 * exists and already has the semantics they need. So this file adds no
 * mechanism: each function takes the Utterances the engine was given and the
 * Reading Position it is at, and returns the index to hand to `seek`. Nothing
 * here touches the engine, the clock or React, and nothing here is asynchronous
 * — a skip is an index.
 *
 * Four behaviours are copied from Zotero's reader unchanged, each verified in
 * its source and recorded in ADR 0020: **no time threshold** on
 * previous-sentence, **sections are not boundaries**, **the ends clamp and
 * clamping re-speaks**, and **navigation while paused moves the highlight
 * without resuming**. The last two are the engine's already: `seek` is
 * `restart(utterance); pump()`, `restart` clamps into range, and there is
 * deliberately no `resume()` in it. So they are not re-implemented here; what is
 * here is the index arithmetic, and it returns the *current* index rather than
 * nothing at a document end precisely so that the re-speak happens.
 *
 * One behaviour deliberately diverges: **previous-paragraph**. Zotero skips an
 * extra paragraph when the position is mid-paragraph ("so paragraphs are treated
 * as a single unit for skipping"); we go to the current paragraph's own first
 * Utterance instead. ADR 0020 gives the reason as a duration asymmetry rather
 * than taste — a sentence here is one to two seconds and a paragraph in the
 * owner's novel runs to half a minute, so Zotero's rule makes "read that
 * paragraph again" unreachable in one press.
 *
 * Debouncing rapid presses is **not** here. ADR 0020 requires it (five taps must
 * not be five synthesis requests) and Zotero's own number is 600 ms, but a
 * debounce is a timer belonging to whatever handles the press; these functions
 * are pure so that the debounced call and the immediate highlight move can both
 * be computed from the same answer.
 *
 * ## What a paragraph is, read off the spans
 *
 * A paragraph is a **Block**. An Utterance carries the Blocks its characters
 * came from (`segmenter/index.ts`'s `UtteranceSpan`), and the repair layer can
 * weld a sentence across two Blocks (`segmenter/rejoin.ts`), so
 * "the Utterance that starts a paragraph" is not "the first Utterance whose
 * first span's Block differs from the one before it". It is:
 *
 * > the first Utterance to speak any character of a Block — the one that begins
 * > in a Block the reading has not been in yet.
 *
 * That is exactly `gap.ts`'s `startsNewBlock`, and this file calls it rather than
 * restating it: the pause the reader *hears* at a paragraph and the
 * Utterance the paragraph button *lands on* must be the same boundary, or the
 * two would be two sources of one fact and would drift apart.
 *
 * The span invariant that makes it well defined: `blockRuns` partitions the
 * Blocks into contiguous ascending runs, `sentenceSpans` cuts each run's text
 * into ordered non-overlapping spans, and `spansIn` maps a span to the run
 * members it intersects in ascending order. So across the whole list
 * `utterances[i].spans[0].block >= utterances[i - 1].spans.at(-1).block`, with
 * equality exactly when the Utterance begins *inside* a Block whose first
 * characters an earlier Utterance already spoke. There is therefore no Utterance
 * boundary at that Block's start and nothing to seek to: the Block is folded
 * into the paragraph the repair layer welded it to, which is the conclusion the
 * repair layer had already reached about the document — it joins two Blocks only
 * when it believes the markup cut one paragraph in two.
 *
 * One case the data cannot answer, stated rather than guessed at: if a run's
 * Blocks were welded but no single Utterance spans the join — a `maxLength` cap
 * cutting at the inserted space, or a splitter that chose to end a sentence
 * there — the join leaves no trace in the spans and this reads it as an ordinary
 * paragraph boundary. Nothing outside the segmenter's own tests passes
 * `maxLength` today. `gap.ts` reads it the same way, so the gap and the skip
 * still agree, which is the property worth keeping.
 *
 * Sections are not boundaries, and that needs no code: the list spans the
 * document, so ±1 crosses a spine item with no special case (ADR 0020, and
 * Zotero's `_segments` has the same property).
 */

import type { Utterance } from '../core/segmenter';
import { startsNewBlock } from './gap';

/**
 * Whether this Utterance is the first of its paragraph — the first to speak any
 * character of a Block.
 *
 * Exported because it is the rule, and a rule nothing can see is a rule nothing
 * can test.
 */
export function startsParagraph(utterances: readonly Utterance[], index: number): boolean {
  const current = utterances[index];
  const previous = utterances[index - 1];
  // Index 0 starts a paragraph whatever its spans say: the document begins
  // there. So does an index off either end — there is no Utterance before it
  // whose Block could be continued — and the four skips below never ask about
  // one, because they clamp the position into range first.
  if (!current || !previous) return true;
  return startsNewBlock(previous, current);
}

/**
 * The first Utterance of the paragraph the position is in — the position itself
 * when it is already there.
 *
 * A backwards walk rather than a precomputed index: the list is document-wide
 * (2,076 sections on the owner's book) and this runs once per button press, so
 * the cost is the length of one paragraph and there is nothing to keep in step
 * with a reload.
 */
export function paragraphStart(utterances: readonly Utterance[], index: number): number {
  let at = currentIndex(utterances, index);
  while (at > 0 && !startsParagraph(utterances, at)) at--;
  return at;
}

/**
 * Index − 1, with **no time threshold**: however far into the current Utterance
 * the clock is, this goes back one (`reader.js:39417-39439` is pure index
 * arithmetic; the 5 s/20 s numbers nearby are an English-only pause-resume
 * backoff and unrelated).
 *
 * At index 0 it returns 0 rather than nothing, and that is the behaviour, not a
 * fallback: `_skipTo` stops and re-speaks unconditionally, so previous-sentence
 * at the start of the document restarts the first Utterance.
 */
export function previousSentence(utterances: readonly Utterance[], index: number): number {
  return Math.max(0, currentIndex(utterances, index) - 1);
}

/** Index + 1, clamped at the last Utterance — where it re-speaks the last one, for the same reason. */
export function nextSentence(utterances: readonly Utterance[], index: number): number {
  return Math.min(utterances.length - 1, currentIndex(utterances, index) + 1);
}

/**
 * The current paragraph's first Utterance when the position is not already
 * there; the **previous** paragraph's first Utterance when it is.
 *
 * This is the one divergence from Zotero (ADR 0020), and the two halves are the
 * whole of it — getting either one wrong turns "read that paragraph again" into
 * "read the one before it" or into nothing at all.
 *
 * At the start of the first paragraph there is no previous one, so it clamps to
 * 0 and re-speaks it.
 */
export function previousParagraph(utterances: readonly Utterance[], index: number): number {
  const at = currentIndex(utterances, index);
  const start = paragraphStart(utterances, at);
  if (start < at) return start;
  if (start === 0) return 0;
  return paragraphStart(utterances, start - 1);
}

/**
 * The next paragraph's first Utterance, clamped to the last Utterance when there
 * is none after — so the last paragraph's button re-speaks the last Utterance
 * rather than doing nothing.
 */
export function nextParagraph(utterances: readonly Utterance[], index: number): number {
  const at = currentIndex(utterances, index);
  for (let i = at + 1; i < utterances.length; i++) {
    if (startsParagraph(utterances, i)) return i;
  }
  return utterances.length - 1;
}

/**
 * The position these functions are asked to skip from, as an index that exists.
 *
 * Out of range clamps, because that is what `engine.seek` does with the number
 * it is handed (`restart`, `engine.ts:326`) and two disagreeing clamps would be
 * two rules. The two cases that throw are caller defects rather than positions:
 *
 * - **no Utterances.** There is no index to return, and returning 0 would be a
 *   fabricated Reading Position. ADR 0020 records that the controls are never
 *   disabled at a document *boundary* while the plugin's own player disables
 *   them "only when no session is open" — so being asked to skip with nothing
 *   loaded is already specified as impossible, and it fails loudly here instead
 *   of seeking silently into an empty document.
 * - **a position that is not a number.** `NaN` would clamp to `NaN` and become
 *   an engine cursor of `NaN`, which reads as "the highlight stopped" and points
 *   nowhere near its cause.
 */
function currentIndex(utterances: readonly Utterance[], index: number): number {
  const last = utterances.length - 1;
  if (last < 0) throw new RangeError('playback/navigation: asked to skip with no Utterances loaded');
  if (!Number.isFinite(index)) throw new RangeError(`playback/navigation: ${index} is not a Reading Position`);
  return Math.min(last, Math.max(0, Math.trunc(index)));
}
