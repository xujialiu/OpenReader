import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withStoreKitReference } from '../../plugins/with-storekit-configuration';
import { TRIAL_PRODUCT, UNLOCK_PRODUCT } from '../../src/purchase/products';

/**
 * #148, ADR 0075: the StoreKit configuration Xcode-launched runs buy from, and
 * the scheme edit that points at it.
 */
const ROOT = join(__dirname, '..', '..');

describe('storekit/OpenReader.storekit', () => {
  const file = JSON.parse(readFileSync(join(ROOT, 'storekit', 'OpenReader.storekit'), 'utf8')) as {
    products: { productID: string; type: string; displayPrice: string; familyShareable: boolean; referenceName: string; localizations: { displayName: string; description: string; locale: string }[] }[];
    subscriptionGroups: unknown[];
  };

  it('holds the two products exactly as App Store Connect has them, and nothing else', () => {
    expect(file.products.map((product) => ({
      id: product.productID, type: product.type, price: product.displayPrice, family: product.familyShareable,
      reference: product.referenceName, shown: product.localizations,
    }))).toEqual([
      { id: TRIAL_PRODUCT, type: 'NonConsumable', price: '0.0', family: false, reference: '30-day Trial',
        shown: [{ displayName: '30-day Trial', description: 'Read aloud free for 30 days.', locale: 'en_US' }] },
      { id: UNLOCK_PRODUCT, type: 'NonConsumable', price: '4.99', family: false, reference: 'Unlock',
        shown: [{ displayName: 'Unlock Read Aloud', description: 'Read aloud and offline narration, for good.', locale: 'en_US' }] },
    ]);
    expect(file.subscriptionGroups).toEqual([]);
  });
});

describe('the scheme edit', () => {
  const scheme = [
    '   <LaunchAction',
    '      buildConfiguration = "Debug">',
    '      <BuildableProductRunnable>',
    '      </BuildableProductRunnable>',
    '   </LaunchAction>',
    '   <ProfileAction>',
    '',
  ].join('\n');

  it('adds the reference as the last child of the Run action, indented as Xcode writes it', () => {
    expect(withStoreKitReference(scheme, '../../storekit/OpenReader.storekit')).toBe([
      '   <LaunchAction',
      '      buildConfiguration = "Debug">',
      '      <BuildableProductRunnable>',
      '      </BuildableProductRunnable>',
      '      <StoreKitConfigurationFileReference',
      '         identifier = "../../storekit/OpenReader.storekit">',
      '      </StoreKitConfigurationFileReference>',
      '   </LaunchAction>',
      '   <ProfileAction>',
      '',
    ].join('\n'));
  });

  it('refuses a scheme that already names one, and one with no Run action', () => {
    const once = withStoreKitReference(scheme, 'x.storekit');
    expect(() => withStoreKitReference(once, 'x.storekit')).toThrow(/already names a StoreKit configuration/);
    expect(() => withStoreKitReference('<Scheme></Scheme>', 'x.storekit')).toThrow(/no LaunchAction/);
  });
});
