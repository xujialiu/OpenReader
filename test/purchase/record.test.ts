import { describe, expect, it } from 'vitest';

import { TRIAL_PRODUCT, UNLOCK_PRODUCT } from '../../src/purchase/products';
import { applyTransaction, EMPTY_RECORD, mergeRecord, parseRecord } from '../../src/purchase/record';

/** #148, ADR 0075: the device's fallback record for empty entitlement reads (FB22556883). */
describe('the device\'s record of what is owned', () => {
  it('takes the Unlock and the Trial\'s date from StoreKit', () => {
    expect(mergeRecord(EMPTY_RECORD, [
      { productId: UNLOCK_PRODUCT, purchaseDate: 5 },
      { productId: TRIAL_PRODUCT, purchaseDate: 3 },
    ], [])).toEqual({ unlocked: true, trialStartedAt: 3 });
  });

  it('keeps what it knew when StoreKit says nothing at all', () => {
    const known = { unlocked: true, trialStartedAt: 3 };
    expect(mergeRecord(known, [], [])).toEqual(known);
  });

  it('forgets a product only when StoreKit says it was revoked', () => {
    const known = { unlocked: true, trialStartedAt: 3 };
    expect(mergeRecord(known, [], [UNLOCK_PRODUCT])).toEqual({ unlocked: false, trialStartedAt: 3 });
    expect(mergeRecord(known, [], [TRIAL_PRODUCT])).toEqual({ unlocked: true, trialStartedAt: null });
    // Owned now outweighs an older revocation.
    expect(mergeRecord(EMPTY_RECORD, [{ productId: UNLOCK_PRODUCT, purchaseDate: 9 }], [UNLOCK_PRODUCT]).unlocked).toBe(true);
  });

  it('applies one transaction StoreKit reported by itself, a refund included', () => {
    const owned = applyTransaction(EMPTY_RECORD, { productId: UNLOCK_PRODUCT, purchaseDate: 7, revoked: false });
    expect(owned.unlocked).toBe(true);
    expect(applyTransaction(owned, { productId: UNLOCK_PRODUCT, purchaseDate: 7, revoked: true }).unlocked).toBe(false);
  });

  it('reads back what it wrote, and nothing from anything else', () => {
    expect(parseRecord(JSON.parse(JSON.stringify({ unlocked: true, trialStartedAt: 12 })))).toEqual({ unlocked: true, trialStartedAt: 12 });
    expect(parseRecord({ unlocked: 'yes', trialStartedAt: 'today' })).toEqual(EMPTY_RECORD);
    expect(parseRecord(null)).toEqual(EMPTY_RECORD);
  });
});
