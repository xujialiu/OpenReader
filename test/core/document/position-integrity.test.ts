import { describe, expect, it } from 'vitest';
import { createLocator, readingPlaceAt, resolveReadingPosition, type Place } from '../../../src/core/document';
import { createTextAnchor, matchAnchor } from '../../../src/core/document/anchor';
import { segmentDocument } from '../../../src/app/segment';
import { resolveResume } from '../../../src/renderer/cursor';
import type { ReportedBlock } from '../../../src/renderer/messages';

const locator = createLocator('epub', 'epubcfi(/6/2!/4/2)');
const at = (text: string, n: number): Place => ({ text, locator: createLocator('epub', `epubcfi(/6/2!/4/${2 * n})`) });

describe('a heading is not a substring of a longer word or number (#282)', () => {
  it.each([
    ['7', '1907'], ['Chapter 1', 'Chapter 10'], ['第1章', '第10章'],
    ['第一章', '第一章节'], ['猫', '猫咪'], ['é', 'café'], ['𠀀', '𠀀𠀁'],
  ])('finds %s, never %s, through either locator or fallback', (heading, longer) => {
    const stored = readingPlaceAt(locator, heading, 0, heading.length);
    const wrong = at(longer, 1);
    const right = at(heading, 2);
    for (const textAt of [() => null, () => longer]) {
      expect(resolveReadingPosition(stored, { textAt, places: () => [wrong, right] })).toMatchObject({ outcome: 'recovered', locator: right.locator, start: 0 });
      expect(resolveReadingPosition(stored, { textAt, places: () => [wrong] })).toMatchObject({ outcome: 'unresolved' });
    }
  });

  it('does not let token/approximate matching rescue a rejected substring', () => {
    const heading = 'Volume One Chapter 1';
    const anchor = createTextAnchor(heading, 0, heading.length);
    expect(matchAnchor(anchor, 'Volume One Chapter 10')).toBeNull();
    expect(matchAnchor(anchor, 'Volume  One Chapter 10')).toBeNull();
    const text = 'Volume One Chapter 10. Volume  One Chapter 1';
    expect(matchAnchor(anchor, text)).toMatchObject({ start: text.indexOf('Volume  One'), agreement: 'aligned' });
  });

  it('keeps source offsets through NFC/NFD, whitespace and punctuation controls', () => {
    const anchor = createTextAnchor('Café', 0, 4);
    expect(matchAnchor(anchor, ' Cafe\u0301 ')).toMatchObject({ start: 1, end: 6, agreement: 'exact' });
    expect(matchAnchor(anchor, 'Cafe\u0301ine')).toBeNull();
    expect(matchAnchor(createTextAnchor('Chapter 1.', 0, 10), 'Chapter 1.')).toMatchObject({ start: 0, end: 10 });
    expect(matchAnchor(createTextAnchor('Chapter 1', 0, 9), ' Chapter  1 ')).toMatchObject({ agreement: 'aligned' });
  });

  it('allows adjacent CJK text when the stored context attests that boundary', () => {
    const text = '春夏秋冬';
    expect(matchAnchor(createTextAnchor(text, 1, 3), text)).toMatchObject({ start: 1, end: 3 });
    expect(matchAnchor(createTextAnchor('夏秋', 0, 2), text)).toBeNull();
  });
});

describe('every occurrence can be the stored one (#283)', () => {
  it.each([64, 65, 100])('finds the last Yes. among %i copies through the real splitter and cursor', (copies) => {
    const text = Array.from({ length: copies }, (_, i) => `Is this number ${i}? Yes.`).join(' ');
    const block: ReportedBlock = { id: '0.0', text, role: 'paragraph', section: 's.xhtml', sectionIndex: 0, cfi: 'epubcfi(/6/2!/4/2)' };
    const utterances = segmentDocument([block], 'en');
    const index = utterances.length - 1;
    expect(utterances[index].text).toBe('Yes.');
    const span = utterances[index].spans[0];
    const stored = readingPlaceAt(locator, text, span.start, span.end);
    expect(resolveResume(stored, utterances, [block], { spine: 1, reported: new Set([0]) })).toMatchObject({ outcome: 'resumed', utterance: index });
  });

  it('finds a late occurrence in a large Block without rescoring the whole Block per hit', () => {
    const text = Array.from({ length: 10_000 }, (_, i) => `Question ${i}? Yes.`).join(' ');
    const start = text.lastIndexOf('Yes.');
    expect(matchAnchor(createTextAnchor(text, start, start + 4), text)).toMatchObject({ start, ambiguous: false });
  });

  it.each([0, 63, 64, 80, 99])('uses context for occurrence %i, by exact characters and by tokens', (copy) => {
    const original = Array.from({ length: 100 }, (_, i) => `Is this number ${i}? Yes indeed.`).join(' ');
    const start = original.indexOf('Yes indeed.', original.indexOf(`number ${copy}?`));
    const stored = readingPlaceAt(locator, original, start, start + 'Yes indeed.'.length);
    for (const text of [original, original.replaceAll('Yes indeed.', 'Yes  indeed.')]) {
      const expected = text.indexOf('Yes', text.indexOf(`number ${copy}?`));
      for (const textAt of [() => text, () => null]) {
        expect(resolveReadingPosition(stored, { textAt, places: () => [{ locator, text }] })).toMatchObject({ start: expected, ambiguous: false });
      }
    }
  });

  it.each([true, false])('refuses indistinguishable copies even when the locator resolves: %s', (resolves) => {
    const text = Array(100).fill('Yes.').join(' ');
    const stored = readingPlaceAt(locator, text, 200, 204);
    expect(resolveReadingPosition(stored, { textAt: () => resolves ? text : null, places: () => [{ locator, text }] })).toMatchObject({ outcome: 'unresolved', search: 'ambiguous' });
    const block: ReportedBlock = { id: '0.0', text, role: 'paragraph', section: 's.xhtml', sectionIndex: 0, cfi: resolves ? 'epubcfi(/6/2!/4/2)' : 'epubcfi(/6/2!/4/4)' };
    expect(resolveResume(stored, segmentDocument([block], 'en'), [block], { spine: 1, reported: new Set([0]) })).toMatchObject({ outcome: 'lost', why: 'ambiguous' });
  });
});
