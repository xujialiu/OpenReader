/**
 * A locale's English name, as the desktop plugin writes it in its language
 * dropdown (xujialiu/Zotero-OpenReader `src/read-aloud/language-dropdown.ts`):
 * `new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' })`,
 * so `en-US` is `English (United States)` and never `American English`.
 *
 * Composed from a table (`locale-name-table.ts`, written by
 * `scripts/locale-names.mjs`) rather than the call, for the reason
 * `language-names.ts` gives: Hermes ships a cut-down `Intl`, `DisplayNames` on
 * it has not been measured, and a missing call would fail on the phone alone
 * while every test passed under Node (ADR 0032, ADR 0081).
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

import { LANGUAGE_ALIASES, LANGUAGES, REGIONS, SCRIPTS } from './locale-name-table';

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
