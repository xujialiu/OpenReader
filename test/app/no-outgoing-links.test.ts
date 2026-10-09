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
 * thing forbidden. So the property was restated as **nothing in `src/` opens a
 * URL**, and is checked here, because it is no longer a property an eye can
 * check.
 *
 * #110 made one exception, and it is as narrow as this file can pin. The
 * privacy policy has to be reachable from inside the app (guideline 5.1.1(i)),
 * so `src/app/own-site.ts` opens it, and only pages on the project's own site.
 * #129 widened that module by two addresses and no more: the repository, and
 * an email to the Author (guideline 1.5). The ban it guards is unchanged: a
 * Provider's page is not among them.
 *
 * Each of those is one tap from the app, so the pages behind them are held to
 * the same rule (#129): the README, which is the first thing the repository
 * shows, and the project's site. Every address either one names must be on a
 * list below, and a new one fails until someone has looked at it and added it.
 * A page may say "create a key on the service's website"; it may not link to
 * that page.
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

/** The one module that may open a URL: the project's own pages (#110). */
const OWN_SITE = join(SOURCE, 'app', 'own-site.ts');

/** Where the project's own pages are: GitHub Pages, from `site/` in this repository. */
const SITE = 'https://xujialiu.github.io/OpenReader/';

/** The repository the app's GitHub row opens (#129). */
const REPOSITORY = 'https://github.com/xujialiu/OpenReader';

/**
 * Every address the README and the site may name (#129). None is a Provider's
 * signup, pricing or key console. The five Provider addresses are the privacy
 * policy's pointers to each service's own data terms, which guideline 5.1.2(i)
 * makes worth giving.
 */
const PAGES_MAY_NAME = [
  SITE,
  `${SITE}privacy.html`,
  REPOSITORY,
  `${REPOSITORY}/issues`,
  'https://github.com/xujialiu/Zotero-OpenReader',
  'mailto:xujialiuphd@gmail.com',
  // README.md (#147): the public TestFlight link, and the badges' images and links.
  'https://testflight.apple.com/join/vjC8QejW',
  `${REPOSITORY}/commits/main`,
  'https://img.shields.io/badge/iOS-17.2%2B-0071E3?style=flat-square&logo=apple',
  'https://img.shields.io/badge/TestFlight-1.0.0%20%285%29-0D96F6?style=flat-square&logo=apple',
  'https://img.shields.io/github/last-commit/xujialiu/OpenReader?style=flat-square&label=Last%20commit',
  'https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square',
  // site/privacy.html: each Provider's own data and privacy terms.
  'https://platform.openai.com/docs/guides/your-data',
  'https://fish.audio/privacy/',
  'https://fish.audio/enterprise-terms/',
  'https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/text-to-speech/data-privacy-security',
  'https://speechify.com/privacy/',
];

/** The pages one tap from the app: the README, and every page of the site. */
const ROOT = join(__dirname, '..', '..');
const PAGES = ['README.md', ...readdirSync(join(ROOT, 'site')).filter((name) => /\.html?$/.test(name)).map((name) => join('site', name))];

/** Every absolute address a page names, linked or written out. Relative links stay on the page's own site. */
const addressesIn = (text: string): string[] => text.match(/\b(?:https?:\/\/|mailto:)[^\s'"`<>)\]]+/g) ?? [];

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
    expect(files).toContain(OWN_SITE);
  });

  it.each(FORBIDDEN)('never calls %s anywhere under src/ but the module for the project\'s own pages', (call) => {
    const pattern = calls(call);
    const offenders = files.filter((path) => path !== OWN_SITE && pattern.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => path.slice(SOURCE.length + 1))).toEqual([]);
  });

  it('opens only the privacy policy, the repository and an email to the Author from that module (#110, #129)', () => {
    const text = readFileSync(OWN_SITE, 'utf8');
    const addresses = text.match(/(?:https?:\/\/|mailto:)[^\s'"`)]+/g) ?? [];
    expect(addresses).toEqual([SITE, REPOSITORY, 'mailto:${EMAIL}']);
    const opened = [...text.matchAll(/\bopenURL\s*\(([^)]*)\)/g)].map((match) => match[1]!.trim());
    expect(opened).toEqual(['PRIVACY_POLICY', 'REPOSITORY', '`mailto:${EMAIL}`']);
    expect(text).toContain('export const PRIVACY_POLICY = `${SITE}privacy.html`;');
    expect(text).toContain(`export const REPOSITORY = '${REPOSITORY}';`);
    expect(text).toContain("export const EMAIL = 'xujialiuphd@gmail.com';");
    expect(text).not.toMatch(calls('canOpenURL'));
    expect(text).not.toMatch(calls('sendIntent'));
  });

  it('points at a page this repository publishes', () => {
    // `.github/workflows/pages.yml` publishes site/ to SITE.
    expect(statSync(join(__dirname, '..', '..', 'site', 'privacy.html')).isFile()).toBe(true);
  });
});

describe('ADR 0017: the pages one tap from the app name no Provider\'s signup either (#129)', () => {
  it('finds the README and the site\'s pages, so an empty sweep cannot pass for a clean one', () => {
    expect(PAGES).toEqual(expect.arrayContaining(['README.md', join('site', 'index.html'), join('site', 'privacy.html')]));
  });

  it.each(PAGES)('%s names only addresses on the list', (page) => {
    const named = addressesIn(readFileSync(join(ROOT, page), 'utf8'));
    expect(named.filter((address) => !PAGES_MAY_NAME.includes(address))).toEqual([]);
  });

  it('names the repository on both, where the app\'s GitHub row lands and where the support page sends a reader (#129)', () => {
    for (const page of ['README.md', join('site', 'index.html')]) {
      expect(readFileSync(join(ROOT, page), 'utf8')).toContain('give it a ⭐ on');
    }
    expect(addressesIn(readFileSync(join(ROOT, 'site', 'index.html'), 'utf8'))).toContain(REPOSITORY);
  });
});
