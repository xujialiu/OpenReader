import { describe, expect, it } from 'vitest';

import type { Utterance } from '../../src/core/segmenter';
import {
  nextParagraph,
  nextSentence,
  paragraphStart,
  previousParagraph,
  previousSentence,
  startsParagraph,
} from '../../src/playback/navigation';

/**
 * ADR 0020's four skip targets. Three of the four are index arithmetic and are
 * here to pin the two things about them that are easy to "fix" into being wrong:
 * that there is **no time threshold** on previous-sentence, and that the ends
 * **clamp and re-speak** rather than doing nothing.
 *
 * The fourth, previous-paragraph, is the one place this project diverges from
 * Zotero, and the divergence has two halves that fail in opposite directions. So
 * the case table is written out against one document and asserted position by
 * position rather than by example.
 */

/** An Utterance from one Block. Only `spans` decides anything here. */
const from = (block: number): Utterance => ({
  text: 'x',
  spans: [{ block, start: 0, end: 1, textOffset: 0 }],
  speakable: true,
});

/** What the repair layer produces: one Utterance whose sentence crosses a Block boundary (segmenter/rejoin.ts). */
const across = (first: number, second: number): Utterance => ({
  text: 'xy',
  spans: [
    { block: first, start: 0, end: 1, textOffset: 0 },
    { block: second, start: 0, end: 1, textOffset: 1 },
  ],
  speakable: true,
});

/**
 * The document every case below is measured against. Six Utterances, four Blocks,
 * and one of the Blocks welded to its neighbour by the repair layer:
 *
 * | index | spans       | Block(s)       | starts a paragraph? |
 * | ----- | ----------- | -------------- | ------------------- |
 * | 0     | B0          | first sentence | yes — the document begins |
 * | 1     | B0          | second         | no  — same Block |
 * | 2     | B1          | first sentence | yes — B1 is new |
 * | 3     | B1 → B2     | the cut sentence | no — it begins in B1, already spoken |
 * | 4     | B2          | rest of B2     | no — B2's first characters were spoken by 3 |
 * | 5     | B3          | first sentence | yes — B3 is new |
 *
 * Row 4 is the finding: B2 *is* a Block, and it is deliberately **not** a
 * navigable paragraph, because the repair layer joined it to B1 — which it does
 * only when it believes the document's markup cut one paragraph in two. So the
 * paragraphs here are [0,1], [2,3,4] and [5].
 */
const document: Utterance[] = [from(0), from(0), from(1), across(1, 2), from(2), from(3)];

describe('startsParagraph', () => {
  it('is the table above', () => {
    expect(document.map((_, index) => startsParagraph(document, index))).toEqual([true, false, true, false, false, true]);
  });

  it('is not “the first span’s Block differs from the one before it”', () => {
    // Index 4's first span is Block 2 and index 3's first span is Block 1, so
    // that rule would call 4 a paragraph start. It is not: index 3 already spoke
    // B2's first characters. The test is against index 3's **last** span.
    expect(document[4]!.spans[0]!.block).not.toBe(document[3]!.spans[0]!.block);
    expect(startsParagraph(document, 4)).toBe(false);
  });

  it('counts index 0 whatever its spans say, because the document begins there', () => {
    expect(startsParagraph([from(7)], 0)).toBe(true);
  });
});

describe('paragraphStart', () => {
  it('walks back to the first Utterance of the paragraph the position is in', () => {
    expect(document.map((_, index) => paragraphStart(document, index))).toEqual([0, 0, 2, 2, 2, 5]);
  });
});

describe('previousSentence', () => {
  it('is index − 1, with no time threshold', () => {
    // Zotero's own rule (reader.js:39417-39439 is pure index arithmetic). There
    // is no "if we are more than n seconds in, restart this one instead".
    expect(previousSentence(document, 3)).toBe(2);
    expect(previousSentence(document, 5)).toBe(4);
  });

  it('clamps at 0 — and clamping re-speaks index 0 rather than doing nothing', () => {
    // `_skipTo` stops and re-speaks unconditionally (reader.js:39460-39470), and
    // the engine's own `seek` is `restart(); pump()`, so returning 0 here is what
    // restarts the first Utterance. Returning "nothing" would be a different
    // product.
    expect(previousSentence(document, 0)).toBe(0);
  });

  it('crosses a Block with no special case, because a Block is not a boundary for a sentence skip', () => {
    expect(previousSentence(document, 2)).toBe(1);
  });
});

describe('nextSentence', () => {
  it('is index + 1', () => {
    expect(nextSentence(document, 0)).toBe(1);
    expect(nextSentence(document, 4)).toBe(5);
  });

  it('clamps at the last Utterance, which re-speaks it', () => {
    expect(nextSentence(document, 5)).toBe(5);
  });
});

