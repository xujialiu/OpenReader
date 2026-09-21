import { describe, expect, it } from 'vitest';

import { countWords, fishLanguageHint, HINT_WORDS } from '../../src/core/fish-language-hint';
import { LANGUAGE_NAMES } from '../../src/core/language-names';

/**
 * #23. The plugin counts with `Intl.Segmenter` and names with
 * `Intl.DisplayNames` (xujialiu/Zotero-TTS#98); Hermes has the first not at all
 * (notes/NOTES_2026-09-19.md), so this file holds the hand-written count and
 * the table to Node's real ones, which is the plugin's behavior, wherever they
 * are meant to agree.
 */

const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
const icuWords = (text: string) => [...segmenter.segment(text)].filter((part) => part.isWordLike).length;

describe('countWords', () => {
  it.each([
    '100 exp', ' 100 exp', '2/50 HP', '< 100 exp>', 'Level Up', 'You gained 100 exp.',
    'a:b', 'e.g. this', 'U.S. Army base', 'don’t stop', "rock'n'roll", "It's 5 o'clock", 'O’Brien',
    '3.14 m', '1,000 ms', "1'2000", '1;2', '3,5,7', '1.2.3', 'v1.2.3', 'x.y', '5.', '.5', 'a..b',
    'a.1', '1.a', "a'1", "1'a", 'a;b', 'HP:10', '10:30', 'a_b c', 'e-mail me', 'hello·world', 'a‘b',
    '“Hi”', 'C++ rocks', '$5 off', '50% off', 'A&B', '#hashtag', '@you', 'x=y', 'i.e., that', 'Mr. Smith',
    'café au lait', 'nai\u0308ve', '* * *', '— —', '', '   ',
  ])('counts %j as Intl.Segmenter does', (text) => {
    expect(countWords(text)).toBe(icuWords(text));
  });

  it.each([
    ['第一章', 3],
    ['第十一章', 4],
    ['カタカナ', 4],
    ['한국어', 3],
    ['สวัสดี', 4],
    ['第一章 Level 1', 5],
  ])('counts each letter of a script written without spaces as a word: %s is %i', (text, words) => {
    expect(countWords(text)).toBe(words);
  });

  it('stops counting at the limit', () => {
    expect(countWords('one two three four five six', HINT_WORDS)).toBe(HINT_WORDS);
    expect(countWords('第一二三四五六七八', HINT_WORDS)).toBe(HINT_WORDS);
  });
});

describe('fishLanguageHint', () => {
  it('names the voice’s locale in front of #98’s two stats, as the plugin does', () => {
    expect(fishLanguageHint(' 100 exp', 'en-US')).toBe('[Speak in American English]');
    expect(fishLanguageHint(' 2/50 HP ', 'en-US')).toBe('[Speak in American English]');
    expect(fishLanguageHint('100 exp', 'en-US')).toBe('[Speak in American English] ');
  });

  it('hints one to three words and not four', () => {
    expect(fishLanguageHint('one', 'en')).toBe('[Speak in English] ');
    expect(fishLanguageHint('one two three', 'en')).toBe('[Speak in English] ');
    expect(fishLanguageHint('one two three four', 'en')).toBe('');
  });

  it('gives nothing to a text with no word, or to a locale it cannot name', () => {
    expect(fishLanguageHint('— —', 'en-US')).toBe('');
    expect(fishLanguageHint('100 exp', undefined)).toBe('');
    expect(fishLanguageHint('100 exp', '')).toBe('');
    expect(fishLanguageHint('100 exp', 'mul')).toBe('');
    expect(fishLanguageHint('100 exp', 'qq')).toBe('');
  });

  it('names the languages Fish files its voices under', () => {
    expect(fishLanguageHint('第一章', 'zh')).toBe('[Speak in Chinese] ');
    expect(fishLanguageHint('hola', 'es')).toBe('[Speak in Spanish] ');
    expect(fishLanguageHint('kumusta', 'tl')).toBe('[Speak in Filipino] ');
    expect(fishLanguageHint('hello', 'en-GB')).toBe('[Speak in British English] ');
  });
});

describe('LANGUAGE_NAMES', () => {
  /** The plugin's own naming: the locale canonicalized, then named in English. */
  const displayNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const pluginName = (code: string) => {
    const tag = new Intl.Locale(code);
    return displayNames.of(tag.baseName);
  };

  it('says exactly what the plugin says, for every entry', () => {
    for (const [code, name] of Object.entries(LANGUAGE_NAMES)) expect([code, name]).toEqual([code, pluginName(code)]);
  });

  it('covers every two-letter code the plugin can name, and the English regions fish.ts files voices under', () => {
    for (let a = 97; a < 123; a++) {
      for (let b = 97; b < 123; b++) {
        const code = String.fromCharCode(a, b);
        const tag = new Intl.Locale(code);
        const name = displayNames.of(tag.baseName);
        if (name && name !== tag.baseName && !['mul', 'und', 'zxx'].includes(tag.language)) expect([code, LANGUAGE_NAMES[code]]).toEqual([code, name]);
      }
    }
    for (const region of ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN', 'en-NG', 'en-ZA', 'en-NZ', 'en-IE', 'en-SG', 'en-JM', 'en-KE', 'en-PH', 'en-TT']) {
      expect(LANGUAGE_NAMES[region]).toBeDefined();
    }
  });
});
