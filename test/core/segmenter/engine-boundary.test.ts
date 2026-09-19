import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two rules this directory keeps that nothing else would notice being broken.
 * `test/core/providers/import-boundary.test.ts` guards ADR 0013's import rule
 * the same way and for the same reason.
 *
 * 1. **`index.ts` must not bind a splitter.** `sentencex` is pinned at 0.4.2 and
 *    loads anywhere, so this is no longer about a crash — it is about ADR 0006,
 *    which says in as many words that `sentencex` "is the first segmenter here,
 *    not the final one". While the splitter arrives as an argument, replacing it
 *    is a change at the one call site that wires it; the moment `index.ts`
 *    imports one, it is a change to every file that imports `index.ts`. The
 *    history of why the seam was cut in the first place is in sentencex.ts: the
 *    1.x line is a native Rust addon and cannot load on Hermes at all.
 *
 * 2. **Nothing here may go through `Intl.Segmenter`.** Hermes has none
 *    (`Intl.Segmenter is not a function`, notes/NOTES_2026-09-19.md), and the
 *    `unicode-segmenter` polyfill that supplies one implements
 *    `granularity: 'grapheme'` only — `'word'` and `'sentence'` each throw a
 *    `TypeError`. Node's own `Intl.Segmenter` is complete, so code written
 *    through the global passes here and throws there. The concrete import from
 *    `unicode-segmenter/grapheme` behaves the same on both.
 */

const DIR = join(__dirname, '../../../src/core/segmenter');
const sources = new Map<string, string>(
  readdirSync(DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, readFileSync(join(DIR, name), 'utf8')]),
);

/**
 * The file with its comments taken out, because a comment is allowed to mention
 * what the code may not do and several of these do. Naive, and safe on these
 * files: none of them holds a regular expression containing `//` or `/*`.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
}

/** Module specifiers a file imports, from its text — enough for a directory this size with no dynamic imports. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

/** Every file in this directory that `index.ts` pulls in, directly or not. */
function reachable(): Set<string> {
  const seen = new Set<string>();
  const queue = ['index.ts'];
  while (queue.length) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const specifier of importsOf(sources.get(name) ?? '')) {
      if (!specifier.startsWith('.')) continue;
      const file = specifier.replace(/^\.\//, '') + '.ts';
      if (sources.has(file)) queue.push(file);
    }
  }
  return seen;
}

describe('the engine boundary', () => {
  it('finds the files it is meant to be reading', () => {
    expect([...sources.keys()].sort()).toEqual([
      'graphemes.ts',
      'index.ts',
      'rejoin.ts',
      'sentences.ts',
      // Hand-written because 0.4.2 ships no types. Not `sentencex.d.ts`:
      // TypeScript takes a `.d.ts` beside a `.ts` of the same basename for that
      // file's declaration output and leaves it out of the program.
      'sentencex-module.d.ts',
      'sentencex.ts',
      'speakable.ts',
    ]);
  });

  it('imports the sentencex package in exactly one file', () => {
    const naming = [...sources].filter(([, source]) => importsOf(source).includes('sentencex')).map(([name]) => name);
    expect(naming).toEqual(['sentencex.ts']);
    // The declaration file names it too, in a `declare module`, which is not an
    // import and binds nothing.
    expect(sources.get('sentencex-module.d.ts')).toContain("declare module 'sentencex'");
  });

  it('keeps the splitter binding out of everything index.ts pulls in', () => {
    expect(reachable().has('sentencex.ts')).toBe(false);
    // And the guard itself works: the file is there to be found.
    expect(sources.has('sentencex.ts')).toBe(true);
  });

  it('reaches unicode-segmenter only through its concrete grapheme export', () => {
    for (const [name, source] of sources) {
      for (const specifier of importsOf(source)) {
        if (specifier.startsWith('unicode-segmenter')) {
          expect([name, specifier]).toEqual(['graphemes.ts', 'unicode-segmenter/grapheme']);
        }
      }
    }
  });

  it('never mentions Intl.Segmenter, which exists here and not on Hermes', () => {
    for (const [name, source] of sources) {
      expect([name, /\bIntl\.Segmenter\b/.test(code(source))]).toEqual([name, false]);
    }
    // The rule is worth stating because the name really is in this directory —
    // in graphemes.ts, in the comment that explains why it is not used.
    expect(sources.get('graphemes.ts')).toContain('Intl.Segmenter');
  });
});
