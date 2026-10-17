import segment from 'sentencex';

import type { SplitSentences } from './sentences';

/**
 * Upstream `sentencex`, bound to this directory's `SplitSentences` seam
 * (ADR 0006). This is the only file that names the package.
 *
 * ## Why the pin is at 0.4.2
 *
 * `package.json` says `^0.4.2`, and the caret is bounded by the major: 0.4.2 is
 * the last 0.x, and 1.0.0 is where the project became Node bindings to a Rust
 * library. That cutover is why the pin exists. Read from 1.0.31 as installed,
 * none of which its README mentions:
 *
 * - `index.cjs` is `module.exports = require('sentencex-' + process.platform +
 *   '-' + process.arch)`, and `node_modules/sentencex-darwin-arm64/index.node`
 *   is a 3.4 MB `Mach-O 64-bit dynamically linked shared library arm64`. The
 *   five published binaries are darwin, linux and win32; there is no iOS or
 *   Android one to resolve.
 * - `index.mjs` imports `node:module` and `node:url` to do the same thing.
 * - Hermes cannot load a native addon and Metro cannot bundle a `.node`, so the
 *   1.x line cannot run in the app at all. It runs under vitest on a developer's
 *   macOS and nowhere the book is read.
 *
 * ADR 0006's decision — upstream `sentencex` rather than a copy of SDT — is
 * untouched by which release is loadable, which is why the answer was a pin
 * rather than a port.
 *
 * ## What the pin costs
 *
 * Fixes made upstream after 0.4.2 do not arrive. The abbreviation and
 * sentence-starter lists are the part of `sentencex` that improves with time and
 * they are frozen here at 0.4.2's, and the 1.x line will keep moving without us.
 * 0.4.2 also knows 30 languages where 1.0.31 claimed ~244; everything else falls
 * back through the package's `fallbacks.json` and finally to English, so a
 * Chinese or Romanian book is split by the English rules over a terminator list
 * that does include `。` and its relatives. That is a real reduction in quality
 * and it is the open half of notes/NOTES.md item 7.
 *
 * ## What it gives
 *
 * A default export, `segment(language, text) => string[]` — no named export and
 * no types; see `sentencex-module.d.ts` for the shape read out of the
 * package. Its pieces do **not** concatenate back to the input: the whitespace between
 * sentences is dropped, so `segment('en', 'One. Two.').join('')` is
 * `'One.Two.'`. `sentences.ts` locates each piece from a forward-only cursor
 * instead of trusting concatenation, which is what makes that harmless — and is
 * also what made the 1.x offsets unnecessary, since they were Unicode scalar
 * indices rather than UTF-16 code units (`A \u{1F600} emoji. ` ended at their 11
 * and at our 12).
 *
 * ## The language it is told
 *
 * The package finds a language's rules only by an exact key: one of the 30 bare
 * lowercase codes in `src/languages/index.js`, or one of the 241 lowercase keys
 * of `fallbacks.json`, which it walks recursively and otherwise ends at English
 * (`getLanguageClass`, `src/index.js:5-17`). An EPUB's `dc:language` arrives as
 * written, and a tag with a region, in capitals or with an underscore (`de-DE`,
 * `DE`, `de_DE`, `el-GR`) is none of those keys, so a German book was split by
 * the English rules: "Er wurde am 3." and "Oktober 1990 in Berlin geboren." as
 * two sentences (#182). And the walk keeps no record of where it has been:
 * `nan` falls back to `cdo` first and `cdo` to `nan`, so either tag ran the
 * stack out on every split, `One. Two.` included (#185).
 *
 * So the tag is resolved here, once per tag, before the package sees it
 * (`sentencexLanguage`). This reads the tag's form and never the text, so it is
 * not the language detector ADR 0006 keeps out; its amendment for #182 and #185
 * records the rule. The core segmenter still hands the tag through untouched:
 * mapping a tag onto one package's keys is this file's business.
 */
export const splitWithSentencex: SplitSentences = (language, text) => segment(sentencexLanguage(language), text);

/**
 * The 30 languages 0.4.2 has rules of its own for: the keys of the package's
 * `src/languages/index.js`, which `test/core/segmenter/language.test.ts` checks
 * this list against. Written out because the package exports only its splitter.
 */
const RULES: ReadonlySet<string> = new Set([
  'am', 'ar', 'bg', 'bn', 'ca', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'gu', 'hi', 'hy',
  'ja', 'kk', 'kn', 'ml', 'mr', 'my', 'nl', 'or', 'pa', 'pl', 'pt', 'ru', 'sk', 'ta', 'te',
]);

/**
 * The fallback keys whose walk never ends: `fallbacks.json` gives `nan` the
 * fallbacks `["cdo", "zh-hant"]` and `cdo` `["nan", "zh-hant"]`. Their next
 * entry, `zh-hant`, has no rules and ends at English, so English is the answer
 * the table means. The test walks the whole table and finds no other cycle.
 */
const CYCLING: ReadonlySet<string> = new Set(['nan', 'cdo']);

const resolved = new Map<string, string>();

/**
 * The key the package is given for a declared language tag.
 *
 * Trimmed, lowercased and with `_` read as `-`. Then: the whole tag when it has
 * rules; else its primary subtag when that has (`de-DE` is `de`, `el-GR` is
 * `el`, `pt-BR` is `pt`); else English for the two keys whose fallbacks cycle;
 * else the tag itself, which the package walks through `fallbacks.json` as
 * before (`gsw` reaches `de`, `zh` ends at English).
 *
 * The primary subtag is tried before the table, and that differs from the
 * table's own answer for five keys only: `kk-arab`, `kk-cn`, `kk-kz`, `kk-latn`
 * and `kk-tr` fall back to `kk-cyrl`, which 0.4.2 has no rules under, so the
 * table ends them at English; here they get the Kazakh rules, which is what
 * `kk-cyrl` points at.
 *
 * A tag the package still cannot resolve without throwing is English: its
 * lookup tests keys with `in`, so `constructor` or `toString` finds a member of
 * `Object.prototype` and fails as a class. Asked once per tag with an empty
 * text, so a split never throws.
 */
export function sentencexLanguage(declared: string): string {
  const known = resolved.get(declared);
  if (known !== undefined) return known;
  const tag = declared.trim().toLowerCase().replace(/_/g, '-');
  const primary = tag.split('-')[0];
  let language: string;
  if (RULES.has(tag)) language = tag;
  else if (RULES.has(primary)) language = primary;
  else if (CYCLING.has(tag)) language = 'en';
  else {
    try {
      segment(tag, '');
      language = tag;
    } catch {
      language = 'en';
    }
  }
  resolved.set(declared, language);
  return language;
}
