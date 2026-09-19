import { describe, expect, it } from 'vitest';

import type { Block } from '../../src/core/segmenter';
import { documentLanguage, firstUtteranceOfSection, outOfTextSentence, samePrefix, segmentDocument } from '../../src/app/segment';

/**
 * The splitter is bound here and nowhere else (ADR 0006), and the app segments
 * the document again every time epub.js renders a section it has not seen. Both
 * halves of that are reachable from Node, and the second is the one that can go
 * silently wrong: an Utterance is identified to the engine by its index.
 */

const blocks = (...texts: string[]): Block[] => texts.map((text) => ({ text }));

describe('segmentDocument', () => {
  it('splits Blocks into one Utterance per sentence, with upstream sentencex bound', () => {
    const found = segmentDocument(blocks('One. Two. Three.'), 'en');
    expect(found.map((utterance) => utterance.text)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('keeps each Utterance pointing back at the Block it came from', () => {
    const found = segmentDocument(blocks('First paragraph.', 'Second paragraph.'), 'en');
    expect(found.map((utterance) => utterance.spans.map((span) => span.block))).toEqual([[0], [1]]);
  });

  it('marks text with no letter or digit in it as not Speakable, so it is never sent to a Provider', () => {
    const found = segmentDocument(blocks('* * *'), 'en');
    expect(found).toHaveLength(1);
    expect(found[0].speakable).toBe(false);
  });
});

describe('documentLanguage', () => {
  it('uses the language the document declares', () => {
    expect(documentLanguage('fr')).toEqual({ language: 'fr', declared: true });
  });

  it('falls back to English and says the document declared none, rather than guessing from the text', () => {
    expect(documentLanguage(undefined)).toEqual({ language: 'en', declared: false });
    expect(documentLanguage('   ')).toEqual({ language: 'en', declared: false });
    expect(documentLanguage(null)).toEqual({ language: 'en', declared: false });
  });
});

describe('samePrefix', () => {
  const first = segmentDocument(blocks('One. Two.'), 'en');
  const appended = segmentDocument(blocks('One. Two.', 'Three.'), 'en');
  const prepended = segmentDocument(blocks('Nought.', 'One. Two.'), 'en');

  it('accepts a longer list that starts with the same Utterances — a section rendered after the one being read', () => {
    expect(samePrefix(first, appended)).toBe(true);
  });

  it('refuses a list that renumbers what the engine is holding — a section rendered out of order', () => {
    expect(samePrefix(first, prepended)).toBe(false);
  });

  it('refuses a shorter list, which cannot contain what is being read', () => {
    expect(samePrefix(appended, first)).toBe(false);
  });

  it('accepts an unchanged list, which is what a re-rendered section produces', () => {
    expect(samePrefix(first, segmentDocument(blocks('One. Two.'), 'en'))).toBe(true);
  });

  it('compares the text rather than the objects, because the list is built again each time', () => {
    expect(samePrefix(first, first.map((utterance) => ({ ...utterance })))).toBe(true);
  });
});

/**
 * The second half of a contents tap (ADR 0020).
 *
 * `goToSection` moves the page; the reading can only follow once that section has
 * reported its Blocks, and this is the index it follows to. Getting it wrong means
 * tapping a chapter and being read a different one, which is the confidently wrong
 * answer ADR 0020 calls the expensive defect.
 */
describe('firstUtteranceOfSection', () => {
  /** Two Blocks per section, as `blocks.ts` concatenates them: by spine index, in reading order. */
  const sectioned = [
    { text: 'Cover art.', sectionIndex: 0 },
    { text: 'Chapter one begins. It runs on.', sectionIndex: 3 },
    { text: 'Chapter two begins.', sectionIndex: 4 },
  ];
  const utterances = segmentDocument(sectioned, 'en');

  it('finds the first Utterance of the section asked for, not the first of the document', () => {
    expect(utterances.map((one) => one.text)).toEqual([
      'Cover art.',
      'Chapter one begins.',
      'It runs on.',
      'Chapter two begins.',
    ]);
    expect(firstUtteranceOfSection(utterances, sectioned, 0)).toBe(0);
    expect(firstUtteranceOfSection(utterances, sectioned, 3)).toBe(1);
    expect(firstUtteranceOfSection(utterances, sectioned, 4)).toBe(3);
  });

  it('answers null for a section that has no text, which is an ordinary destination', () => {
    // A volume's title page is a real row in the contents and carries nothing to
    // read; the owner's book has thirteen of them. The page still moves there.
    expect(firstUtteranceOfSection(utterances, sectioned, 1)).toBeNull();
    expect(firstUtteranceOfSection([], sectioned, 3)).toBeNull();
  });
});

/**
 * The two ends of a reading, which are not the same thing to say.
 *
 * On 2026-09-20 at 04:43 the reading stopped at the end of the sections epub.js
 * had rendered, with 2,073 of the owner's 2,077 spine items still ahead of it,
 * and said nothing at all. Now it says something — and the sentence has to be the
 * right one of two, because "that was the last of this document" on a book with
 * two thousand chapters left in it would be a worse lie than the silence.
 */
describe('outOfTextSentence', () => {
  it('is the end of the book at the last spine item', () => {
    const answer = outOfTextSentence(11, 12);
    expect(answer.ended).toBe(true);
    expect(answer.sentence).toContain('the end of the book');
  });

  it('is not the end of the book with sections still to render', () => {
    // The 04:43 state: spine item 4 of 2,077.
    const answer = outOfTextSentence(4, 2077);
    expect(answer.ended).toBe(false);
    expect(answer.sentence).toContain('waiting for more of it');
    expect(answer.sentence).not.toContain('the end of the book');
  });

  it('is never the end of a document that has not said how long it is', () => {
    // The spine arrives in its own message and is zero until it does. A document
    // of unknown length is not a document that has finished.
    expect(outOfTextSentence(-1, 0).ended).toBe(false);
    expect(outOfTextSentence(40, 0).ended).toBe(false);
  });

  it('reads the furthest section reported, not a count of sections with text in them', () => {
    // A colophon that rendered and held nothing still moves the furthest mark, and
    // the end of a book is exactly where those live.
    expect(outOfTextSentence(2076, 2077).ended).toBe(true);
    expect(outOfTextSentence(2075, 2077).ended).toBe(false);
  });
});
