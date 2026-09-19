import { describe, expect, it } from 'vitest';

import { createLocator, readingPositionAt, type ReadingPosition } from '../../src/core/document';
import type { Timestamp } from '../../src/core/providers/types';
import { segmentBlocks, type Block, type Utterance } from '../../src/core/segmenter';
import { splitWithSentencex } from '../../src/core/segmenter/sentencex';
import type { ClipCue, PositionCorrection } from '../../src/playback/reader-clock';
import type { ReportedBlock, SpeakMessage } from '../../src/renderer/messages';
import {
  anchoredRangesOf,
  clampElapsed,
  correctMessage,
  rangesOf,
  reportedPlaces,
  resolveResume,
  resumeSentence,
  speakMessage,
  utteranceAt,
  utteranceRanges,
  wordCues,
  wordIndexAt,
} from '../../src/renderer/cursor';

/**
 * The coordinate chain, end to end, with the real segmenter at one end of it.
 *
 * A Word Timing's offsets are into the **Utterance's** text; a highlight is drawn
 * over a **Block's** text; `UtteranceSpan` is the only thing that knows the
 * difference. Get the chain wrong by one character and the highlight drifts, which
 * is the one thing this project exists to prevent (docs/PHILOSOPHY.md) — so the
 * fixtures here are segmented by `sentencex` rather than written by hand, because a
 * hand-written span is a restatement of the belief being tested.
 *
 * What is **not** here is the WebView: ADR 0011 puts the last step of the chain — a
 * Block offset into a DOM `Range` — inside Safari's JavaScript, which no Node test
 * environment simulates (test/README.md). See `rules.test.ts` for what can be
 * checked about it without one.
 */

const options = { splitSentences: splitWithSentencex };

function segment(blocks: readonly Block[]): Utterance[] {
  return segmentBlocks(blocks, 'en', options);
}

/** `'0.0'`, `'0.1'`, … — the shape of a real `ReportedBlock.id`, which is a spine index and an ordinal. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, at) => '0.' + at);
}

/**
 * Every range must be exactly the characters of the Block it names, and the
 * anchored text must be exactly the characters of the Utterance it came from. This
 * is the invariant `core/segmenter/index.ts` states, read from the other end.
 */
function checkRanges(utterance: Utterance, blocks: readonly Block[], from: number, to: number): string {
  const blockIds = ids(blocks.length);
  const ranges = anchoredRangesOf(utterance, blockIds, from, to);
  let rebuilt = '';
  for (const range of ranges) {
    const block = blocks[blockIds.indexOf(range.block)];
    expect(block.text.slice(range.start, range.end)).toBe(range.text);
    rebuilt += range.text;
  }
  return rebuilt;
}

describe('a Word Timing becoming a place in the document', () => {
  const blocks: Block[] = [{ text: 'Hello there. Goodbye now.' }];

  it('turns an offset into the Utterance into an offset into the Block', () => {
    const [, second] = segment(blocks);
    expect(second.text).toBe('Goodbye now.');
    // 'Goodbye' is characters 0–7 of the Utterance and characters 13–20 of the
    // Block. Forgetting to add the span's start puts the highlight thirteen
    // characters early, on 'Hello there. G'.
    expect(rangesOf(second, ids(1), 0, 7)).toEqual([{ block: '0.0', start: 13, end: 20 }]);
  });

  it('covers the whole Utterance at utterance level', () => {
    const [first, second] = segment(blocks);
    expect(utteranceRanges(first, ids(1))).toEqual([
      { block: '0.0', start: 0, end: 12, text: 'Hello there.' },
    ]);
    expect(utteranceRanges(second, ids(1))).toEqual([
      { block: '0.0', start: 13, end: 25, text: 'Goodbye now.' },
    ]);
  });

  it('is exact for every single character of every Utterance', () => {
    // The property that no worked example proves: one character in the Utterance
    // is one character in the Block, at every position, in both Utterances.
    for (const utterance of segment(blocks)) {
      for (let at = 0; at < utterance.text.length; at++) {
        expect(checkRanges(utterance, blocks, at, at + 1)).toBe(utterance.text[at]);
      }
    }
  });

  it('names the Block by the id the WebView gave it, never by an index', () => {
    const [first] = segment(blocks);
    expect(rangesOf(first, ['whatever-the-webview-called-it'], 0, 5)[0].block).toBe(
      'whatever-the-webview-called-it',
    );
  });

  it('reports nothing for a Block the caller did not pass, rather than a neighbour', () => {
    const [first] = segment(blocks);
    // ADR 0008: a locator that quietly lands in the wrong place is worse than no
    // locator. An empty list means the reading and the document are out of step.
    expect(rangesOf(first, [], 0, 5)).toEqual([]);
  });
});

