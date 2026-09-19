/**
 * How a Word Timing becomes a place in the document, and where the highlight is
 * at time *t*.
 *
 * This is the file that must not be wrong, and it is the reason the rest of the
 * directory can be as thin as it is. Every decision the renderer makes is here,
 * it is pure, it runs under Node, and it is tested — which leaves the React
 * Native half a wiring file and the WebView half a DOM file, neither of which
 * this test suite can run (`test/README.md`).
 *
 * ## The coordinate systems, in the order a Word Timing passes through them
 *
 * Three, and getting the chain wrong puts the highlight on the wrong words.
 *
 * 1. A Word Timing's `charStart`/`charEnd` are **UTF-16 code-unit offsets into
 *    the Utterance's own text** — the text a Provider was asked to speak
 *    (`core/providers/types.ts`).
 * 2. An `UtteranceSpan` says where a run of that text came from: `textOffset` is
 *    where the run begins in `utterance.text`, and `start`/`end` are **offsets
 *    into one Block's own text**. `core/segmenter/index.ts` states the invariant
 *    exactly:
 *
 *    ```
 *    utterance.text.slice(span.textOffset, span.textOffset + span.end - span.start)
 *      === blocks[span.block].text.slice(span.start, span.end)
 *    ```
 *
 *    So the step is: intersect the timing with the span in utterance
 *    coordinates, subtract `textOffset`, add `start`.
 * 3. The WebView turns an offset into a Block's text into a DOM `Range` by
 *    walking the very text nodes it built that text from. That step is the only
 *    one that needs a DOM, and it is the only one that is not here.
 *
 * Most Utterances have one span. More than one happens where the repair layer put
 * back a sentence the document's markup had cut (`rejoin.ts`), and then one word
 * — or the whole Utterance — is several `Range`s, which is exactly what the CSS
 * Custom Highlight API takes.
 *
 * ## The units
 *
 * `ClipCue.words` arrive **already scaled for the playback rate**: `rate.ts`
 * divided them, once per Clip, and ADR 0005 calls forgetting that the single
 * easiest way to reintroduce drift. So this file converts seconds to
 * milliseconds and nothing else. There is no rate in it.
 */

import type { Timestamp } from '../core/providers/types';
import type { Utterance } from '../core/segmenter';
import type { ClipCue, PositionCorrection } from '../playback/reader-clock';

import type { AnchoredRange, BlockRange, CorrectMessage, SpeakMessage, WordCue } from './messages';

/**
 * The Block ranges a half-open run of an Utterance's text covers.
 *
 * `from` and `to` are offsets into `utterance.text`; the result is in Block text
 * offsets. `blockIds[span.block]` is why the caller has to pass the very Block
 * array the Utterances were segmented from — `UtteranceSpan.block` is an index
 * into it, and an id crosses the bridge instead of the index so that there is
 * only one numbering to keep in step.
 *
 * A run that lies entirely in the space `rejoin.ts` inserted between two Blocks
 * belongs to no span, and so yields no ranges. That is not an error: the space is
 * in the text because the Provider needs it and in no Block because it is not in
 * the document.
 */
export function rangesOf(
  utterance: Utterance,
  blockIds: readonly string[],
  from: number,
  to: number,
): BlockRange[] {
  return anchoredRangesOf(utterance, blockIds, from, to).map(({ block, start, end }) => ({ block, start, end }));
}

/**
 * The same ranges, each carrying the text it must contain.
 *
 * The text is the anchor of ADR 0008: the WebView holds the Block text it built
 * from the DOM, so comparing against it catches a stale Block array or a document
 * that changed under us — before a highlight lands three paragraphs away. It is
 * sliced out of the Utterance's text rather than out of a Block, because this side
 * of the bridge holds only one of the two and the invariant above says they are
 * the same characters.
 */
export function anchoredRangesOf(
  utterance: Utterance,
  blockIds: readonly string[],
  from: number,
  to: number,
): AnchoredRange[] {
  const ranges: AnchoredRange[] = [];
  for (const span of utterance.spans) {
    const spanEnd = span.textOffset + (span.end - span.start);
    const overlapFrom = Math.max(from, span.textOffset);
    const overlapTo = Math.min(to, spanEnd);
    if (overlapTo <= overlapFrom) continue;
    const block = blockIds[span.block];
    // A span naming a Block the caller did not pass is a mismatch between the
    // Blocks that were segmented and the Blocks that were reported. Reporting
    // nothing is right; guessing at a neighbour is the failure mode ADR 0008
    // calls worse than no bookmark.
    if (block === undefined) continue;
    ranges.push({
      block,
      start: span.start + (overlapFrom - span.textOffset),
      end: span.start + (overlapTo - span.textOffset),
      text: utterance.text.slice(overlapFrom, overlapTo),
    });
  }
  return ranges;
}

