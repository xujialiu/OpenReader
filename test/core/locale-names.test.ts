import { describe, expect, it } from 'vitest';

import { LANGUAGES, LIKELY_SCRIPTS, REGIONS } from '../../src/core/locale-name-table';
import { languageNames, localeName } from '../../src/core/locale-names';

/**
 * #232. The desktop plugin names a Voice's locale with Node's — Zotero's —
 * `Intl.DisplayNames`; the phone composes the same name from a table, because
 * Hermes has no such call (ADR 0081). Every check here is against
 * Node's own answer, so a newer ICU that names something differently fails here
 * rather than drifting between the phone and the desktop. The fix is
 * `node scripts/locale-names.mjs`.
 *
 * `languageNames` is what the Voice drawer shows: the same table, shortened
 * where the owner chose (#300).
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

describe('LIKELY_SCRIPTS', () => {
  it('gives every language, and every language with a region, the script ICU’s likely subtags give it', () => {
    const likely = (tag: string): string | undefined => {
      try {
        return new Intl.Locale(tag).maximize().script;
      } catch {
        return undefined;
      }
    };
    const regions = Object.keys(REGIONS).filter((code) => /^[A-Z]{2}$/.test(code));
    const out: [string, string | undefined, string | undefined][] = [];
    for (const language of Object.keys(LANGUAGES)) {
      if (LIKELY_SCRIPTS[language] !== likely(language)) out.push([language, LIKELY_SCRIPTS[language], likely(language)]);
      if (!LIKELY_SCRIPTS[language]) continue;
      for (const region of regions) {
        const tag = `${language}-${region}`;
        const table = LIKELY_SCRIPTS[tag] ?? LIKELY_SCRIPTS[language];
        if (table !== likely(tag)) out.push([tag, table, likely(tag)]);
      }
    }
    expect(out).toEqual([]);
  });
});

/**
 * #300. A Language's name says only what tells it apart from the Provider's
 * other Languages of the same language: a dialect by its place, a script where a
 * tag writes one that is not the usual, a country where there are several.
 */