describe('an Utterance the document had cut in two (rejoin.ts)', () => {
  const blocks: Block[] = [
    { text: 'He said that', role: 'paragraph', section: 'c1' },
    { text: 'it was fine.', role: 'paragraph', section: 'c1' },
  ];

  it('is one highlight over several ranges, which is what the CSS Custom Highlight API takes', () => {
    const [utterance] = segment(blocks);
    expect(utterance.text).toBe('He said that it was fine.');
    expect(utteranceRanges(utterance, ids(2))).toEqual([
      { block: '0.0', start: 0, end: 12, text: 'He said that' },
      { block: '0.1', start: 0, end: 12, text: 'it was fine.' },
    ]);
  });

  it('splits a word that straddles the join into a range in each Block', () => {
    const [utterance] = segment(blocks);
    // 'that it' — four characters at the end of the first Block and two at the
    // start of the second, with the inserted space in neither.
    expect(utterance.text.slice(8, 15)).toBe('that it');
    expect(rangesOf(utterance, ids(2), 8, 15)).toEqual([
      { block: '0.0', start: 8, end: 12 },
      { block: '0.1', start: 0, end: 2 },
    ]);
  });

  it('gives no range for the space the repair layer inserted, because it is in no Block', () => {
    const [utterance] = segment(blocks);
    expect(utterance.text[12]).toBe(' ');
    // Empty is not an error and not a clear: the WebView leaves the highlight
    // where it is, because that space is in the text the Provider was given and in
    // no part of the document.
    expect(rangesOf(utterance, ids(2), 12, 13)).toEqual([]);
  });

  it('is exact for every character except the one that belongs to no Block', () => {
    const [utterance] = segment(blocks);
    for (let at = 0; at < utterance.text.length; at++) {
      expect(checkRanges(utterance, blocks, at, at + 1)).toBe(at === 12 ? '' : utterance.text[at]);
    }
  });
});

describe('wordCues', () => {
  const blocks: Block[] = [{ text: 'One two three.' }];
  const timings: Timestamp[] = [
    { start: 0, end: 0.2, charStart: 0, charEnd: 3 },
    { start: 0.2, end: 0.5, charStart: 4, charEnd: 7 },
    { start: 0.5, end: 0.9, charStart: 8, charEnd: 13 },
  ];

  it('converts seconds to milliseconds and does nothing else to the time', () => {
    const [utterance] = segment(blocks);
    // ADR 0005: the timings arrived already scaled for the playback rate —
    // rate.ts divided them, once per Clip. Scaling again is the single easiest way
    // to reintroduce drift, so there is no rate in this arithmetic to apply.
    expect(wordCues(utterance, ids(1), timings).map((cue) => cue.atMs)).toEqual([0, 200, 500]);
  });

  it('maps each word onto the Block it is in', () => {
    const [utterance] = segment(blocks);
    expect(wordCues(utterance, ids(1), timings).map((cue) => cue.ranges)).toEqual([
      [{ block: '0.0', start: 0, end: 3 }],
      [{ block: '0.0', start: 4, end: 7 }],
      [{ block: '0.0', start: 8, end: 13 }],
    ]);
  });

  it('holds a negative start at zero without touching the timing itself', () => {
    const [utterance] = segment(blocks);
    // core/align.ts arrived with a kokoro-negative-start.json fixture: a Provider
    // really does report one. The timing is kept; only its epoch is not allowed to
    // precede the Clip.
    const negative: Timestamp[] = [{ start: -0.05, end: 0.2, charStart: 0, charEnd: 3 }];
    expect(wordCues(utterance, ids(1), negative)[0].atMs).toBe(0);
  });

  it('leaves the order the Provider reported alone', () => {
    const [utterance] = segment(blocks);
    const reversed = [timings[2], timings[0], timings[1]];
    // Sorting would be a quiet rewrite of what the Provider said, and philosophy
    // rule 1 does not distinguish repairing a timing from estimating one.
    expect(wordCues(utterance, ids(1), reversed).map((cue) => cue.atMs)).toEqual([500, 0, 200]);
  });
});