describe('previousParagraph', () => {
  /**
   * The divergence from Zotero, both halves. Zotero skips an extra paragraph
   * when the position is mid-paragraph ("so paragraphs are treated as a single
   * unit for skipping", reader.js:39424-39438); we do not, because a paragraph in
   * the owner's novel runs to half a minute and "read that paragraph again" must
   * be reachable in one press (ADR 0020).
   */
  it('goes to the current paragraph’s first Utterance when the position is not already there', () => {
    expect(previousParagraph(document, 1)).toBe(0);
    expect(previousParagraph(document, 3)).toBe(2);
    expect(previousParagraph(document, 4)).toBe(2);
  });

  it('goes to the previous paragraph’s first Utterance when it is', () => {
    expect(previousParagraph(document, 2)).toBe(0);
    expect(previousParagraph(document, 5)).toBe(2);
  });

  it('is Zotero’s answer only where the two rules agree, and never skips two paragraphs', () => {
    // From index 4, mid-paragraph, Zotero would land on 0. Landing on 0 here
    // would mean the extra skip came back; landing on 4 would mean the
    // at-the-start half is firing when it should not.
    expect(previousParagraph(document, 4)).toBe(2);
  });

  it('clamps at 0 from the first paragraph, and re-speaks it', () => {
    expect(previousParagraph(document, 0)).toBe(0);
    expect(previousParagraph(document, 1)).toBe(0);
  });

  it('is the whole table', () => {
    expect(document.map((_, index) => previousParagraph(document, index))).toEqual([0, 0, 0, 2, 2, 2]);
  });

  it('walks the document backwards one paragraph at a time from the end', () => {
    // Repeated presses must terminate at 0 rather than oscillate: the guard on
    // the mid-paragraph half is that it always returns something smaller.
    const visited: number[] = [];
    let at = 5;
    for (let press = 0; press < 6; press++) {
      at = previousParagraph(document, at);
      visited.push(at);
    }
    expect(visited).toEqual([2, 0, 0, 0, 0, 0]);
  });
});

describe('nextParagraph', () => {
  it('goes to the next paragraph’s first Utterance, from anywhere inside the current one', () => {
    expect(nextParagraph(document, 0)).toBe(2);
    expect(nextParagraph(document, 1)).toBe(2);
    expect(nextParagraph(document, 2)).toBe(5);
    expect(nextParagraph(document, 3)).toBe(5);
    expect(nextParagraph(document, 4)).toBe(5);
  });

  it('steps over a Block the repair layer welded to its neighbour', () => {
    // Index 4 begins Block 2. If Block 2 counted as a paragraph, next-paragraph
    // from index 2 would stop at 4 — in the middle of a sentence the reader hears
    // as one paragraph.
    expect(nextParagraph(document, 2)).not.toBe(4);
  });

  it('clamps to the last Utterance when there is no paragraph after', () => {
    expect(nextParagraph(document, 5)).toBe(5);
    // From *inside* the last paragraph, not at its start: the clamp is to the
    // last Utterance, which re-speaks the end of the document. "Stay where you
    // are" would pass the line above and fail here.
    const lastParagraphHasTwo: Utterance[] = [from(0), from(1), from(1)];
    expect(nextParagraph(lastParagraphHasTwo, 1)).toBe(2);
  });
});

describe('sections are not boundaries', () => {
  it('crosses a spine item with no special case, because the list spans the document', () => {
    // ADR 0020: ours is one document-wide list, as Zotero's `_segments` is. The
    // Utterances of two spine items are Utterances of different Blocks and
    // nothing more, so ±1 and the paragraph skips behave identically across the
    // join. Blocks 0 and 1 stand for the last of one section and the first of the
    // next.
    const spine: Utterance[] = [from(0), from(1)];
    expect(nextSentence(spine, 0)).toBe(1);
    expect(previousSentence(spine, 1)).toBe(0);
    expect(nextParagraph(spine, 0)).toBe(1);
    expect(previousParagraph(spine, 1)).toBe(0);
  });
});

describe('the position it is asked to skip from', () => {
  it('clamps an index past the end the way engine.seek does, rather than answering past it', () => {
    expect(nextSentence(document, 99)).toBe(5);
    expect(previousSentence(document, 99)).toBe(4);
    // Clamped to 5, which starts its own paragraph, so this is the previous one's start.
    expect(previousParagraph(document, 99)).toBe(2);
    expect(nextParagraph(document, -4)).toBe(2);
  });

  it('throws when there is nothing loaded, rather than seeking into an empty document', () => {
    // ADR 0020: the controls are never disabled at a document boundary, and the
    // plugin's own player disables them only when no session is open. So being
    // asked to skip with no Utterances is a caller defect, and 0 would be a
    // fabricated Reading Position.
    expect(() => previousSentence([], 0)).toThrow(RangeError);
    expect(() => nextSentence([], 0)).toThrow(RangeError);
    expect(() => previousParagraph([], 0)).toThrow(RangeError);
    expect(() => nextParagraph([], 0)).toThrow(RangeError);
  });

  it('throws on a position that is not a number, which would otherwise become a cursor of NaN', () => {
    expect(() => nextSentence(document, Number.NaN)).toThrow(RangeError);
    expect(() => previousParagraph(document, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
