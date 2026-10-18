import { describe, expect, it } from 'vitest';

import { localeName } from '../../src/core/locale-names';

/**
 * #232. The desktop plugin names a Voice's locale with Node's — Zotero's —
 * `Intl.DisplayNames`; the phone composes the same name from a table, because
 * Hermes has no such call (ADR 0081). Every check here is against
 * Node's own answer, so a newer ICU that names something differently fails here
 * rather than drifting between the phone and the desktop. The fix is
 * `node scripts/locale-names.mjs`.
 */

const icu = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' });
/** ICU's name, or null where it refuses the tag. */
const icuName = (tag: string): string | null => {
  try {
    return icu.of(tag) ?? null;
  } catch {
    return null;
  }
};

function* strings(alphabet: string, length: number): Generator<string> {
  if (length === 0) {
    yield '';
    return;
  }
  for (const head of alphabet) for (const tail of strings(alphabet, length - 1)) yield head + tail;
}
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();

/** Every tag given, named as ICU names it; returns the ones that differ, so a failure lists them all. */
const differing = (tags: Iterable<string>) => {
  const out: [string, string, string][] = [];
  for (const tag of tags) {
    const want = icuName(tag);
    if (want !== null && !/^und\b/.test(tag) && localeName(tag) !== want) out.push([tag, localeName(tag), want]);
  }
  return out;
};

describe('localeName', () => {
  it('names every two- and three-letter language code as ICU does, the aliases among them', () => {
    expect(differing([...strings(LOWER, 2), ...strings(LOWER, 3)])).toEqual([]);
  });

  it('names every region as ICU does inside a language’s name', () => {
    const regions = [...strings(UPPER, 2), ...strings('0123456789', 3)];
    expect(differing(regions.map((region) => `en-${region}`))).toEqual([]);
    expect(differing(regions.map((region) => `zh-${region}`))).toEqual([]);
  });

  it('names every script as ICU does inside a language’s name, beside a region too', () => {
    const scripts = [...strings(UPPER, 1)].flatMap((head) => [...strings(LOWER, 3)].map((tail) => head + tail));
    expect(differing(scripts.map((script) => `sr-${script}`))).toEqual([]);
    expect(differing(scripts.filter((_, index) => index % 7 === 0).map((script) => `zh-${script}-TW`))).toEqual([]);
  });

  it('names every language with a region, as a Provider sends most of them', () => {
    const languages = [...strings(LOWER, 2), ...strings(LOWER, 3)].filter((code) => icuName(code) !== code && icuName(code) !== null);
    expect(differing(languages.flatMap((code) => [`${code}-US`, `${code}-001`, `${code}-Latn-CN`]))).toEqual([]);
  });

  it('names the locales the Providers send, Azure’s dialects and scripts among them', () => {
    const sent = [
      // Azure: the dialects ICU has no name for, and the scripts.
      'zh-CN', 'zh-HK', 'zh-TW', 'zh-CN-sichuan', 'zh-CN-shandong', 'zh-CN-henan', 'zh-CN-liaoning', 'zh-CN-shaanxi', 'zh-CN-guangxi',
      'wuu-CN', 'yue-CN', 'sr-RS', 'sr-Latn-RS', 'iu-Cans-CA', 'iu-Latn-CA', 'uz-UZ', 'bs-BA', 'fil-PH', 'nb-NO', 'en-US', 'en-GB',
      // Kokoro (`localeForKokoroVoice`), Fish's two letters, Speechify's.
      'ja-JP', 'es-ES', 'fr-FR', 'hi-IN', 'it-IT', 'pt-BR', 'zh', 'en', 'ja', 'ko', 'ar', 'de', 'es-MX', 'pt-PT', 'nl-NL',
      // Case as a server might send it, and aliases.
      'EN-us', 'zh-hans-cn', 'ZH_cn'.replace('_', '-'), 'iw-IL', 'tl', 'sh-RS', 'cnr-ME', 'prs-AF', 'cmn-CN', 'mo',
    ];
    expect(differing(sent)).toEqual([]);
    expect(localeName('zh-CN-sichuan')).toBe('Chinese (China, SICHUAN)');
    expect(localeName('en-US')).toBe('English (United States)');
    expect(localeName('zh-HK')).toBe('Chinese (Hong Kong SAR China)');
  });

  it('writes a tag ICU cannot name the way ICU does: the code, in its canonical case', () => {
    expect(differing(['qaa', 'qaa-YY', 'xx-Zzzz-QQ'])).toEqual([]);
  });

  it('gives back a tag it cannot read, which is what the plugin shows when its call throws', () => {
    for (const tag of ['en_US', 'zh-yue', 'i-klingon', '', 'e', 'en--US']) {
      expect(icuName(tag)).toBeNull();
      expect(localeName(tag)).toBe(tag);
    }
  });

  it('parts from ICU only where no Provider sends anything: named variants, and extensions', () => {
    // Recorded, not endorsed: if a Provider ever sends one, this is the line to move.
    expect([localeName('ca-ES-valencia'), icuName('ca-ES-valencia')]).toEqual(['Catalan (Spain, VALENCIA)', 'Catalan (Spain, Valencian)']);
    expect(localeName('zh-CN-u-co-pinyin')).toBe('zh-CN-u-co-pinyin');
    // `root` is ICU's name for its own fallback locale, not a language.
    expect([localeName('und'), icuName('und')]).toEqual(['und', 'root']);
  });
});