describe('languageNames', () => {
  const named = (locales: string[]) => Object.fromEntries(languageNames(locales));

  // Azure's text-to-speech locales: Microsoft Learn, "Language and voice support", updated 2026-09-10.
  const AZURE = [
    'af-ZA', 'am-ET', 'ar-AE', 'ar-BH', 'ar-DZ', 'ar-EG', 'ar-IQ', 'ar-JO', 'ar-KW', 'ar-LB', 'ar-LY', 'ar-MA', 'ar-OM', 'ar-QA', 'ar-SA',
    'ar-SY', 'ar-TN', 'ar-YE', 'as-IN', 'az-AZ', 'bg-BG', 'bn-BD', 'bn-IN', 'bs-BA', 'ca-ES', 'cs-CZ', 'cy-GB', 'da-DK', 'de-AT', 'de-CH',
    'de-DE', 'el-GR', 'en-AU', 'en-CA', 'en-GB', 'en-HK', 'en-IE', 'en-IN', 'en-KE', 'en-NG', 'en-NZ', 'en-PH', 'en-SG', 'en-TZ', 'en-US',
    'en-ZA', 'es-AR', 'es-BO', 'es-CL', 'es-CO', 'es-CR', 'es-CU', 'es-DO', 'es-EC', 'es-ES', 'es-GQ', 'es-GT', 'es-HN', 'es-MX', 'es-NI',
    'es-PA', 'es-PE', 'es-PR', 'es-PY', 'es-SV', 'es-US', 'es-UY', 'es-VE', 'et-EE', 'eu-ES', 'fa-IR', 'fi-FI', 'fil-PH', 'fr-BE', 'fr-CA',
    'fr-CH', 'fr-FR', 'ga-IE', 'gl-ES', 'gu-IN', 'he-IL', 'hi-IN', 'hr-HR', 'hu-HU', 'hy-AM', 'id-ID', 'is-IS', 'it-IT', 'iu-Cans-CA',
    'iu-Latn-CA', 'ja-JP', 'jv-ID', 'ka-GE', 'kk-KZ', 'km-KH', 'kn-IN', 'ko-KR', 'lo-LA', 'lt-LT', 'lv-LV', 'mk-MK', 'ml-IN', 'mn-MN',
    'mr-IN', 'ms-MY', 'mt-MT', 'my-MM', 'nb-NO', 'ne-NP', 'nl-BE', 'nl-NL', 'or-IN', 'pa-IN', 'pl-PL', 'ps-AF', 'pt-BR', 'pt-PT', 'ro-RO',
    'ru-RU', 'si-LK', 'sk-SK', 'sl-SI', 'so-SO', 'sq-AL', 'sr-Latn-RS', 'sr-RS', 'su-ID', 'sv-SE', 'sw-KE', 'sw-TZ', 'ta-IN', 'ta-LK',
    'ta-MY', 'ta-SG', 'te-IN', 'th-TH', 'tr-TR', 'uk-UA', 'ur-IN', 'ur-PK', 'uz-UZ', 'vi-VN', 'wuu-CN', 'yue-CN', 'zh-CN',
    'zh-CN-guangxi', 'zh-CN-henan', 'zh-CN-liaoning', 'zh-CN-shaanxi', 'zh-CN-shandong', 'zh-CN-sichuan', 'zh-HK', 'zh-TW', 'zu-ZA',
  ];

  it('names Azure’s dialects by their place, Hong Kong as Hong Kong, and Serbian and Inuktitut by their script', () => {
    const azure = named(AZURE);
    expect(Object.keys(azure)).toHaveLength(154);
    expect(Object.entries(azure).filter(([locale]) => /^(zh|yue|wuu|sr|iu)-|^en-HK$/.test(locale))).toEqual([
      ['en-HK', 'English (Hong Kong)'],
      ['iu-Cans-CA', 'Inuktitut (Syllabics)'],
      ['iu-Latn-CA', 'Inuktitut (Latin)'],
      ['sr-Latn-RS', 'Serbian (Latin)'],
      ['sr-RS', 'Serbian (Cyrillic)'],
      ['wuu-CN', 'Wu Chinese'],
      ['yue-CN', 'Cantonese'],
      ['zh-CN', 'Chinese (China)'],
      ['zh-CN-guangxi', 'Chinese (Guangxi)'],
      ['zh-CN-henan', 'Chinese (Henan)'],
      ['zh-CN-liaoning', 'Chinese (Liaoning)'],
      ['zh-CN-shaanxi', 'Chinese (Shaanxi)'],
      ['zh-CN-shandong', 'Chinese (Shandong)'],
      ['zh-CN-sichuan', 'Chinese (Sichuan)'],
      ['zh-HK', 'Chinese (Hong Kong)'],
      ['zh-TW', 'Chinese (Taiwan)'],
    ]);
    // Everything else is ICU's own name, with the country only where the language has several.
    const rest = AZURE.filter((locale) => !/^(zh|yue|wuu|sr|iu)-|^en-HK$/.test(locale));
    const several = (locale: string) => rest.filter((one) => one.split('-')[0] === locale.split('-')[0]).length > 1;
    expect(rest.filter((locale) => azure[locale] !== localeName(several(locale) ? locale : locale.split('-')[0]))).toEqual([]);
    expect([azure['uz-UZ'], azure['en-US'], azure['ja-JP']]).toEqual(['Uzbek', 'English (United States)', 'Japanese']);
  });

  it('names a dialect’s place even when it is the Provider’s only one of its language, and the country only where there are several', () => {
    expect(named(['zh-CN-sichuan'])).toEqual({ 'zh-CN-sichuan': 'Chinese (Sichuan)' });
    expect(named(['zh-CN', 'zh-CN-sichuan'])).toEqual({ 'zh-CN': 'Chinese', 'zh-CN-sichuan': 'Chinese (Sichuan)' });
    // A variant ICU has a name for is still the Provider's word for a place.
    expect(named(['ca-ES-valencia', 'ca-ES'])).toEqual({ 'ca-ES-valencia': 'Catalan (Valencia)', 'ca-ES': 'Catalan' });
  });

  it('names a script that is not the usual one even alone, and the usual one only beside it', () => {
    expect(named(['sr-Latn-RS'])).toEqual({ 'sr-Latn-RS': 'Serbian (Latin)' });
    expect(named(['uz-Latn-UZ'])).toEqual({ 'uz-Latn-UZ': 'Uzbek' });
    expect(named(['sh-RS'])).toEqual({ 'sh-RS': 'Serbian (Latin)' });
    // Taiwan's Chinese is Traditional, so writing it tells nothing; and no Chinese tag Azure sends writes one.
    expect(named(['zh-Hant-TW', 'zh-CN'])).toEqual({ 'zh-Hant-TW': 'Chinese (Taiwan)', 'zh-CN': 'Chinese (China)' });
    expect(named(['zh-Hans', 'zh-Hant'])).toEqual({ 'zh-Hans': 'Chinese (Simplified)', 'zh-Hant': 'Chinese (Traditional)' });
  });

  it('names script and place both where both differ', () => {
    expect(named(['sr-RS', 'sr-Latn-RS', 'sr-ME'])).toEqual({
      'sr-RS': 'Serbian (Cyrillic, Serbia)',
      'sr-Latn-RS': 'Serbian (Latin, Serbia)',
      'sr-ME': 'Serbian (Latin, Montenegro)',
    });
  });

  it('shortens Macao as it does Hong Kong, numeric codes too', () => {
    expect(named(['zh-HK', 'zh-MO', 'zh-344', 'zh-446'])).toEqual({
      'zh-HK': 'Chinese (Hong Kong)', 'zh-MO': 'Chinese (Macao)', 'zh-344': 'Chinese (Hong Kong)', 'zh-446': 'Chinese (Macao)',
    });
  });

  it('gives back a tag it cannot read, and does not let it count as another of its language', () => {
    expect(named(['en_US', 'zh-CN-u-co-pinyin', 'zh-CN'])).toEqual({ 'en_US': 'en_US', 'zh-CN-u-co-pinyin': 'zh-CN-u-co-pinyin', 'zh-CN': 'Chinese' });
  });
});
