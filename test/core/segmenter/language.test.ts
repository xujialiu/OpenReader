import { describe, expect, it } from 'vitest';
import fallbacks from '../../../node_modules/sentencex/src/fallbacks.json';
// @ts-expect-error -- sentencex 0.4.2 ships no types; only the keys of its rules table are read here.
import languages from '../../../node_modules/sentencex/src/languages/index.js';
import { documentLanguage, segmentDocument } from '../../../src/app/segment';
import { segmentBlock } from '../../../src/core/segmenter';
import { sentencexLanguage, splitWithSentencex } from '../../../src/core/segmenter/sentencex';
import { sectionChapters } from '../../../src/offline/model';

const options = { splitSentences: splitWithSentencex };
const table = fallbacks as Record<string, string[]>;

/** What the Reading does with a declared tag: `documentLanguage`, then `segmentDocument`. */
const reading = (text: string, tag: string) => segmentDocument([{ text }], documentLanguage(tag).language).map((u) => u.text);
/** What a Download does with it: the page's tag straight into `sectionChapters`. */
const download = (text: string, tag: string) => sectionChapters(0, [{ text }], [], tag).flatMap((chapter) => chapter.texts);

/**
 * The package's own fallback walk with a record of where it has been, so a
 * cycle ends instead of running the stack out. Null where the walk finds no
 * rules, which the package answers with English.
 */
function tableWalk(code: string, seen = new Set<string>()): string | null {
  if (seen.has(code)) return null;
  seen.add(code);
  if (Object.hasOwn(languages, code)) return code;
  for (const next of Object.hasOwn(table, code) ? table[code] : ['en']) {
    const found = tableWalk(next, seen);
    if (found) return found;
  }
  return null;
}

describe('a declared tag with a region, in capitals or with an underscore (#182)', () => {
  const de = 'Er wurde am 3. Oktober 1990 in Berlin geboren. Danach zog er um.';

  it.each(['de-DE', 'de-AT', 'DE', 'de_DE', ' de-DE '])('%s splits like de, in a Reading and a Download', (tag) => {
    expect(reading(de, tag)).toEqual(['Er wurde am 3. Oktober 1990 in Berlin geboren.', 'Danach zog er um.']);
    expect(download(de, tag)).toEqual(reading(de, 'de'));
  });

  it('el-GR ends a sentence at the Greek question mark, as el does', () => {
    const text = 'Τι κάνεις; Είμαι καλά.';
    expect(reading(text, 'el-GR')).toEqual(['Τι κάνεις;', 'Είμαι καλά.']);
    expect(download(text, 'el-GR')).toEqual(['Τι κάνεις;', 'Είμαι καλά.']);
  });

  it.each([
    ['de-DE', 'de', 'Das kostet ca. 5 Euro. Mehr nicht.'],
    ['de-DE', 'de', 'Siehe Abb. 3 im Anhang. Dort steht es.'],
    ['es-ES', 'es', 'La Sra. García llegó tarde. Nadie lo notó.'],
    ['pt-BR', 'pt', 'A Sra. Silva chegou tarde. Ninguém notou.'],
    ['ru-RU', 'ru', 'Он родился в 1990 г. в Москве. Потом уехал.'],
    ['fr-FR', 'fr', 'Il habite av. Foch à Paris. Elle aussi.'],
  ])('%s splits like %s: %s', (tag, bare, text) => {
    expect(reading(text, tag)).toEqual(reading(text, bare));
    // The case is one the two rule sets answer differently, or it would prove nothing.
    expect(reading(text, bare)).not.toEqual(reading(text, 'en'));
  });

  it('resolves to the primary subtag only when that has rules of its own', () => {
    expect(sentencexLanguage('de-DE')).toBe('de');
    expect(sentencexLanguage('ja-JP')).toBe('ja');
    expect(sentencexLanguage('EN-us')).toBe('en');
    // No rules for Italian or Chinese in 0.4.2: the tag goes to the table as before.
    expect(sentencexLanguage('it-IT')).toBe('it-it');
    expect(sentencexLanguage('zh-CN')).toBe('zh-cn');
  });

  it('reaches a fallback key written in capitals', () => {
    // Low Saxon of the Netherlands falls back to Dutch, Swiss German to German; both ended at English as written.
    expect(tableWalk(sentencexLanguage('nds-NL'))).toBe('nl');
    expect(tableWalk(sentencexLanguage('GSW'))).toBe('de');
  });
});