/** Every Block range the whole Utterance covers — the utterance-level Highlight Level (ADR 0005), and the anchor the WebView verifies against. */
export function utteranceRanges(utterance: Utterance, blockIds: readonly string[]): AnchoredRange[] {
  return anchoredRangesOf(utterance, blockIds, 0, utterance.text.length);
}

/**
 * The Word Timings as the WebView's loop wants them: heard milliseconds, and the
 * Block ranges each word covers.
 *
 * `Math.max(0, …)` on the time because a Provider can report a negative start —
 * `core/align.ts` arrived with a `kokoro-negative-start.json` fixture for exactly
 * that. Clamping a negative start to zero is not estimating a timing; the timing
 * is the Provider's and it is kept, only its epoch is not allowed to precede the
 * Clip.
 *
 * The array is **not sorted, deduplicated or repaired**. A Provider either
 * reported these or did not (philosophy rule 1), and reordering them would be a
 * quiet rewrite of what it said. `wordIndexAt` is defined to match whatever order
 * they came in.
 */
export function wordCues(
  utterance: Utterance,
  blockIds: readonly string[],
  words: readonly Timestamp[],
): WordCue[] {
  return words.map((word) => ({
    // Seconds to milliseconds, and that is the only arithmetic here: the timings
    // arrived already scaled for the playback rate (ADR 0005, rate.ts).
    atMs: Math.max(0, word.start * 1000),
    ranges: rangesOf(utterance, blockIds, word.charStart, word.charEnd),
  }));
}

/**
 * Which Word Cue the highlight belongs on at `elapsedMs`, or -1 for none yet.
 *
 * A **forward scan and not a binary search**, and that is deliberate: `wordCues`
 * does not sort, so the array can be non-monotonic, and a binary search over
 * unsorted data would put the highlight somewhere a forward scan never would.
 * This is character for character the loop the WebView runs between corrections,
 * so the once-a-second correction and the frames between it cannot disagree about
 * which word is current.
 *
 * Twenty words scanned once a second is not worth a cleverer search.
 */
export function wordIndexAt(words: readonly WordCue[], elapsedMs: number): number {
  let index = -1;
  while (index + 1 < words.length && words[index + 1].atMs <= elapsedMs) index++;
  return index;
}

/** Heard milliseconds since a Clip's speech began, bounded by the speech's own length: the highlight belongs on the words, not on the gap that follows them. */
export function clampElapsed(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return Math.min(Math.max(0, elapsedMs), Math.max(0, durationMs));
}

export interface SpeakOptions {
  /** Bring the spoken text into view. */
  reveal: boolean;
}

/**
 * A `ClipCue` as the one message that crosses the bridge when a Clip starts.
 *
 * Null where there is nothing to say: an Utterance index the renderer does not
 * have, or an Utterance whose Blocks have not been reported. Both mean the
 * document and the reading have got out of step, and the honest response is to
 * send nothing and leave the last highlight alone rather than draw a guess.
 */
export function speakMessage(
  cue: ClipCue,
  utterances: readonly Utterance[],
  blockIds: readonly string[],
  options: SpeakOptions,
): SpeakMessage | null {
  const utterance = utterances[cue.utterance];
  if (!utterance) return null;
  const ranges = utteranceRanges(utterance, blockIds);
  if (ranges.length === 0) return null;
  // `words: null` is the Provider reporting none, so the Highlight Level is the
  // whole Utterance (ADR 0005). Nothing here fills the gap: no estimate, no
  // interpolation, not even an even division of the duration.
  return {
    kind: 'speak',
    utterance: cue.utterance,
    utteranceRanges: ranges,
    words: cue.words === null ? null : wordCues(utterance, blockIds, cue.words),
    durationMs: Math.max(0, cue.duration * 1000),
    reveal: options.reveal,
  };
}

/**
 * A `PositionCorrection` as the one message a second.
 *
 * Null where the correction is for an Utterance the renderer is not showing,
 * which means a cue was missed. The engine notices that itself and re-cues before
 * correcting (`engine.ts`'s `if (at.clip.utterance !== cued) cue(front)`), so by
 * the time a correction for a new Utterance arrives here its cue has already been
 * sent; a correction that still does not match is stale and dropping it is right.
 */
export function correctMessage(correction: PositionCorrection, cued: SpeakMessage | null): CorrectMessage | null {
  if (!cued || cued.utterance !== correction.utterance) return null;
  const elapsedMs = clampElapsed(correction.clipPosition * 1000, cued.durationMs);
  return {
    kind: 'correct',
    utterance: correction.utterance,
    elapsedMs,
    word: cued.words === null ? -1 : wordIndexAt(cued.words, elapsedMs),
    // In the gap the last word stays highlighted and nothing advances. The
    // position itself is already held at the end of the speech by `timeline.ts`,
    // so this is belt and braces — and it also stops the loop, which is a frame
    // budget the reader is not spending on a pause.
    hold: correction.inGap,
  };
}
