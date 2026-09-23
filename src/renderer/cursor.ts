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
 * The chain is walked backwards twice, by the two things that start on the page
 * rather than in the engine: a **tap** (`utteranceAt`) and **coming back to a
 * book** (`resolveResume`). The second one starts further out still — at a CFI
 * and a quotation written down in a previous session — and it goes through
 * `utteranceAt` rather than beside it, because a third way of saying "this
 * offset in this Block is that sentence" is a third way for them to disagree.
 *
 * ## The units
 *
 * `ClipCue.words` arrive **already scaled for the playback rate**: `rate.ts`
 * divided them, once per Clip, and ADR 0005 calls forgetting that the single
 * easiest way to reintroduce drift. So this file converts seconds to
 * milliseconds and nothing else. There is no rate in it.
 */

import type { AnchorAgreement, LocatorProblem, Place, PlaceReader, ReadingPlace } from '../core/document';
import { createLocator, readLocator, resolveReadingPosition } from '../core/document';
import type { Timestamp } from '../core/providers/types';
import type { Utterance } from '../core/segmenter';
import type { ClipCue, PositionCorrection } from '../playback/reader-clock';

import type { AnchoredRange, BlockRange, CorrectMessage, ReportedBlock, SpeakMessage, WordCue } from './messages';

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

/**
 * The Utterance a tapped place in a Block belongs to, or null (ADR 0020).
 *
 * The other direction of this file's coordinate chain, and the whole of
 * tap-to-seek on this side of the bridge: the WebView hit-tests the tapped point
 * to a text node and reports the Block's own code-unit offset (`TapMessage`), and
 * this answers with the index to hand to `engine.seek`. **No new coordinate
 * system** — ADR 0020 is explicit that the tap is located the way a Word Timing
 * already is, and the span invariant that makes a Word Timing well defined is the
 * one that makes this well defined.
 *
 * Three answers, in this order, and the order is the decision:
 *
 * 1. **A span that contains the offset.** Half-open, `start <= offset < end`, the
 *    same convention as every other range in this file — so a tap exactly on the
 *    boundary between two sentences belongs to the second, which is the one whose
 *    first character was tapped.
 * 2. **Otherwise the nearest span that ends at or before it**, which is the
 *    sentence the tapped character *follows*. `sentenceSpans` cuts a Block's text
 *    into ordered non-overlapping spans and the whitespace it trims between two
 *    sentences is in no span at all, so this case is a tap on a space, and the
 *    honest reading of "read from here" is the sentence that space ends.
 * 3. **Otherwise the first span that starts after it** — a tap in a Block's
 *    leading whitespace, where there is no sentence before it to read from.
 *
 * Null where the Block contributes to no Utterance at all (the caller is holding a
 * Block array the Utterances were not segmented from, or the tap landed in a Block
 * of nothing but whitespace) and for an offset that is not a number. Null means
 * the tap does nothing, which is what the design file requires of a tap that lands
 * on nothing — never a guess at a neighbouring sentence.
 *
 * Containment is decided over the whole list rather than returned from the first
 * span that looks close, because the fallbacks would otherwise beat a containing
 * span that comes later in the same Block.
 */