describe('wordIndexAt', () => {
  const words = [{ atMs: 0, ranges: [] }, { atMs: 200, ranges: [] }, { atMs: 500, ranges: [] }];

  it('is -1 before the first word', () => {
    expect(wordIndexAt(words, -1)).toBe(-1);
    expect(wordIndexAt([], 1000)).toBe(-1);
  });

  it('takes a word the moment its time arrives, not after it', () => {
    expect(wordIndexAt(words, 0)).toBe(0);
    expect(wordIndexAt(words, 199)).toBe(0);
    expect(wordIndexAt(words, 200)).toBe(1);
    expect(wordIndexAt(words, 10_000)).toBe(2);
  });

  it('is a forward scan, so it agrees with the loop rather than with a sort', () => {
    // A binary search would find the 900 and report word 2; the WebView's loop
    // stops at the first word whose time has not come. The two must not disagree,
    // so this is defined as the loop and not as a search.
    const unsorted = [{ atMs: 0, ranges: [] }, { atMs: 900, ranges: [] }, { atMs: 100, ranges: [] }];
    expect(wordIndexAt(unsorted, 500)).toBe(0);
    expect(wordIndexAt(unsorted, 1000)).toBe(2);
  });
});

describe('clampElapsed', () => {
  it('keeps the highlight on the words and out of the gap that follows', () => {
    expect(clampElapsed(-50, 1000)).toBe(0);
    expect(clampElapsed(400, 1000)).toBe(400);
    expect(clampElapsed(1500, 1000)).toBe(1000);
  });

  it('reads a number that is not a finite one as the start of the Clip', () => {
    // The same rule as rate.ts's clampRate, and for the same reason: a broken
    // number must not stop the reading, and one answer is easier to reason about
    // than two.
    expect(clampElapsed(Number.NaN, 1000)).toBe(0);
    expect(clampElapsed(Number.POSITIVE_INFINITY, 1000)).toBe(0);
    expect(clampElapsed(500, -1)).toBe(0);
  });
});

describe('speakMessage', () => {
  const blocks: Block[] = [{ text: 'One two three.' }];
  const timings: Timestamp[] = [
    { start: 0, end: 0.2, charStart: 0, charEnd: 3 },
    { start: 0.2, end: 0.5, charStart: 4, charEnd: 7 },
  ];
  const cue = (over: Partial<ClipCue> = {}): ClipCue => ({
    utterance: 0,
    words: timings,
    duration: 0.9,
    rate: 2,
    ...over,
  });

  it('carries the whole Word Timing array, once', () => {
    const message = speakMessage(cue(), segment(blocks), ids(1), { reveal: true });
    expect(message?.words).toHaveLength(2);
    expect(message?.durationMs).toBe(900);
    expect(message?.utteranceRanges).toEqual([
      { block: '0.0', start: 0, end: 14, text: 'One two three.' },
    ]);
  });

  it('carries no position, because a Clip that has just started is at zero', () => {
    const message = speakMessage(cue(), segment(blocks), ids(1), { reveal: false });
    // `ClipCue` carries none either, and for the same reason: it is sent from the
    // buffer boundary itself. Where the engine cues mid-Clip it corrects in the
    // same turn.
    expect(message).not.toBeNull();
    expect(message).not.toHaveProperty('elapsedMs');
    expect(message).not.toHaveProperty('word');
  });

  it('does not scale the timings by the rate a second time', () => {
    const fast = speakMessage(cue({ rate: 3 }), segment(blocks), ids(1), { reveal: false });
    const slow = speakMessage(cue({ rate: 1 }), segment(blocks), ids(1), { reveal: false });
    expect(fast?.words?.map((word) => word.atMs)).toEqual([0, 200]);
    expect(slow?.words?.map((word) => word.atMs)).toEqual([0, 200]);
  });

  it('passes a Provider that reported no Word Timings straight through as null', () => {
    const message = speakMessage(cue({ words: null }), segment(blocks), ids(1), { reveal: false });
    // ADR 0005's Highlight Level: the Utterance is highlighted whole. Nothing here
    // fills the gap — not an estimate, not an even division of the duration.
    expect(message?.words).toBeNull();
    expect(message?.utteranceRanges).toHaveLength(1);
  });

  it('says nothing at all when the reading and the document are out of step', () => {
    const utterances = segment(blocks);
    expect(speakMessage(cue({ utterance: 99 }), utterances, ids(1), { reveal: false })).toBeNull();
    expect(speakMessage(cue(), utterances, [], { reveal: false })).toBeNull();
    expect(speakMessage(cue(), [], ids(1), { reveal: false })).toBeNull();
  });
});

