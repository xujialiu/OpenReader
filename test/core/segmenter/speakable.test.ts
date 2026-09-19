import { describe, expect, it } from 'vitest';
import { isSpeakable } from '../../../src/core/segmenter/speakable';

/**
 * The predicate is the Zotero-TTS plugin's, character for character
 * (`src/core/providers/speechify.ts`), so that the two products agree about
 * which utterances are silent. Its own note records the price of getting this
 * wrong: `* * *` cost 60 s and a 502, measured 2026-09-09.
 */
describe('Speakable', () => {
  it.each([
    ['a'],
    ['Hello.'],
    ['1'],
    ['½'],
    ['②'],
    ['这'],
    ['ש'],
    ['क'],
    ['[66]'],
    ['<Hello world>.'],
    ['— chapter 4 —'],
  ])('%j has something to say', (text) => {
    expect(isSpeakable(text)).toBe(true);
  });

  it.each([['* * *'], [''], ['   '], ['\n\n'], ['—'], ['…'], ['<>'], ['— — —'], ['· · ·'], ['“”'], ['🙂']])('%j has nothing to say', (text) => {
    expect(isSpeakable(text)).toBe(false);
  });

  /**
   * Not "valid", not "non-empty", not "meaningful" — CONTEXT.md's avoid-list for
   * this word exists because each of those would be a claim about the text that
   * is false. A scene break is valid, is not empty, and means something.
   */
  it('is about pronounceability, not about validity', () => {
    expect(isSpeakable('* * *')).toBe(false);
    expect('* * *'.trim()).not.toBe('');
  });
});
