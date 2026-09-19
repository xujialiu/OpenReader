import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ADR 0017: there is **no tappable route to any Provider's signup, pricing or
 * key console** in the binary.
 *
 * `src/app/controls.tsx` used to state this as "nothing in `src/app/` imports
 * `Linking`", which one could check by eye because every control was in that one
 * file. ADR 0019 ended that: `src/app/opened-document.ts` reads the URL another
 * app opened this one with, and reading an incoming URL is the opposite of the
 * thing forbidden. So the property is stated the way it will stay — **nothing in
 * `src/` opens a URL** — and is checked here, because it is no longer a property
 * an eye can check.
 *
 * Source text and not a type: opening a URL type-checks perfectly, and what is
 * being prevented is someone "improving onboarding" by adding a Get API Key
 * button. The one rejection in this category with a documented resolution asked
 * for exactly that link to be removed and left the key field, the save action
 * and every other part of the plumbing alone — the credential field was never
 * the problem. A grep is the shape of the rule.
 *
 * It matches a **call** — the name, then a bracket — rather than the bare name,
 * so that a file may still say in prose which API it is not using. The cost is
 * stated rather than hidden: a comment that writes one of these out in call form
 * fails this test, and the fix is to reword the comment.
 */

const SOURCE = join(__dirname, '..', '..', 'src');

/** Anything that hands a URL to the operating system. `openSettings` is not one: it opens this app's own page and names no Provider. */
const FORBIDDEN = ['openURL', 'canOpenURL', 'sendIntent'];

const calls = (name: string): RegExp => new RegExp(`\\b${name}\\s*\\(`);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('ADR 0017: no provider links in the binary', () => {
  const files = sourceFiles(SOURCE);

  it('finds source to check, so an empty sweep cannot pass for a clean one', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('never calls %s anywhere under src/', (call) => {
    const pattern = calls(call);
    const offenders = files.filter((path) => pattern.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => path.slice(SOURCE.length + 1))).toEqual([]);
  });
});
