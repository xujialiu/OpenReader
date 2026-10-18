/**
 * A locale's English name, two ways.
 *
 * `localeName` is ICU's own answer, as the desktop plugin writes it in its
 * language dropdown (xujialiu/Zotero-OpenReader `src/read-aloud/language-dropdown.ts`):
 * `new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' })`,
 * so `en-US` is `English (United States)` and never `American English`. The
 * Voice drawer does not show it; it is what holds the table to ICU.
 *
 * `languageNames` is what the Voice drawer shows (#300): the same table, saying
 * only what tells a Language apart from the Provider's others of its language,
 * in shorter words where ICU's are official ones.
 *
 * Composed from a table (`locale-name-table.ts`, written by
 * `scripts/locale-names.mjs`) rather than the call, for the reason
 * `language-names.ts` gives: Hermes ships a cut-down `Intl` with no
 * `DisplayNames` (notes/NOTES_2026-10-18.md, 13:02), and the missing call would
 * fail on the phone alone while every test passed under Node (ADR 0081).
 * `test/core/locale-names.test.ts` holds the composition to Node's own answer.
 *
 * Where it parts from ICU, deliberately, because no Provider sends these:
 *
 * - A variant ICU has a name for (`ca-ES-valencia`, `de-CH-1996`) is written in
 *   capitals, as ICU writes one it has no name for (`zh-CN-sichuan` is
 *   `Chinese (China, SICHUAN)`, which Azure does send).
 * - A tag with an extension or a private-use part (`zh-CN-u-co-pinyin`), and
 *   one ICU refuses (`zh-yue`, `en_US`), comes back as it was given — which is
 *   also what the plugin shows when its call throws.
 */

import { LANGUAGE_ALIASES, LANGUAGES, LIKELY_SCRIPTS, REGIONS, SCRIPTS } from './locale-name-table';

interface Parts {
  language: string;
  script?: string;
  region?: string;
  variants: string[];
}

/** The language, script, region and variants of a tag, in their canonical case; null for anything else. */
function parse(tag: string): Parts | null {
  const subtags = tag.split('-');
  const language = subtags.shift()!.toLowerCase();
  if (!/^(?:[a-z]{2,3}|[a-z]{5,8})$/.test(language)) return null;
  const parts: Parts = { language, variants: [] };
  if (subtags[0] && /^[a-z]{4}$/i.test(subtags[0])) {
    const script = subtags.shift()!;
    parts.script = script[0].toUpperCase() + script.slice(1).toLowerCase();
  }
  if (subtags[0] && /^(?:[a-z]{2}|[0-9]{3})$/i.test(subtags[0])) parts.region = subtags.shift()!.toUpperCase();
  for (const variant of subtags) {
    const lower = variant.toLowerCase();
    if (!/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/.test(lower) || parts.variants.includes(lower)) return null;
    parts.variants.push(lower);
  }
  return parts;
}

/**
 * ICU's own replacement of a language code: `iw` is `he`, and `sh` is `sr-Latn`
 * — the script and region a replacement brings are added only where the tag had
 * none of its own.
 */
function canonical(parts: Parts): Parts {
  const to = LANGUAGE_ALIASES[parts.language];
  if (!to) return parts;
  const target = parse(to);
  if (!target) return parts;
  return { ...parts, language: target.language, script: parts.script ?? target.script, region: parts.region ?? target.region };
}

/** The English name of a BCP 47 tag, as `Intl.DisplayNames` gives it in its standard form; the tag itself where it cannot be read. */
export function localeName(tag: string): string {
  const parsed = parse(tag);
  if (!parsed) return tag;
  const parts = canonical(parsed);
  const language = LANGUAGES[parts.language] ?? parts.language;
  const qualifiers = [
    ...(parts.script ? [SCRIPTS[parts.script] ?? parts.script] : []),
    ...(parts.region ? [REGIONS[parts.region] ?? parts.region] : []),
    // ICU orders the variants and writes the ones it cannot name in capitals.
    ...[...parts.variants].sort().map((variant) => variant.toUpperCase()),
  ];
  return qualifiers.length ? `${language} (${qualifiers.join(', ')})` : language;
}

/** ICU's official names, and what the Voice drawer says instead (#300). Keyed by name, so `HK` and `344` both shorten. */
const SHORTER: Readonly<Record<string, string>> = {
  'Hong Kong SAR China': 'Hong Kong',
  'Macao SAR China': 'Macao',
  'Unified Canadian Aboriginal Syllabics': 'Syllabics',
};
const shorter = (name: string): string => SHORTER[name] ?? name;

/** The script a tag means without writing one: the region's where it differs from the language's (`sr-ME` is Latin, `sr` Cyrillic). */
function likelyScript(parts: Parts): string | undefined {
  return (parts.region && LIKELY_SCRIPTS[`${parts.language}-${parts.region}`]) || LIKELY_SCRIPTS[parts.language];
}

/**
 * The name of each of a Provider's locales, as the Voice drawer shows it (#300).
 *
 * The parentheses hold only what tells a Language apart from the Provider's
 * others of the same language:
 *
 * - **A dialect** (a variant: `zh-CN-liaoning`) by its place alone, as a name,
 *   always: `Chinese (Liaoning)`, never `Chinese (China, LIAONING)`.
 * - **A script** for every Language of the language once one of its tags writes
 *   a script that is not the one it would mean anyway: `sr-Latn-RS` makes
 *   `Serbian (Latin)`, and `sr-RS` beside it `Serbian (Cyrillic)`. `zh-HK` means
 *   Traditional, but no Chinese tag Azure sends writes a script, so Chinese is
 *   never `Simplified` or `Traditional`.
 * - **A country** only where the language's tags hold more than one, a tag
 *   without one counting as one: Kokoro's `English (United States)` beside
 *   `English (United Kingdom)`, its lone `ja-JP` plain `Japanese`.
 *
 * A tag `parse` cannot read is named as it was given and counts as no language's.
 */
export function languageNames(locales: readonly string[]): Map<string, string> {
  const parsed = new Map<string, Parts>();
  const byLanguage = new Map<string, Parts[]>();
  for (const locale of locales) {
    const read = parse(locale);
    if (!read) continue;
    const parts = canonical(read);
    parsed.set(locale, parts);
    byLanguage.set(parts.language, [...(byLanguage.get(parts.language) ?? []), parts]);
  }

  const names = new Map<string, string>();
  for (const locale of locales) {
    const parts = parsed.get(locale);
    if (!parts) {
      names.set(locale, locale);
      continue;
    }
    const kin = byLanguage.get(parts.language) ?? [parts];
    const scriptTells = kin.some((one) => one.script !== undefined && one.script !== likelyScript(one));
    const regionTells = new Set(kin.map((one) => one.region)).size > 1;
    const script = scriptTells ? (parts.script ?? likelyScript(parts)) : undefined;
    const place = parts.variants.length
      ? [...parts.variants].sort().map((variant) => variant[0].toUpperCase() + variant.slice(1))
      : regionTells && parts.region
        ? [shorter(REGIONS[parts.region] ?? parts.region)]
        : [];
    const qualifiers = [...(script ? [shorter(SCRIPTS[script] ?? script)] : []), ...place];
    const language = LANGUAGES[parts.language] ?? parts.language;
    names.set(locale, qualifiers.length ? `${language} (${qualifiers.join(', ')})` : language);
  }
  return names;
}
