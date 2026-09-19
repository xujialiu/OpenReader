import { describe, expect, it } from 'vitest';
import { DEFAULT_BRACKET_PAIRS, prepareSpeechText, restoreSpeechOffsets, validateBracketPairs } from '../../src/core/speech-text';

/**
 * `speech-text.ts` has no test of its own in the plugin's platform-free tree:
 * its coverage lives in test/read-aloud/bracket-pairs.test.ts and
 * test/read-aloud/angle-brackets.test.ts, most of which drives
 * `createRemoteInterface` and Zotero's reader. What comes across is every case
 * that exercises these three functions and nothing else; the rest belongs to a
 * read-aloud layer that is not being ported.
 */

describe('configurable bracket pairs', () => {
  // The plugin pinned this through loadSettings(). The angle-bracket cases
  // below all call prepareSpeechText with no pair list, so the default is
  // load-bearing for them.
  it('defaults to angle and square brackets', () => {
    expect(DEFAULT_BRACKET_PAIRS).toBe('<> []');
    expect(validateBracketPairs(DEFAULT_BRACKET_PAIRS)).toEqual({ ok: true, pairs: [['<', '>'], ['[', ']']] });
  });

  it.each(['', '   ', '<', 'abc', 'aa', '**', '<> <>', 'a>', '<=>'])('rejects %j', (value) => {
    expect(validateBracketPairs(value).ok).toBe(false);
  });

  it.each(['<> []', '() 【】', '😀😁', ' <>   [] '])('accepts %j', (value) => {
    expect(validateBracketPairs(value).ok).toBe(true);
  });

  it.each([
    ['<Hello> [World]', '<> []', 'Hello World'],
    ['[Hello]', '<>', '[Hello]'],
    ['【Hello】 (World)!', '() 【】', 'Hello World!'],
    ['<[Hello]> [<World>]', '<> []', '[Hello] <World>'],
    ['<Hello> and [World]', '<> []', '<Hello> and [World]'],
    ['<Hello> [World', '<> []', '<Hello> [World'],
    ['<[Hello>]', '<> []', '<[Hello>]'],
    ['<a < b>', '<> []', 'a < b'],
    ['😀Hello😁 [World]', '😀😁 []', 'Hello World'],
  ])('prepares %s', (input, pairs, expected) => {
    expect(prepareSpeechText(input, true, pairs).text).toBe(expected);
    expect(prepareSpeechText(input, false, pairs).text).toBe(input);
  });

  it('restores UTF-16 positions across supplementary symbols', () => {
    const input = '😀Hello😁 [World]';
    const prepared = prepareSpeechText(input, true, '😀😁 []');
    expect(prepared.removed).toEqual([0, 1, 7, 8, 10, 16]);
    const times = [
      { start: 0, end: 1, charStart: 0, charEnd: 5 },
      { start: 1, end: 2, charStart: 6, charEnd: 11 },
    ];
    expect(restoreSpeechOffsets(times, prepared.removed).map((t) => input.slice(t.charStart, t.charEnd))).toEqual(['Hello', 'World']);
  });
});

describe('angle brackets at the speech boundary', () => {
  it.each([
    ['<Log in> <Register> <Play as guest>', 'Log in Register Play as guest'],
    ['<A><B>', 'AB'],
    ['“<A>”, <B>!', '“A”, B!'],
    [' <A>\n<B> ', ' A\nB '],
    ['<<A>> <B>', '<A> B'],
    ['<<A> <B>>', '<A> <B>'],
    ['<a < b> <C>', '<a < b> <C>'],
    ['a < b > c', 'a < b > c'],
    ['<A> and <B>', '<A> and <B>'],
    ['<A> <B', '<A> <B'],
    ['A> <B>', 'A> <B>'],
    ['<A>> <B>', '<A>> <B>'],
    ['<A> <B>>', '<A> <B>>'],
    ['<a < b> <', '<a < b> <'],
  ])('handles bracket groups in %s', (input, expected) => {
    expect(prepareSpeechText(input, true).text).toBe(expected);
    expect(prepareSpeechText(input, false)).toEqual({ text: input, removed: [] });
  });

  it.each([
    ['<Hello world.>', 'Hello world.'],
    ['<<Hello>>', '<Hello>'],
    ['<a < b>', 'a < b'],
    ['Hello < world', 'Hello < world'],
    ['<Hello', '<Hello'],
    ['Hello>', 'Hello>'],
    ['<Hello>.', 'Hello.'],
    [' <Hello> ', ' Hello '],
    ['“<Hello>!”', '“Hello!”'],
    ['Hello <world>.', 'Hello <world>.'],
    // Fullwidth angle brackets are not in the list, so they are spoken
    ['＜Hello＞', '＜Hello＞'],
  ])('prepares %s as %s', (text, expected) => {
    expect(prepareSpeechText(text, true).text).toBe(expected);
  });

  it('restores UTF-16 ranges across adjacent deletions and outside punctuation', () => {
    const source = '“<😀><你好>!”';
    const prepared = prepareSpeechText(source, true);
    expect(prepared.text).toBe('“😀你好!”');
    const timestamps = [
      [0, 1],
      [1, 3],
      [3, 5],
      [5, 7],
    ].map(([charStart, charEnd]) => ({ start: 0, end: 1, charStart, charEnd }));
    expect(restoreSpeechOffsets(timestamps, prepared.removed).map((t) => source.slice(t.charStart, t.charEnd))).toEqual([
      '“',
      '😀',
      '你好',
      '!”',
    ]);
  });

  it('keeps UTF-16 ranges past a supplementary character, without writing through to its input', () => {
    const source = '😀“<你好>。”';
    const prepared = prepareSpeechText(source, true);
    expect(prepared.text).toBe('😀“你好。”');
    const timestamps = [{ start: 0, end: 1, charStart: 3, charEnd: 5 }];
    const mapped = restoreSpeechOffsets(timestamps, prepared.removed);
    expect(mapped).toEqual([{ start: 0, end: 1, charStart: 4, charEnd: 6 }]);
    expect(source.slice(mapped[0].charStart, mapped[0].charEnd)).toBe('你好');
    // The timings handed in are the cache's, in speech-text coordinates.
    // Shifting them in place would corrupt every later hit on the same clip.
    expect(timestamps).toEqual([{ start: 0, end: 1, charStart: 3, charEnd: 5 }]);
  });

  it('maps prefix, body and suffix punctuation across the two deleted characters', () => {
    const source = '“<Hello>!”';
    const prepared = prepareSpeechText(source, true);
    expect(prepared.text).toBe('“Hello!”');
    const words = [
      { start: 0, end: 0.1, charStart: 0, charEnd: 1 },
      { start: 0.1, end: 0.5, charStart: 1, charEnd: 6 },
      { start: 0.5, end: 0.6, charStart: 6, charEnd: 8 },
    ];
    const mapped = restoreSpeechOffsets(words, prepared.removed);
    expect(mapped.map((t) => source.slice(t.charStart, t.charEnd))).toEqual(['“', 'Hello', '!”']);
    expect(mapped.map((t) => [t.start, t.end])).toEqual(words.map((t) => [t.start, t.end]));
  });
});
