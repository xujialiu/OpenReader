import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Resolution } from 'metro-resolver';

import { resolveVariantFile } from '../../scripts/build/metro-resolution';

const root = '/checkout/openreader';
const source = (file: string): Resolution => ({ type: 'sourceFile', filePath: path.join(root, file) });

describe('the shipped purchase graph (#324)', () => {
  it.each(['formal', 'free', 'debug'] as const)('uses a static %s identity in Metro, independent of __DEV__', (variant) => {
    expect(resolveVariantFile(root, variant, source('src/build/variant.ts'))).toEqual(source(`src/build/variants/${variant}.ts`));
  });

  it.each(['free', 'debug'] as const)('replaces all purchase entry seams in %s', (variant) => {
    for (const [entry, replacement] of [
      ['purchase.ts', 'purchase-free.ts'],
      ['purchase-setup.ts', 'purchase-setup-free.ts'],
      ['purchase-ui.tsx', 'purchase-ui-free.tsx'],
    ]) {
      expect(resolveVariantFile(root, variant, source(`src/app/${entry}`))).toEqual(source(`src/app/${replacement}`));
    }
    for (const file of ['src/purchase/products.ts', 'src/purchase/storekit.ts', 'modules/open-reader-store/index.ts', 'src/app/purchase-screen.tsx', 'src/app/purchase-alert.ts', 'src/app/use-purchases.ts']) {
      expect(() => resolveVariantFile(root, variant, source(file)), file).toThrow(/purchase.*excluded/i);
    }
  });

  it('retains the real formal path and ignores unrelated files/assets', () => {
    for (const file of ['src/app/purchase.ts', 'src/app/purchase-ui.tsx', 'src/purchase/storekit.ts', 'modules/open-reader-store/index.ts']) {
      const resolution = source(file);
      expect(resolveVariantFile(root, 'formal', resolution)).toBe(resolution);
    }
    const unrelated = source('node_modules/example/purchase.ts');
    expect(resolveVariantFile(root, 'free', unrelated)).toBe(unrelated);
    const asset: Resolution = { type: 'assetFiles', filePaths: ['/cover.png'] };
    expect(resolveVariantFile(root, 'debug', asset)).toBe(asset);
    expect(resolveVariantFile(root, 'free', { type: 'empty' })).toEqual({ type: 'empty' });
  });
});
