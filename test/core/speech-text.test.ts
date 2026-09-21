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
    // Every layer goes (#25): a nested group is still brackets around words.
    ['<[Hello]> [<World>]', '<> []', 'Hello World'],
    // Wherever the pair stands, not only when the whole text is brackets (#25).
    ['<Hello> and [World]', '<> []', 'Hello and World'],
    // A bracket without its partner stays as written.
    ['<Hello> [World', '<> []', 'Hello [World'],
    // Pairs that cross resolve, because each type is matched on its own.
    ['<[Hello>]', '<> []', 'Hello'],
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
    ['<<A>> <B>', 'A B'],
    ['<<A> <B>>', 'A B'],
    // The spaced `<` reads as a sign, so the plain `>` takes the plain `<` in
    // front of it: #94's wrapper around a comparison, then a group of its own.
    ['<a < b> <C>', 'a < b C'],
    // Both signs read as math, so the pair stays (xujialiu/Zotero-TTS#127).
    ['a < b > c', 'a < b > c'],
    ['<A> and <B>', 'A and B'],
    ['<A> <B', 'A <B'],
    ['A> <B>', 'A> B'],
    ['<A>> <B>', 'A> B'],
    ['<A> <B>>', 'A B>'],
    ['<a < b> <', 'a < b <'],
  ])('handles bracket groups in %s', (input, expected) => {
    expect(prepareSpeechText(input, true).text).toBe(expected);
    expect(prepareSpeechText(input, false)).toEqual({ text: input, removed: [] });
  });

  it.each([
    ['<Hello world.>', 'Hello world.'],
    ['<<Hello>>', 'Hello'],
    ['<a < b>', 'a < b'],
    ['Hello < world', 'Hello < world'],
    ['<Hello', '<Hello'],
    ['Hello>', 'Hello>'],
    ['<Hello>.', 'Hello.'],
    [' <Hello> ', ' Hello '],
    ['“<Hello>!”', '“Hello!”'],
    ['Hello <world>.', 'Hello world.'],
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

/**
 * #25: a pair goes wherever it encloses text. Fish Audio takes `[…]` for an
 * instruction and says none of it, so a sentence that kept its brackets lost
 * its words (notes/NOTES_2026-09-22.md, 00:08).
 */
describe('brackets inside a sentence', () => {
  it.each([
    ['He cast [Fireball] at the wolf.', 'He cast Fireball at the wolf.'],
    ['[Level Up] You gained 100 exp.', 'Level Up You gained 100 exp.'],
    ['You gained 100 exp. [Level Up]', 'You gained 100 exp. Level Up'],
    ['You gained < 100 exp> today.', 'You gained  100 exp today.'],
    ['[Skill: Fireball] [Level 2]', 'Skill: Fireball Level 2'],
    ['a [b [c] d] e', 'a b c d e'],
    ['[a <b] c>', 'a b c'],
    // Unpartnered brackets stay: removing a lone sign would change what it says.
    ['x < 5', 'x < 5'],
    // `<>` whose two signs both read as math stays, the plugin's rule
    // (xujialiu/Zotero-TTS#127): spaced, between letters or digits, touching
    // `=`, or `->`. Fish does not voice either sign even here (measured).
    ['If x < 5 and y > 3, stop.', 'If x < 5 and y > 3, stop.'],
    ['x <= 5 and y >= 3', 'x <= 5 and y >= 3'],
    ['p<0.05 and q>0.1', 'p<0.05 and q>0.1'],
    ['aged < 65 years and BMI > 30', 'aged < 65 years and BMI > 30'],
    ['<a -> b>', 'a -> b'],
    ['<Warning: HP < 10%>', 'Warning: HP < 10%'],
    // The misreads the plugin accepted with the rule, pinned so they are chosen
    // rather than discovered: both signs spaced stay, and a generic loses its.
    ['You have < 2/50 HP > left.', 'You have < 2/50 HP > left.'],
    ['List<String>', 'ListString'],
    ['P<.001 and Q>.05', 'P.001 and Q.05'],
    // Every layer of a nested group goes; Fish would swallow the inner one.
    ['[Skill: [Fireball]] now', 'Skill: Fireball now'],
    // A citation becomes audible under Fish, as it already is under the others.
    ['as shown [12].', 'as shown 12.'],
    ['Section 3] continues', 'Section 3] continues'],
    ['He said [sic', 'He said [sic'],
  ])('prepares %s as %s', (input, expected) => {
    expect(prepareSpeechText(input, true).text).toBe(expected);
    expect(prepareSpeechText(input, false).text).toBe(input);
  });

  it('leaves the text alone when the list makes a character in it ambiguous', () => {
    // `<` opens two pairs, so which one a `<` belongs to would be a guess.
    expect(prepareSpeechText('[a] <b)', true, '<> <) []').text).toBe('[a] <b)');
    // `>` closes one pair and opens another.
    expect(prepareSpeechText('[a] <b>', true, '<> >] []').text).toBe('[a] <b>');
    // A text without the ambiguous character is prepared as usual.
    expect(prepareSpeechText('[a] b', true, '<> <) []').text).toBe('a b');
  });

  it('maps a provider’s words back across brackets in the middle of the sentence', () => {
    const source = 'He cast [Fireball] at the wolf.';
    const prepared = prepareSpeechText(source, true);
    expect(prepared.removed).toEqual([8, 17]);
    const speech = prepared.text;
    const at = (word: string) => ({ start: 0, end: 1, charStart: speech.indexOf(word), charEnd: speech.indexOf(word) + word.length });
    const mapped = restoreSpeechOffsets([at('cast'), at('Fireball'), at('wolf')], prepared.removed);
    expect(mapped.map((t) => source.slice(t.charStart, t.charEnd))).toEqual(['cast', 'Fireball', 'wolf']);
  });
});
