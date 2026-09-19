import { graphemeSegments } from 'unicode-segmenter/grapheme';

/**
 * Grapheme clusters, which is how an offset stays honest.
 *
 * Every offset this directory produces is a **UTF-16 code-unit offset into a
 * Block's text** — the coordinate `core/align.ts` and `core/speech-text.ts`
 * already work in, and the one the renderer builds its `Range` objects from
 * (ADR 0005). A code-unit offset can still land in the middle of something a
 * reader sees as one character, and a sentence splitter will happily hand one
 * over: `sentencex` cuts `Hello.` + U+0301 + ` World.` into `Hello.` and
 * U+0301 + ` World.`, putting the combining acute of the full stop at the head
 * of the next utterance. Measured on the pinned 0.4.2 and on 1.0.31,
 * 2026-09-19. The provider is then
 * asked to pronounce a bare combining mark, and the highlight starts half a
 * character early. Decomposed text is not a curiosity here — the plugin's
 * Romanian fixture carries an NFD variant on purpose, and ADR 0008 records
 * that EPUB text arrives in either normalisation.
 *
 * So every cut is moved to a cluster boundary before it becomes an utterance.
 *
 * ## Why not `unicode-segmenter/intl-polyfill`
 *
 * Because it would hide a divergence rather than remove one. That entry point
 * installs `Intl.Segmenter` when the engine has none, and its adapter
 * implements **`granularity: 'grapheme'` only** — `'word'` and `'sentence'`
 * each `throw new TypeError` (read from `intl-adapter.js` in the installed
 * 0.17.3). Node *has* a real `Intl.Segmenter`, so the polyfill is a no-op
 * under vitest and `new Intl.Segmenter('en', { granularity: 'word' })` works
 * there and throws on Hermes, which has no `Intl.Segmenter` at all
 * (notes/NOTES_2026-09-19.md). Anything written through the global would
 * therefore pass its test and crash the app. Importing the concrete function
 * behaves identically on both, which is the only property worth having; the
 * polyfill is still what the app installs for everything outside `core/`.
 *
 * The consequence to keep in view: there is **no word segmenter available on
 * Hermes**, from this package or from the platform. Where a cut has to fall
 * inside a sentence, it falls on whitespace or on a grapheme cluster, never on
 * a word.
 */
export interface Clusters {
  /**
   * Every offset where a grapheme cluster begins, ascending, with the text's
   * length last. So `cuts[0]` is 0 for any non-empty text, and a span from
   * `cuts[i]` to `cuts[j]` never splits a cluster.
   */
  readonly cuts: readonly number[];
  /** `blank[i]` is whether the cluster starting at `cuts[i]` is whitespace only. Parallel to `cuts`, one shorter. */
  readonly blank: readonly boolean[];
}

const BLANK = /^\s+$/u;

export function clustersOf(text: string): Clusters {
  const cuts: number[] = [];
  const blank: boolean[] = [];
  for (const { segment, index } of graphemeSegments(text)) {
    cuts.push(index);
    blank.push(BLANK.test(segment));
  }
  cuts.push(text.length);
  return { cuts, blank };
}

/**
 * The first cluster boundary at or after `offset`.
 *
 * Forward rather than back, so a terminator that carries a combining mark
 * keeps the mark with the sentence it ends: the cut after `Hello.` in
 * `Hello.́ World.` becomes the cut after `Hello.́`, not the cut
 * before the full stop. A cluster is short, so this can never swallow the
 * text after it, and because both sides of a cut are moved the same way the
 * spans stay adjacent and in order.
 */
export function snapForward({ cuts }: Clusters, offset: number): number {
  let low = 0;
  let high = cuts.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cuts[mid] < offset) low = mid + 1;
    else high = mid;
  }
  return cuts[low];
}

/**
 * `[start, end)` with whole whitespace clusters taken off each end, both
 * offsets already on cluster boundaries.
 *
 * Trimming is not cosmetic. A clip's cache identity is provider, voice and
 * **text** (ADR 0009, 0010), so `Hello. ` and `Hello.` would be two entries
 * for one sentence and the second would be paid for twice; and a highlight
 * that runs to the end of a trailing newline draws a box past the end of the
 * line. By clusters rather than `String.trim` so that the `́` of a space
 * that carries one is not left behind on its own — a whitespace character
 * with a combining mark is one cluster and is not blank.
 *
 * An empty result means there was nothing here but whitespace: no utterance.
 */
export function trimToClusters(clusters: Clusters, start: number, end: number): { start: number; end: number } {
  const { cuts, blank } = clusters;
  let from = indexOfCut(cuts, start);
  let to = indexOfCut(cuts, end);
  while (from < to && blank[from]) from++;
  while (to > from && blank[to - 1]) to--;
  return { start: cuts[from], end: cuts[to] };
}

/** The position of `offset` in `cuts`; `offset` is always one of them here, so a miss would be a bug and is loud. */
function indexOfCut(cuts: readonly number[], offset: number): number {
  let low = 0;
  let high = cuts.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cuts[mid] < offset) low = mid + 1;
    else high = mid;
  }
  if (cuts[low] !== offset) throw new Error(`offset ${offset} is not a grapheme cluster boundary`);
  return low;
}

/**
 * The last cluster boundary at or before `limit` that a cut may use: after a
 * whitespace cluster where there is one, else the boundary itself.
 *
 * This is the cut of last resort — what a block with no sentence terminator in
 * it gets (see `maxLength` in index.ts). Whitespace first because a cut
 * between words is the only one a listener does not notice; a bare cluster
 * boundary is for the scripts that write without spaces, where no word
 * segmenter is available to do better.
 */
export function lastSafeCut(clusters: Clusters, from: number, limit: number): number {
  const { cuts, blank } = clusters;
  let best = -1;
  let fallback = -1;
  // From `from`'s own cluster rather than from the start of the text: a chapter
  // a converter emitted as one Block is cut a capful at a time, and a scan from
  // zero each time would make that quadratic in the length of the chapter.
  for (let i = indexOfCut(cuts, from); i < blank.length; i++) {
    const after = cuts[i + 1];
    if (after <= from) continue;
    if (after > limit) break;
    fallback = after;
    if (blank[i]) best = after;
  }
  return best > from ? best : fallback;
}