describe('correctMessage', () => {
  const blocks: Block[] = [{ text: 'One two three.' }];
  const timings: Timestamp[] = [
    { start: 0, end: 0.2, charStart: 0, charEnd: 3 },
    { start: 0.2, end: 0.5, charStart: 4, charEnd: 7 },
    { start: 0.5, end: 0.9, charStart: 8, charEnd: 13 },
  ];
  const cued = (words: Timestamp[] | null = timings): SpeakMessage =>
    speakMessage({ utterance: 0, words, duration: 0.9, rate: 2 }, segment(blocks), ids(1), {
      reveal: false,
    })!;
  const correction = (over: Partial<PositionCorrection> = {}): PositionCorrection => ({
    utterance: 0,
    clipPosition: 0.25,
    contentPosition: 12.5,
    inGap: false,
    ...over,
  });

  it('carries the position and the word it lands on', () => {
    expect(correctMessage(correction(), cued())).toEqual({
      kind: 'correct',
      utterance: 0,
      elapsedMs: 250,
      word: 1,
      hold: false,
    });
  });

  it('holds the last word through the gap and advances nothing', () => {
    // gap.ts appends silence to the Utterance's own buffer, so the position keeps
    // advancing across the pause; the highlight belongs on the words.
    const message = correctMessage(correction({ clipPosition: 0.9, inGap: true }), cued());
    expect(message).toEqual({ kind: 'correct', utterance: 0, elapsedMs: 900, word: 2, hold: true });
  });

  it('never runs past the end of the speech', () => {
    expect(correctMessage(correction({ clipPosition: 5 }), cued())?.elapsedMs).toBe(900);
  });

  it('has no word to report when the Provider reported none', () => {
    expect(correctMessage(correction(), cued(null))?.word).toBe(-1);
  });

  it('drops a correction for an Utterance the renderer is not showing', () => {
    // engine.ts re-cues before correcting when it notices the Clip changed, so a
    // correction that still does not match the cue is stale.
    expect(correctMessage(correction({ utterance: 7 }), cued())).toBeNull();
    expect(correctMessage(correction(), null)).toBeNull();
  });
});

/**
 * The other direction: a place in a Block becoming an Utterance (ADR 0020).
 *
 * Tap-to-seek is the half of "where am I" that replaced the progress bar, and the
 * whole of it on this side of the bridge is this one function — the WebView
 * hit-tests a point to a text node and reports a Block offset, and this says which
 * sentence to read from. Getting it wrong reads out the wrong sentence, which is
 * the same class of defect as a drifting highlight and just as silent.
 */