export function utteranceAt(
  utterances: readonly Utterance[],
  blockIds: readonly string[],
  block: string,
  offset: number,
): number | null {
  if (!Number.isFinite(offset)) return null;
  let before: number | null = null;
  /** How far into the Block the best `before` candidate reaches, so a later span wins only by being nearer. */
  let beforeEnd = -1;
  let after: number | null = null;
  let afterStart = Infinity;

  for (let index = 0; index < utterances.length; index++) {
    for (const span of utterances[index].spans) {
      if (blockIds[span.block] !== block) continue;
      if (offset >= span.start && offset < span.end) return index;
      if (span.end <= offset && span.end > beforeEnd) {
        before = index;
        beforeEnd = span.end;
      }
      if (span.start > offset && span.start < afterStart) {
        after = index;
        afterStart = span.start;
      }
    }
  }
  return before ?? after;
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

/* ---- coming back to a book: a Reading Position as an Utterance to read from ---- */

/**
 * The Blocks the renderer has reported, as the document a Reading Position is
 * resolved against (ADR 0008).
 *
 * `position.ts` says the implementation of `PlaceReader` is "the renderer, which
 * is the only thing that can turn a CFI into text", and this is it: a Block
 * already carries the two things a `Place` is, its element CFI and its verbatim
 * text, so there is nothing to compute and nothing to ask the WebView for.
 *
 * **A Block epub.js could give no CFI for is not offered as a place.** Its `cfi`
 * is the empty string (`highlighter.ts` catches `cfiFromNode` and records `''`),
 * and a place that cannot be named is a place a resolution could not report back:
 * `resolveReadingPosition` answers with the `Locator` of what it found, and two
 * nameless Blocks would be one locator meaning either of them. Leaving them out
 * loses an Utterance that could in principle have been resumed to, and keeps the
 * answer unambiguous, which ADR 0008 ranks first.
 */
export function reportedPlaces(blocks: readonly ReportedBlock[]): PlaceReader {
  return {
    textAt(locator) {
      const cfi = readLocator(locator, 'epub');
      // An empty locator matches the Blocks that have no CFI rather than none of
      // them, which is the one way this lookup could answer with the wrong text.
      if (!cfi) return null;
      return findBlock(blocks, cfi)?.text ?? null;
    },
    *places(): Iterable<Place> {
      for (const block of blocks) {
        if (block.cfi) yield { locator: createLocator('epub', canonicalCfi(block.cfi)), text: block.text };
      }
    },
  };
}

/**
 * A CFI in the one spelling the Positions File allows: **no assertions**.
 *
 * epub.js writes an element's `id` into the step it generates —
 * `/6/8[cop]!/4/2/4/40[release_identifier_line]` — and the desktop plugin's
 * matcher compares paths as strings, so a Block's CFI and the same Block named
 * from the desktop differ only by these brackets. They are removed at the one
 * place a locator is minted for storage, and every comparison below is made on
 * the stripped form, so a locator written by either side finds its Block here.
 * The renderer keeps the assertions for its own `rendition.display`, where they
 * are harmless (spec 6.4; measured 2026-09-21, notes/NOTES_2026-09-21.md 17:11).
 */
export function canonicalCfi(cfi: string): string {
  return cfi.replace(/\[[^\]]*\]/g, '');
}

/** The Block a CFI names, whichever side spelled it. */
function findBlock(blocks: readonly ReportedBlock[], cfi: string): ReportedBlock | undefined {
  const wanted = canonicalCfi(cfi);
  return blocks.find((block) => block.cfi !== '' && canonicalCfi(block.cfi) === wanted);
}

/**
 * The spine index an EPUB locator names, or null: the spine step `/6/N` is
 * `N = 2 × (index + 1)`, the numbering upstream epub.js and Zotero share
 * (measured on every section of four books, notes/NOTES_2026-09-21.md 17:11).
 * Read only to ask whether that section has reported yet; the CFI itself is
 * what is resolved, and what is handed to the renderer.
 */
export function spineIndexOf(cfi: string): number | null {
  const step = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
  if (!step) return null;
  const n = Number(step[1]);
  return n >= 2 && n % 2 === 0 ? n / 2 - 1 : null;
}

/**
 * How much of the Document has rendered, as a stored place needs to know it.
 *
 * Not the Blocks: a section that rendered and holds no text has reported and
 * contributed no Block, and a place must not wait for ever on one of those.
 */
export interface RenderedSections {
  /** How many spine items the Document has. Zero while that is not known, which makes nothing wait. */
  spine: number;
  /** The spine items that have reported, whether or not they held a Block. */
  reported: ReadonlySet<number>;
}

/** Why a stored Reading Position did not name an Utterance. */
export type ResumeFailure =
  /** The anchor is nowhere in the Blocks reported so far, or nowhere that agrees well enough. */
  | 'not-found'
  /** Two places matched equally well and nothing distinguishes them. Refused rather than picked (ADR 0008). */
  | 'ambiguous'
  /** The quotation holds no letter or digit — a scene break — so only an exact character match could ever have found it. */
  | 'anchor-not-matchable'
  /** The place was found and no Utterance covers it: the Block is there and contributed none. */
  | 'no-utterance';

/**
 * What a stored Reading Position came to, against the document as it has
 * rendered so far.
 *
 * `resumed` carries the Utterance to read from and nothing else the caller has
 * to interpret. `lost` carries no number at all, deliberately: ADR 0005 refuses
 * to estimate a Word Timing for the same reason ADR 0008 refuses to resume three
 * paragraphs away, and "the first Utterance of what has rendered" is a decision
 * for the caller to make openly rather than one to disguise as a resolution.
 * `waiting` is neither yet: the section the locator names has not rendered, so
 * nothing has been compared with anything (#51).
 */
export type Resume =
  | {
      outcome: 'waiting';
      /** The spine item the stored locator names, which has not reported yet. */
      section: number;
    }
  | {
      outcome: 'resumed';
      utterance: number;
      agreement: AnchorAgreement;
      /**
       * Null when the stored locator named the place it claimed. Otherwise what
       * was wrong with it — the anchor found the place somewhere else, which is
       * the case ADR 0008's whole design exists for.
       */
      moved: LocatorProblem | null;
    }
  | {
      outcome: 'lost';
      /** What the locator did, or null where it resolved and the Blocks simply hold no Utterance there. */
      because: LocatorProblem | null;
      why: ResumeFailure;
    };

