import { describe, expect, it } from 'vitest';

import type { Timestamp } from '../../src/core/providers/types';
import { segmentBlocks, type Block, type Utterance } from '../../src/core/segmenter';
import { splitWithSentencex } from '../../src/core/segmenter/sentencex';
import type { ClipCue, PositionCorrection } from '../../src/playback/reader-clock';
import type { SpeakMessage } from '../../src/renderer/messages';
import {
  anchoredRangesOf,
  clampElapsed,
  correctMessage,
  rangesOf,
  speakMessage,
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
