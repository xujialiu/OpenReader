import { clustersOf, lastSafeCut, snapForward, trimToClusters, type Clusters } from './graphemes';

/**
 * The sentence splitter, as an injected dependency.
 *
 * ADR 0006 settles *which* splitter: upstream `sentencex`, because Zotero's own
 * segmentation lives in a submodule with no licence file marked
 * `"private": true`, and because the algorithm underneath it is third-party and
 * freely usable. It is pinned at 0.4.2, the last release before the project
 * became Node bindings to a Rust library — `sentencex.ts` has the measurement.
 *
 * It is injected rather than imported because the same ADR says `sentencex` "is
 * the first segmenter here, not the final one". While the splitter arrives as an
 * argument, replacing it is a change at the one call site that wires it;
 * everything else here — the offsets, the grapheme safety, Speakable, the rejoin
 * — is engine independent and tested against a splitter that is not it.
 *
 * ## The contract
 *
 * Given a language tag and a text, return that text's sentences **in order**.
 * A splitter may drop the whitespace between them (the pinned `sentencex` does:
 * `segment('en', 'One. Two.').join('')` is `'One.Two.'`) but may not reorder, rewrite or
 * invent characters: offsets are recovered by finding each piece in the text
 * from a cursor that only moves forward, and a splitter that fails that test
 * is refused rather than guessed at — see `sentenceSpans`.
 *
 * The language is a parameter and is never sniffed. An EPUB declares its own
 * `dc:language` (ADR 0006), which is why no detector is here, and it is
 * load-bearing: `el` breaks `Τι κάνεις; Είμαι καλά.` in two at the Greek
 * question mark and `en` does not.
 */
export type SplitSentences = (language: string, text: string) => readonly string[];

/** A half-open range of one text, in UTF-16 code units. */
export interface Span {
  start: number;
  end: number;
}

export interface SpanOptions {
  /**
   * The longest utterance to produce, in UTF-16 code units. Undefined means no
   * cap, and that is the default: an utterance is one sentence, and a cap that
   * fires on ordinary prose would be a silent rewrite of the document.
   *
   * It exists for the block that holds no sentence terminator at all — a poem,
   * a chapter a converter emitted as one `<p>`, a Chinese paragraph punctuated
   * only with `，`. Without it such a block is one utterance of tens of
   * thousands of characters: no provider accepts it (Speechify's cap is 2000),
   * reading ahead and resuming lose all resolution, and the highlight covers
   * the screen. With it the block is cut on whitespace, or on a grapheme
   * boundary where the script has none.
   */
  maxLength?: number;
}

/**
 * The sentences of one text as spans of it, in order: trimmed, non-empty,
 * non-overlapping, ascending, and every boundary on a grapheme cluster.
 *
 * Offsets are **UTF-16 code units**, and no splitter is asked where a sentence
 * is: the pinned `sentencex` reports no offsets at all, and the 1.x line
 * reported Unicode scalar indices — its Rust strings are UTF-8 — so
 * `A \u{1F600} emoji. ` ended at its 11 and at code unit 12. The spans come from
 * locating each returned piece in the text instead. That is not
 * belt-and-braces, it is the difference between a highlight that tracks and one
 * that slides by one for the rest of a chapter.
 *
 * When the pieces cannot be located in order — the splitter rewrote the text,
 * or reordered it — the whole text comes back as one span. A guessed offset is
 * the drift this project exists to avoid (PHILOSOPHY), and one long utterance
 * is a listenable failure while a wrong offset is not.
 */
export function sentenceSpans(text: string, language: string, split: SplitSentences, options: SpanOptions = {}): Span[] {
  if (!text) return [];
  const clusters = clustersOf(text);
  const located = locate(text, split(language, text));
  const spans = located ? tidy(clusters, located) : tidy(clusters, [{ start: 0, end: text.length }]);
  return options.maxLength && options.maxLength > 0 ? capped(clusters, spans, options.maxLength) : spans;
}

const NON_SPACE = /\S/u;

/**
 * Each piece's place in the text, found from a cursor that only moves forward.
 * Null when a piece is not there, or when text with something in it was skipped
 * to reach one — either means the splitter is not returning the text it was
 * given, and no offset derived from it would be trustworthy.
 *
 * A forward-only cursor is what makes `indexOf` safe: a sentence that also
 * occurs later cannot pull the search past the text between, because the text
 * between would then fail the whitespace test. This is the same trap
 * `core/align.ts` describes from the other side, where a substring search from
 * a cursor matched `point` inside a later `branchpoints` and the highlight
 * jumped two lines down.
 */
function locate(text: string, pieces: readonly string[]): Span[] | null {
  const spans: Span[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    if (!piece) continue;
    const at = text.indexOf(piece, cursor);
    if (at < 0) return null;
    if (NON_SPACE.test(text.slice(cursor, at))) return null;
    spans.push({ start: at, end: at + piece.length });
    cursor = at + piece.length;
  }
  return NON_SPACE.test(text.slice(cursor)) ? null : spans;
}

/** Every boundary onto a cluster, every span trimmed of whitespace, the empty ones gone, order kept. */
function tidy(clusters: Clusters, spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  let previous = 0;
  for (const span of spans) {
    const start = Math.max(previous, snapForward(clusters, span.start));
    const end = Math.max(start, snapForward(clusters, span.end));
    previous = end;
    const trimmed = trimToClusters(clusters, start, end);
    if (trimmed.end > trimmed.start) out.push(trimmed);
  }
  return out;
}

/** Spans longer than the cap cut at the last whitespace before it; a single cluster over the cap is left whole, because there is nothing safe to do with it. */
function capped(clusters: Clusters, spans: readonly Span[], max: number): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    let start = span.start;
    while (span.end - start > max) {
      const cut = lastSafeCut(clusters, start, start + max);
      if (cut <= start) break;
      const piece = trimToClusters(clusters, start, cut);
      if (piece.end > piece.start) out.push(piece);
      start = cut;
    }
    const tail = trimToClusters(clusters, start, span.end);
    if (tail.end > tail.start) out.push(tail);
  }
  return out;
}