describe('three-letter names for a language with its own rules (#242)', () => {
  const de = 'Er wurde am 3. Oktober 1990 in Berlin geboren. Dann zog er um.';
  it.each(['deu', 'ger', 'DEU', ' GER ', 'deu-DE', 'ger_AT'])('%s uses German in Reading and Download', (tag) => {
    const expected = ['Er wurde am 3. Oktober 1990 in Berlin geboren.', 'Dann zog er um.'];
    expect(reading(de, tag)).toEqual(expected);
    expect(download(de, tag)).toEqual(expected);
    expect(sentencexLanguage(tag)).toBe('de');
  });

  it.each([
    ['fra', 'fr', 'Il habite av. Foch à Paris. Elle aussi.'],
    ['fre', 'fr', 'Il habite av. Foch à Paris. Elle aussi.'],
    ['spa', 'es', 'La Sra. García llegó tarde. Nadie lo notó.'],
    ['rus', 'ru', 'Он родился в 1990 г. в Москве. Потом уехал.'],
    ['ell', 'el', 'Τι κάνεις; Είμαι καλά.'],
    ['gre', 'el', 'Τι κάνεις; Είμαι καλά.'],
    ['nld', 'nl', 'Dat is bv. zo. En dan?'],
    ['dut', 'nl', 'Dat is bv. zo. En dan?'],
    ['por', 'pt', 'A Sra. Silva chegou tarde. Ninguém notou.'],
  ])('%s uses %s, not English: %s', (tag, bare, text) => {
    expect(reading(text, bare)).not.toEqual(reading(text, 'en'));
    expect(reading(text, tag)).toEqual(reading(text, bare));
    expect(download(text, tag)).toEqual(reading(text, bare));
    expect(sentencexLanguage(tag)).toBe(bare);
  });

  it.each([['jpn', 'ja'], ['pol', 'pl'], ['eng', 'en'], ['deu', 'de']])('resolves %s before its region', (tag, bare) => {
    expect(sentencexLanguage(`${tag.toUpperCase()}_ZZ`)).toBe(bare);
  });
});

describe('a tag whose fallbacks cycle (#185)', () => {
  it.each(['nan', 'cdo', ' nan ', 'NAN', 'nan-TW', 'cdo-Hant'])('%s is split, by the English rules', (tag) => {
    expect(splitWithSentencex(tag, 'One. Two.')).toEqual(['One.', 'Two.']);
    expect(reading('One. Two.', tag)).toEqual(['One.', 'Two.']);
    expect(download('One. Two.', tag)).toEqual(['One.', 'Two.']);
  });

  it('segmentBlock with nan does not throw', () => {
    expect(() => segmentBlock('One. Two.', 'nan', options)).not.toThrow();
  });

  it('is only nan and cdo: no other key of the table walks back to itself', () => {
    const cycling = Object.keys(table).filter((key) => {
      const onPath = new Set<string>();
      const loops = (code: string): boolean => {
        if (Object.hasOwn(languages, code) || !Object.hasOwn(table, code)) return false;
        if (onPath.has(code)) return true;
        onPath.add(code);
        const found = table[code].some(loops);
        onPath.delete(code);
        return found;
      };
      return loops(key);
    });
    expect(cycling.sort()).toEqual(['cdo', 'nan']);
  });
});

describe('every tag is split, and the table keeps its answers', () => {
  it('splits with every key of the installed fallbacks.json', () => {
    const thrown: string[] = [];
    for (const key of Object.keys(table)) {
      try {
        splitWithSentencex(key, 'One. Two.');
      } catch (error) {
        thrown.push(`${key}: ${String(error)}`);
      }
    }
    expect(thrown).toEqual([]);
  });

  it("gives every key the rules the table's own walk gives it, but the five kk-* that end at English there", () => {
    const changed: string[] = [];
    for (const key of Object.keys(table)) {
      const before = tableWalk(key) ?? 'en';
      const after = tableWalk(sentencexLanguage(key)) ?? 'en';
      if (after !== before) changed.push(`${key}: ${before} -> ${after}`);
    }
    expect(changed.sort()).toEqual([
      'kk-arab: en -> kk',
      'kk-cn: en -> kk',
      'kk-kz: en -> kk',
      'kk-latn: en -> kk',
      'kk-tr: en -> kk',
    ]);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', '', '-', 'x-', '_'])(
    'splits with %j, a tag the package cannot take as written',
    (tag) => {
      expect(splitWithSentencex(tag, 'One. Two.')).toEqual(['One.', 'Two.']);
    },
  );

  it('knows each of the 30 languages the package has rules for, under a region too', () => {
    // A code missing from the binding's list would send `xx-YY` to the table, and on to English.
    const codes = Object.keys(languages);
    expect(codes).toHaveLength(30);
    for (const code of codes) {
      expect(sentencexLanguage(code)).toBe(code);
      expect(sentencexLanguage(`${code.toUpperCase()}_ZZ`)).toBe(code);
    }
  });
});
