import { describe, expect, it } from 'vitest';

import type { Block } from '../../src/core/segmenter';
import { documentLanguage, samePrefix, segmentDocument } from '../../src/app/segment';

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
