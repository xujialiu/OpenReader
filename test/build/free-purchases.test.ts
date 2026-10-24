import { expect, it } from 'vitest';

import { purchases } from '../../src/app/purchase-free';
import { startPurchases } from '../../src/app/purchase-setup-free';
import { PurchaseSettingsRow, purchaseScreen } from '../../src/app/purchase-ui-free';

it('allows speech without inventing ownership or a successful purchase', async () => {
  expect(purchases.access()).toEqual({ kind: 'off' });
  expect(purchases.allowsSpeech()).toBe(true);
  expect(purchases.canStartSpeech()).toBe(true);
  expect(await purchases.askForSpeech()).toBe(true);
  await purchases.ready();
  expect(purchases.settled()).toBe(true);
  expect(purchases.price()).toBeNull();
  expect(purchases.trialLeft()).toBeNull();
  expect(await purchases.startTrial()).toBe(false);
  expect(await purchases.unlock()).toBe(false);
  expect(await purchases.restore()).toBe(false);
  expect(purchases.access()).toEqual({ kind: 'off' });
  expect(() => startPurchases()()).not.toThrow();
});

it('registers no Purchase UI or route and emits no purchase event', () => {
  // The no-purchase implementations need no React Native or store module at all.
  expect(PurchaseSettingsRow).toBeTypeOf('function');
  expect(purchaseScreen).toBeTypeOf('function');
  let changes = 0;
  const stop = purchases.subscribe(() => { changes++; });
  stop();
  expect(changes).toBe(0);
});
