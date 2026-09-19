import { blockRuns, type Block, type BlockRun } from './rejoin';
import { sentenceSpans, type Span, type SplitSentences } from './sentences';
import { isSpeakable } from './speakable';

export { isSpeakable } from './speakable';
export { blockRuns, continuesSentence, endsMidSentence, type Block, type BlockRole, type BlockRun } from './rejoin';
export { sentenceSpans, type Span, type SplitSentences } from './sentences';

/**
 * The text of a **Block** as **Utterances**, one sentence each (ADR 0006).
 *
 * The whole point of this directory is the offsets, so they are what the types
 * are shaped around. An utterance is the text a Provider is asked for, and it is
 * also a place in the document the renderer has to draw a highlight over; get
 * the relation between those two wrong by one character and the highlight
 * drifts, which is the one thing this project exists to prevent
 * (docs/PHILOSOPHY.md).
 */

/**
 * The characters of one Block that an utterance covers.
 *
 * `start` and `end` are **UTF-16 code-unit offsets into that Block's own
 * text**, half-open, both on grapheme-cluster boundaries. That is the
 * convention `core/align.ts` and `core/speech-text.ts` already use — a Word
 * Timing's `charStart`/`charEnd` are code-unit offsets into the utterance's
 * text — and it is what a `Range` is built from, so nothing has to be converted
 * on the way to the renderer (ADR 0005).
 *
 * `textOffset` closes the loop, and the invariant is exact:
 *
 * ```
 * utterance.text.slice(span.textOffset, span.textOffset + span.end - span.start)
 *   === blocks[span.block].text.slice(span.start, span.end)
 * ```
 *
 * A Word Timing's offsets are into `utterance.text`, so this is how one becomes
 * a `Range`: find the span whose `textOffset` range holds it, subtract, add
 * `start`.
 */
export interface UtteranceSpan {
  /** Index into the Blocks that were passed in. */
  block: number;
  start: number;
  end: number;
  /** Where these characters begin in the utterance's own text. */
  textOffset: number;
}

/**
 * One **Utterance**: the unit sent to a Provider as one synthesis request, the
 * unit of caching, of prefetching and of resuming (CONTEXT.md).
 */
export interface Utterance {
  /**
   * What a Provider is asked for and what Word Timings index into. Trimmed of
   * whitespace at both ends, because a clip's cache identity is provider, voice
   * and text (ADR 0009, 0010) and `Hello. ` would otherwise be paid for twice.
   */
  text: string;
  /**
   * Where the text came from. One span for almost every utterance; more than
   * one only where the repair layer put back a sentence the document's markup
   * had cut (see rejoin.ts), in which case the highlight is drawn as one
   * highlight over several `Range`s — which is what the CSS Custom Highlight
   * API takes.
   *
   * A space inserted between two Blocks belongs to no span. It is in `text`,
   * because the Provider needs it, and it is in no Block, because it is not in
   * the document.
   */
  spans: UtteranceSpan[];
  /**
   * Whether there is a letter or a digit in the text. **Speakable** text goes
   * to a Provider; text that is not Speakable never does — it becomes silence
   * (CONTEXT.md). A scene break written `* * *` is an utterance, is not
   * Speakable, and is still highlighted as the reading passes it.
   */
  speakable: boolean;
}

export interface SegmenterOptions {
  /**
   * The sentence splitter (see sentences.ts). Injected, the way the provider
   * layer takes `{ fetch, getWebSocket, ... }`, and for a stated reason rather
   * than symmetry: ADR 0006 calls upstream `sentencex` "the first segmenter
   * here, not the final one", and a splitter that arrives as an argument is
   * replaced by rewiring one call site instead of editing this directory.
   * `./sentencex` binds the pinned upstream release; nothing `index.ts` imports
   * names a splitter.
   */
  splitSentences: SplitSentences;
  /** Whether to put back a sentence the document's markup cut in two. Default true; see rejoin.ts. */
  rejoin?: boolean;
  /** A cap of last resort for a Block with no sentence terminator in it. Off by default; see `SpanOptions` in sentences.ts. */
  maxLength?: number;
}

/**
 * The utterances of one document's Blocks, in reading order.
 *
 * `language` is the document's own — an EPUB's `dc:language` — and is never
 * sniffed. ADR 0006 keeps `eld` and its two megabytes out on exactly that
 * ground, and ADR 0010 accepts the consequence: a document with more than one
 * language in it is read in its one voice, because detecting per sentence would
 * reinstate the detector that was avoided.
 *
 * Every utterance returned is non-empty and trimmed; a Block that holds nothing
 * but whitespace produces none. Utterances do not overlap and are in order, and
 * their spans never cut a grapheme cluster.
 */
export function segmentBlocks(blocks: readonly Block[], language: string, options: SegmenterOptions): Utterance[] {
  const { splitSentences, rejoin = true, maxLength } = options;
  const utterances: Utterance[] = [];
  for (const run of blockRuns(blocks, rejoin)) {
    for (const span of sentenceSpans(run.text, language, splitSentences, { maxLength })) {
      const text = run.text.slice(span.start, span.end);
      utterances.push({ text, spans: spansIn(run, blocks, span), speakable: isSpeakable(text) });
    }
  }
  return utterances;
}

/**
 * The utterances of one Block's text, every span carrying `block: 0`.
 *
 * The single-Block call, which is what ADR 0006's sentence describes and what
 * most callers want. The repair layer needs neighbours to do anything, so it has
 * nothing to do here.
 */
export function segmentBlock(text: string, language: string, options: SegmenterOptions): Utterance[] {
  return segmentBlocks([{ text }], language, options);
}

/** A span of a run's text as spans of the Blocks it came from — more than one only where the span crosses a join. */
function spansIn(run: BlockRun, blocks: readonly Block[], span: Span): UtteranceSpan[] {
  const spans: UtteranceSpan[] = [];
  for (let member = 0; member < run.blocks.length; member++) {
    const at = run.offsets[member];
    const block = run.blocks[member];
    const from = Math.max(span.start, at);
    const to = Math.min(span.end, at + blocks[block].text.length);
    if (to <= from) continue;
    spans.push({ block, start: from - at, end: to - at, textOffset: from - span.start });
  }
  return spans;
}