describe('a tapped place becoming an Utterance', () => {
  const blocks: Block[] = [{ text: 'Hello there. Goodbye now.' }];

  it('reads from the sentence the tapped character is in', () => {
    const utterances = segment(blocks);
    expect(utterances.map((one) => one.text)).toEqual(['Hello there.', 'Goodbye now.']);
    // The first character of each, the last character of each, and the middle.
    expect(utteranceAt(utterances, ids(1), '0.0', 0)).toBe(0);
    expect(utteranceAt(utterances, ids(1), '0.0', 11)).toBe(0);
    expect(utteranceAt(utterances, ids(1), '0.0', 13)).toBe(1);
    expect(utteranceAt(utterances, ids(1), '0.0', 24)).toBe(1);
  });

  it('gives the boundary between two sentences to the second, whose first character it is', () => {
    // Chinese, because the two spans have to be **adjacent** for the question to
    // arise at all: English leaves a trimmed space between them and an inclusive end
    // would be indistinguishable. Here sentence one is [0, 4) and sentence two
    // begins at 4 with no gap, so offset 4 belongs to exactly one of them — and an
    // inclusive end would give it to both, first match winning, which is the one
    // before. Every sentence boundary in the owner's book is this shape.
    const adjacent = segmentBlocks([{ text: '第一句。第二句。' }], 'zh', options);
    expect(adjacent.map((one) => one.text)).toEqual(['第一句。', '第二句。']);
    expect(adjacent[0].spans[0]).toEqual({ block: 0, start: 0, end: 4, textOffset: 0 });
    expect(adjacent[1].spans[0]).toEqual({ block: 0, start: 4, end: 8, textOffset: 0 });
    expect(utteranceAt(adjacent, ids(1), '0.0', 3)).toBe(0);
    expect(utteranceAt(adjacent, ids(1), '0.0', 4)).toBe(1);
  });

  it('gives the space between two sentences to the sentence it ends', () => {
    const utterances = segment(blocks);
    // Offset 12 is the space `sentencex` trimmed off the end of the first sentence,
    // so it is in the Block and in no span. It belongs to what it follows: tapping
    // just after a full stop reads that sentence again rather than nothing.
    expect(utterances[0].spans[0]).toEqual({ block: 0, start: 0, end: 12, textOffset: 0 });
    expect(utterances[1].spans[0]).toEqual({ block: 0, start: 13, end: 25, textOffset: 0 });
    expect(utteranceAt(utterances, ids(1), '0.0', 12)).toBe(0);
  });

  it('gives a Block’s leading whitespace to the sentence that follows it, there being none before', () => {
    const indented: Block[] = [{ text: '\n   Hello there.' }];
    const utterances = segment(indented);
    expect(utterances[0].spans[0].start).toBeGreaterThan(0);
    expect(utteranceAt(utterances, ids(1), '0.0', 0)).toBe(0);
  });

  it('finds the Utterance in the Block that was tapped, not the one at that offset elsewhere', () => {
    const two: Block[] = [{ text: 'One two three.' }, { text: 'Four five six.' }];
    const utterances = segment(two);
    expect(utteranceAt(utterances, ids(2), '0.0', 4)).toBe(0);
    expect(utteranceAt(utterances, ids(2), '0.1', 4)).toBe(1);
  });

  it('answers with the Utterance that welded two Blocks, wherever in them the tap landed', () => {
    // The repair layer joins a sentence the markup cut in two (`rejoin.ts`), so one
    // Utterance has two spans in two Blocks. Tapping either half is the same sentence.
    const cut: Block[] = [{ text: 'A sentence the markup' }, { text: 'cut in two.' }];
    const utterances = segment(cut);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].spans).toHaveLength(2);
    expect(utteranceAt(utterances, ids(2), '0.0', 3)).toBe(0);
    expect(utteranceAt(utterances, ids(2), '0.1', 3)).toBe(0);
  });

  it('does nothing for a Block no Utterance covers, and for an offset that is not a number', () => {
    const utterances = segment(blocks);
    // A tap on a Block the caller does not hold is the same as a tap on blank space:
    // null, which the bridge turns into no call at all rather than into a guess at a
    // neighbouring sentence.
    expect(utteranceAt(utterances, ids(1), '0.9', 3)).toBeNull();
    expect(utteranceAt([], ids(1), '0.0', 0)).toBeNull();
    // `NaN` falls out of the comparisons on its own; `Infinity` does not — every
    // span ends at or before it, so without the guard the answer would be the last
    // Utterance of the Block, confidently.
    expect(utteranceAt(utterances, ids(1), '0.0', Number.NaN)).toBeNull();
    expect(utteranceAt(utterances, ids(1), '0.0', Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('a stored Reading Position becoming an Utterance to read from (ADR 0008, 0019)', () => {
  /**
   * The join ADR 0019 said was missing: "playback does not resume *at* that
   * Utterance. The page is where it was; Play starts from the first Utterance of
   * what has rendered."
   *
   * The fixtures go the whole way round rather than starting from a hand-written
   * anchor — the position is built by the very call `use-reading.ts` makes,
   * `readingPositionAt(locator, block.text, span.start, span.end)` — because an
   * anchor written by hand is a restatement of the belief being tested.
   */

  /** Blocks as the renderer reports them: an id, a section and an element CFI (`messages.ts`). */
  function reported(texts: readonly string[], cfis?: readonly string[]): ReportedBlock[] {
    return texts.map((text, at) => ({
      id: '0.' + at,
      text,
      role: 'paragraph' as const,
      section: 'chapter.xhtml',
      sectionIndex: 0,
      cfi: cfis ? cfis[at] : 'epubcfi(/6/2!/4/' + (at * 2 + 2) + ')',
    }));
  }

  /** The Reading Position `use-reading.ts` writes for an Utterance: the Block's CFI, the Block's own text, the Utterance's span in it. */
  function positionOf(utterances: readonly Utterance[], blocks: readonly ReportedBlock[], at: number): ReadingPosition {
    const span = utterances[at].spans[0];
    const block = blocks[span.block];
    return readingPositionAt(createLocator('epub', block.cfi), block.text, span.start, span.end);
  }

  const paragraph = 'One sentence here. A second sentence follows it. And a third ends the paragraph.';

  it('comes back to the sentence, not to the top of the paragraph it is in', () => {
    // The defect this exists to fix, as a number: three sentences in one Block, so
    // "the first Utterance of what has rendered" and "where the reading stopped"
    // are 0 and 2 — and only one of them is right.
    const blocks = reported([paragraph]);
    const utterances = segment(blocks);
    expect(utterances).toHaveLength(3);
    const resume = resolveResume(positionOf(utterances, blocks, 2), utterances, blocks);
    expect(resume).toEqual({ outcome: 'resumed', utterance: 2, agreement: 'exact', moved: null });
  });

  it('comes back to the right sentence when the Blocks before it have been renumbered', () => {
    // The Utterance index is not stored and this is why (ADR 0008): the same book
    // with one more Block in front of the one that was quoted numbers every
    // sentence differently, and the anchor still names one place.
    const first = reported([paragraph]);
    const written = positionOf(segment(first), first, 2);

    const later = reported(['A chapter heading.', paragraph]);
    const utterances = segment(later);
    // Same sentence, different number: 2 before, 3 now.
    expect(utterances[3].text).toBe('And a third ends the paragraph.');
    expect(resolveResume(written, utterances, later)).toMatchObject({ outcome: 'resumed', utterance: 3 });
  });

  it('finds the sentence by its text when the locator no longer names it', () => {
    // The case ADR 0008's whole design exists for: a CFI that resolves to nothing,
    // or to the wrong node, must not be trusted on its own.
    const blocks = reported([paragraph]);
    const utterances = segment(blocks);
    const written = positionOf(utterances, blocks, 1);
    const moved = reported([paragraph], ['epubcfi(/6/2!/4/88)']);
    expect(resolveResume(written, utterances, moved)).toEqual({
      outcome: 'resumed',
      utterance: 1,
      agreement: 'exact',
      moved: 'locator-did-not-resolve',
    });
  });

  it('refuses rather than guessing when the locator resolves to other text', () => {
    // The exact failure ADR 0008 exists for, from the other side: the CFI *does*
    // resolve, and the words there are not the words that were quoted. Zotero's own
    // reader lands on that node silently; this one refuses. Philosophy rule 1: "a
    // bookmark that might be wrong is worse than no bookmark". There is no
    // `utterance` on the answer at all, so no caller can read one off it.
    const blocks = reported([paragraph]);
    // The same CFI, different text — the second Block array `reported` builds numbers
    // its CFIs the same way, which is what makes the locator resolve here.
    const elsewhere = reported(['Some completely different words about nothing at all.']);
    const written = positionOf(segment(blocks), blocks, 1);
    const resume = resolveResume(written, segment(elsewhere), elsewhere);
    expect(resume).toEqual({ outcome: 'lost', because: 'text-disagreed', why: 'not-found' });
    expect(resume).not.toHaveProperty('utterance');
  });

  it('refuses when the locator names nothing at all either', () => {
    const blocks = reported([paragraph]);
    const written = positionOf(segment(blocks), blocks, 1);
    const elsewhere = reported(['Some completely different words about nothing at all.'], ['epubcfi(/6/8!/4/2)']);
    expect(resolveResume(written, segment(elsewhere), elsewhere)).toEqual({
      outcome: 'lost',
      because: 'locator-did-not-resolve',
      why: 'not-found',
    });
  });

  it('refuses when two places match it equally well', () => {
    // Two identical paragraphs, and the anchor's context is empty because the
    // Utterance *is* the Block — which ADR 0019 records as the ordinary shape on the
    // owner's Chinese novel, not a corner case. Nothing may choose between them.
    const twice = reported(['He said nothing.', 'He said nothing.'], ['epubcfi(/6/2!/4/2)', 'epubcfi(/6/2!/4/4)']);
    const utterances = segment(twice);
    const written = readingPositionAt(createLocator('epub', 'epubcfi(/6/2!/4/99)'), twice[0].text, 0, twice[0].text.length);
    expect(resolveResume(written, utterances, twice)).toEqual({
      outcome: 'lost',
      because: 'locator-did-not-resolve',
      why: 'ambiguous',
    });
  });

  it('refuses a Block that has no CFI rather than naming a place it cannot name', () => {
    // `highlighter.ts` records `cfi: ''` where `cfiFromNode` threw. Two of those
    // would be one locator meaning either Block, so they are not offered as places
    // — and a stored locator that is somehow empty must not match them.
    const nameless = reported([paragraph], ['']);
    const utterances = segment(nameless);
    expect([...reportedPlaces(nameless).places()]).toHaveLength(0);
    expect(reportedPlaces(nameless).textAt(createLocator('epub', ''))).toBeNull();
    const written = readingPositionAt(createLocator('epub', ''), paragraph, 19, 48);
    expect(resolveResume(written, utterances, nameless)).toMatchObject({ outcome: 'lost' });
  });

  it('refuses a place whose Block has nothing to read aloud', () => {
    // The text is there and no Utterance covers it, which is not the same failure as
    // not finding it — and is still not a reason to pick the sentence next door.
    const blocks = reported([paragraph]);
    const written = positionOf(segment(blocks), blocks, 1);
    expect(resolveResume(written, [], blocks)).toEqual({
      outcome: 'lost',
      because: null,
      why: 'no-utterance',
    });
  });

  it('says which of the three happened, in words the player can show', () => {
    const blocks = reported([paragraph]);
    const utterances = segment(blocks);
    const plain = resumeSentence(resolveResume(positionOf(utterances, blocks, 2), utterances, blocks));
    const moved = resumeSentence(resolveResume(positionOf(utterances, blocks, 2), utterances, reported([paragraph], ['epubcfi(/9/9)'])));
    const lost = resumeSentence({ outcome: 'lost', because: 'locator-did-not-resolve', why: 'not-found' });
    expect(plain).toBe('Resumed at the sentence the reading stopped on.');
    expect(moved).toContain('found by its own text');
    expect(lost).toContain('starts at the top of this section');
    expect(new Set([plain, moved, lost]).size).toBe(3);
  });
});
