import { describe, expect, it } from 'vitest';

import type { Utterance } from '../../src/core/segmenter';
import { DEFAULT_GAP, framesFor, gapContentSeconds, startsNewBlock, UNSPEAKABLE_MS } from '../../src/playback/gap';

/**
 * The gap timer ADR 0006 names. In an audio graph it is silence appended to the
 * Utterance's own buffer rather than a `setTimeout`, which is what makes it
 * follow the playback speed: the time-stretch divides it exactly as it divides
 * the speech. The plugin had to do that division by hand (issue #44) because
 * Zotero's own gaps do not follow the speed.
 *
 * So what there is to test here is the arithmetic and the paragraph test.
 */

/** An Utterance whose characters came from one Block. Only `spans` matters here. */
const from = (block: number): Utterance => ({
  text: 'x',
  spans: [{ block, start: 0, end: 1, textOffset: 0 }],
  speakable: true,
});

/** What the repair layer produces: one Utterance spanning two Blocks (segmenter/rejoin.ts). */
const across = (first: number, second: number): Utterance => ({
  text: 'xy',
  spans: [
    { block: first, start: 0, end: 1, textOffset: 0 },
    { block: second, start: 0, end: 1, textOffset: 1 },
  ],
  speakable: true,
});

describe('DEFAULT_GAP', () => {
  it('is Zotero’s own pair, so a reader hears what they are used to', () => {
    // sentenceDelay is 0 for every voice the plugin publishes; DELAY_PARAGRAPH is 200.
    expect(DEFAULT_GAP).toEqual({ sentenceMs: 0, paragraphMs: 200 });
  });

  it('gives a paragraph the 200 ms it had while Zotero’s extra was added on top of a 0 ms sentence pause', () => {
    expect(gapContentSeconds(DEFAULT_GAP, true)).toBeCloseTo(0.2, 12);
  });
});

describe('startsNewBlock', () => {
  it('is false between two Utterances of the same Block', () => {
    expect(startsNewBlock(from(0), from(0))).toBe(false);
  });

  it('is true where the next Utterance begins a Block the reading has not been in', () => {
    expect(startsNewBlock(from(0), from(1))).toBe(true);
  });

  it('compares the last span of one against the first span of the next', () => {
    // A rejoined Utterance ends in Block 1, and the next Utterance continues
    // Block 1 — the reading has already crossed into it, so this is not a
    // paragraph boundary.
    expect(startsNewBlock(across(0, 1), from(1))).toBe(false);
    expect(startsNewBlock(across(0, 1), from(2))).toBe(true);
  });

  it('counts the end of the document as a boundary, so the reading does not stop mid-breath', () => {
    expect(startsNewBlock(from(3), undefined)).toBe(true);
  });

  it('answers false rather than throwing for an Utterance with no spans', () => {
    const orphan: Utterance = { text: ' ', spans: [], speakable: false };
    expect(startsNewBlock(orphan, from(0))).toBe(false);
    expect(startsNewBlock(from(0), orphan)).toBe(false);
  });
});

describe('gapContentSeconds', () => {
  it('is the sentence gap between two Utterances of one Block', () => {
    expect(gapContentSeconds({ sentenceMs: 120, paragraphMs: 200 }, false)).toBeCloseTo(0.12, 12);
  });

  it('is the paragraph pause alone where a Block begins: the whole pause, not an extra (#60)', () => {
    expect(gapContentSeconds({ sentenceMs: 120, paragraphMs: 200 }, true)).toBeCloseTo(0.2, 12);
  });

  it('plays a paragraph pause set below the sentence pause as set, rather than raising it', () => {
    // Raising it would make the paragraph setting silently do nothing below the
    // sentence pause (ADR 0047).
    expect(gapContentSeconds({ sentenceMs: 500, paragraphMs: 200 }, true)).toBeCloseTo(0.2, 12);
    expect(gapContentSeconds({ sentenceMs: 500, paragraphMs: 200 }, false)).toBeCloseTo(0.5, 12);
  });

  it('is silence at a paragraph when the paragraph pause is 0, whatever the sentence pause', () => {
    expect(gapContentSeconds({ sentenceMs: 300, paragraphMs: 0 }, true)).toBe(0);
  });

  it('is zero with the default sentence gap and no paragraph ahead', () => {
    expect(gapContentSeconds(DEFAULT_GAP, false)).toBe(0);
  });

  it('refuses a negative or broken setting instead of producing a negative duration', () => {
    expect(gapContentSeconds({ sentenceMs: -500, paragraphMs: Number.NaN }, true)).toBe(0);
    expect(gapContentSeconds({ sentenceMs: -500, paragraphMs: Number.NaN }, false)).toBe(0);
  });

  it('is in content seconds, which is what makes the gap follow the speed', () => {
    // 200 ms of content is 100 ms of silence at 2x, because the same
    // time-stretch runs over it as over the speech. The plugin had to divide by
    // the speed by hand to get this.
    expect(gapContentSeconds({ sentenceMs: 0, paragraphMs: 200 }, true)).toBeCloseTo(0.2, 12);
  });
});

describe('framesFor', () => {
  it('rounds to whole frames, because frames are what the buffer holds', () => {
    expect(framesFor(0.2, 24_000)).toBe(4800);
    expect(framesFor(1 / 3, 24_000)).toBe(8000);
  });

  it('is zero for no gap and for nonsense', () => {
    expect(framesFor(0, 24_000)).toBe(0);
    expect(framesFor(-1, 24_000)).toBe(0);
    expect(framesFor(Number.NaN, 24_000)).toBe(0);
  });
});

describe('UNSPEAKABLE_MS', () => {
  it('is a beat and not an estimate of speaking time', () => {
    // Text that is not Speakable is never sent to a Provider (CONTEXT.md), so
    // there is no reported duration to use and philosophy rule 1 forbids
    // inventing one. A fixed beat is the honest answer.
    expect(UNSPEAKABLE_MS).toBe(300);
  });
});
