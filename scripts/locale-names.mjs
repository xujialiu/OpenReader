#!/usr/bin/env node
/**
 * Writes `src/core/locale-name-table.ts`: what `localeName` (`src/core/locale-names.ts`)
 * reads to name a Voice's locale the way
 * `new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' })`
 * does, on a phone whose Hermes has no such call (ADR 0081).
 *
 *     node scripts/locale-names.mjs
 *
 * Run it when `test/core/locale-names.test.ts` says Node's ICU now names
 * something differently, and commit what it writes. It takes about a second.
 *
 * - **Languages**: every two- and three-letter code ICU canonicalizes to itself
 *   and names, but `und`, which ICU calls `root`.
 * - **Aliases**: every two- and three-letter code ICU canonicalizes to another
 *   (`iw` is `he`, `sh` is `sr-Latn`, `prs` is `fa-AF`).
 * - **Scripts and regions** as they read inside a language's name, which is not
 *   always how they read alone: `Hans` is `Simplified` in `Chinese (Simplified)`
 *   but `Simplified Han` on its own. So each is read out of `English (…)`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/core/locale-name-table.ts', import.meta.url));

// `fallback: 'code'`, ICU's default: a numeric region that ICU replaces with a code
// it has no name for (`958` is `AA`) reads as that code.
const names = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' });

/** Every string of `length` characters drawn from `alphabet`, in order. */
function* strings(alphabet, length) {
  if (length === 0) {
    yield '';
    return;
  }
  for (const head of alphabet) for (const tail of strings(alphabet, length - 1)) yield head + tail;
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();
const DIGITS = '0123456789';

function nameOf(tag) {
  try {
    return names.of(tag);
  } catch {
    return undefined;
  }
}

function canonical(tag) {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** What `subtag` reads as inside `English (…)`, or nothing when ICU has no name for it. */
function qualifier(subtag) {
  const match = /^English \((.*)\)$/.exec(nameOf(`en-${subtag}`) ?? '');
  return match && match[1] !== subtag ? match[1] : undefined;
}

export function localeNameTables() {
  const languages = {};
  const aliases = {};
  for (const code of [...strings(LOWER, 2), ...strings(LOWER, 3)]) {
    const to = canonical(code);
    if (!to) continue;
    if (to !== code) {
      aliases[code] = to;
      continue;
    }
    const name = nameOf(code);
    // `und` is ICU's `root`, the name of its own fallback locale and not a language.
    if (name !== undefined && name !== code && code !== 'und') languages[code] = name;
  }

  const scripts = {};
  for (const head of UPPER) {
    for (const tail of strings(LOWER, 3)) {
      const name = qualifier(head + tail);
      if (name !== undefined) scripts[head + tail] = name;
    }
  }

  const regions = {};
  for (const code of [...strings(UPPER, 2), ...strings(DIGITS, 3)]) {
    const name = qualifier(code);
    if (name !== undefined) regions[code] = name;
  }
  return { languages, aliases, scripts, regions };
}

function table(name, doc, entries) {
  const lines = Object.entries(entries)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  return `/** ${doc} */\nexport const ${name}: Readonly<Record<string, string>> = {\n${lines.join('\n')}\n};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { languages, aliases, scripts, regions } = localeNameTables();
  const text = [
    `// Written by scripts/locale-names.mjs from the ICU ${process.versions.icu} in Node ${process.version}. Do not edit it; run the script.\n`,
    table('LANGUAGES', 'A language code, as ICU canonicalizes it, and its English name.', languages),
    table('LANGUAGE_ALIASES', 'A language code ICU replaces, and the tag it replaces it with.', aliases),
    table('SCRIPTS', 'A script code, and how it reads inside the parentheses of a language’s name.', scripts),
    table('REGIONS', 'A region code, and how it reads inside the parentheses of a language’s name.', regions),
  ].join('\n');
  writeFileSync(OUT, text);
  console.log(`${OUT}: ${Object.keys(languages).length} languages, ${Object.keys(aliases).length} aliases, ${Object.keys(scripts).length} scripts, ${Object.keys(regions).length} regions`);
}
