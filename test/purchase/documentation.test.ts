import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const missingPaths = (text: string) => [...text.matchAll(/`((?:src|test)\/[A-Za-z0-9_./-]+)`/g)]
  .map((match) => match[1]).filter((path) => !existsSync(path));

describe('purchase documentation points to the current implementation (#165)', () => {
  it('names existing source files for persistence and the Settings page', () => {
    expect(missingPaths(read('src/purchase/record.ts'))).toEqual([]);
    const adr = read('docs/adr/0075-read-aloud-is-bought-once-after-a-trial.md');
    const start = adr.indexOf('### The TypeScript\n');
    const end = adr.indexOf('### The gate\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(missingPaths(adr.slice(start, end))).toEqual([]);
  });

  it('the test config names the offline tests that configure a locked controller', () => {
    expect(read('vitest.config.mts')).toContain('test/offline/runtime-purchase*');
    for (const path of ['test/offline/runtime-purchase.test.ts', 'test/offline/runtime-purchase-launch.test.ts']) {
      expect(read(path)).toContain('configurePurchases(');
    }
  });
});

describe('support and release text disclose the Trial and Unlock (#223)', () => {
  it('the support page explains the App Store Trial instead of calling all functionality free', () => {
    const site = read('site/index.html');
    expect(site).not.toMatch(/free and open source/i);
    expect(site).toMatch(/App Store[\s\S]*30 days[\s\S]*one-time/i);
  });

  it('the listing draft states the free download, Trial and one-time purchase', () => {
    expect(read('docs/release-to-app-store.md')).toContain('app-store-connect.md#metadata-and-review');
    const guide = read('docs/app-store-connect.md');
    const start = guide.indexOf('### Store listing (draft');
    expect(start).toBeGreaterThan(-1);
    const draft = guide.slice(start);
    expect(draft).not.toMatch(/OpenReader is free and open source/);
    expect(draft).toContain('Free to download. Reading aloud is free for 30 days');
    expect(draft).toContain('one-time in-app purchase');
  });

  it('the first Play in the review template starts the Trial before Consent', () => {
    const guide = read('docs/app-store-connect.md');
    const start = guide.indexOf('4. Press Play.');
    expect(start).toBeGreaterThan(-1);
    const step = guide.slice(start, guide.indexOf('\n\n', start));
    expect(step).toMatch(/Start Free Trial[\s\S]*Allow/);
  });
});