/**
 * The Utterance a stored Reading Position names, or why it names none.
 *
 * The join ADR 0019 left out: `readingPositionAt` writes a CFI and a text
 * anchor, `resolveReadingPosition` turns those back into a place and an offset
 * in that place's text, and `utteranceAt` — the same function a tap goes through
 * — turns an offset in a Block into an Utterance index. **No new coordinate
 * system**, and in particular no Utterance number is ever stored: ADR 0008
 * refuses one because a different segmenter renumbers every sentence in the
 * book, which is exactly what makes this three steps rather than a lookup.
 *
 * `'epub'` is not an assumption: these Blocks came out of the epub.js renderer,
 * so their CFIs are an EPUB dialect by construction.
 *
 * **A place waits for the section its locator names** (#51). Until that
 * section has reported, its Blocks are not here to look the locator up in, and
 * that is not the same as a locator that does not resolve: the search would run
 * over whatever happened to report first — on a return to a book, the book's
 * own first pages — and a web novel's contents page lists every chapter's
 * title. A place stopped on a chapter heading is a Block of its own, so its
 * anchor has no context either side to tell the two apart, and the contents
 * line was taken as the place having moved. So nothing is compared until the
 * locator's own section is in, and the search, when it runs, runs over that
 * section too. A locator that names no spine item of this Document — no spine
 * step, or one past the end — has no section to wait for and is searched for at
 * once, as before.
 */
export function resolveResume(
  position: ReadingPlace,
  utterances: readonly Utterance[],
  blocks: readonly ReportedBlock[],
  rendered: RenderedSections,
): Resume {
  const named = readLocator(position.locator, 'epub');
  const section = named === null ? null : spineIndexOf(named);
  if (section !== null && section < rendered.spine && !rendered.reported.has(section)) {
    return { outcome: 'waiting', section };
  }

  const resolution = resolveReadingPosition(position, reportedPlaces(blocks));
  if (resolution.outcome === 'unresolved') {
    return { outcome: 'lost', because: resolution.because, why: resolution.search };
  }

  const moved = resolution.outcome === 'recovered' ? resolution.because : null;
  const cfi = readLocator(resolution.locator, 'epub');
  const found = cfi ? findBlock(blocks, cfi) : undefined;
  const at = found
    ? utteranceAt(utterances, blocks.map((block) => block.id), found.id, resolution.start)
    : null;
  // The text was found and nothing speaks it: a Block of whitespace, or a Block
  // array the Utterances were not segmented from. Neither is a place to resume
  // at, and neither is a reason to pick a neighbouring sentence.
  if (at === null) return { outcome: 'lost', because: moved, why: 'no-utterance' };
  return { outcome: 'resumed', utterance: at, agreement: resolution.agreement, moved };
}

/**
 * What the reader is told about the place it came back to, in one sentence.
 *
 * Here rather than on the screen because the vocabulary is this file's: the
 * distinctions it draws — the locator was right, the locator had moved, nothing
 * was found — are `PositionResolution`'s own, and a screen restating them is a
 * second place for them to drift. It is philosophy rule 1 in its smallest form:
 * a bookmark that might be wrong says so.
 *
 * Not for `waiting`, which has nothing to say yet: the place is still on its
 * way, and the screen says so only if the owner asks for something else first.
 */
export function resumeSentence(resume: Exclude<Resume, { outcome: 'waiting' }>): string {
  if (resume.outcome === 'resumed') {
    if (resume.moved !== null) {
      return (
        'The paragraph this book was left in is not where it was, so the sentence was found by its own text instead. ' +
        'The reading starts at that sentence.'
      );
    }
    if (resume.agreement === 'aligned') {
      return 'Resumed at the sentence the reading stopped on, whose wording has changed a little since it was noted.';
    }
    return 'Resumed at the sentence the reading stopped on.';
  }
  return `${LOST_BECAUSE[resume.why]} The reading starts at the top of this section rather than at a guess.`;
}

const LOST_BECAUSE: Readonly<Record<ResumeFailure, string>> = {
  'not-found': 'The sentence this book was left on is not in the text that has rendered.',
  ambiguous: 'The sentence this book was left on appears in more than one place, and nothing here can choose between them.',
  'anchor-not-matchable': 'The place this book was left at was not on any words, so there is nothing to find it by.',
  'no-utterance': 'The place this book was left at is on the page and holds nothing that can be read aloud.',
};
