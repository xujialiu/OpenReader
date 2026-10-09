import { TRIAL_PRODUCT, UNLOCK_PRODUCT } from './products';

/**
 * What this device last knew of the person's purchases (#148, ADR 0075): that
 * the Unlock is owned, and when the Trial began.
 *
 * A fallback, not the truth. StoreKit's own entitlements are, and they win
 * whenever they say more. But an Apple Forums report (FB22556883) has
 * `Transaction.currentEntitlements` and the whole history come back empty for
 * a few valid non-consumables, and an empty read must not take read-aloud away
 * from someone who paid. So what was seen is kept, and only a revocation, a
 * refund StoreKit reports, takes it back.
 *
 * Kept on the device alone: never in Shared Settings and never in a Settings
 * Backup, which carry nothing of it (`src/app/purchase-storage.ts`).
 */
export interface PurchaseRecord {
  readonly unlocked: boolean;
  readonly trialStartedAt: number | null;
}

export const EMPTY_RECORD: PurchaseRecord = { unlocked: false, trialStartedAt: null };

/** A record as written, or nothing known for anything that is not one. */
export function parseRecord(data: unknown): PurchaseRecord {
  if (!data || typeof data !== 'object') return EMPTY_RECORD;
  const { unlocked, trialStartedAt } = data as Record<string, unknown>;
  return {
    unlocked: unlocked === true,
    trialStartedAt: typeof trialStartedAt === 'number' && Number.isFinite(trialStartedAt) ? trialStartedAt : null,
  };
}

/**
 * What StoreKit says now, laid over what was kept. Owning the Unlock, or a Trial
 * with its purchase date, is taken from StoreKit; a product StoreKit says was
 * revoked is forgotten; anything StoreKit is silent about stays as it was.
 */
export function mergeRecord(
  record: PurchaseRecord,
  owned: readonly { productId: string; purchaseDate: number }[],
  revoked: readonly string[],
): PurchaseRecord {
  const trials = owned.filter((item) => item.productId === TRIAL_PRODUCT).map((item) => item.purchaseDate);
  const unlocked = owned.some((item) => item.productId === UNLOCK_PRODUCT)
    || (record.unlocked && !revoked.includes(UNLOCK_PRODUCT));
  const trialStartedAt = trials.length
    ? Math.min(...trials)
    : revoked.includes(TRIAL_PRODUCT) ? null : record.trialStartedAt;
  return { unlocked, trialStartedAt };
}

/** One transaction StoreKit reported by itself: bought, approved, or revoked. */
export function applyTransaction(
  record: PurchaseRecord,
  transaction: { productId: string; purchaseDate: number; revoked: boolean },
): PurchaseRecord {
  return transaction.revoked
    ? mergeRecord(record, [], [transaction.productId])
    : mergeRecord(record, [transaction], []);
}

export const sameRecord = (a: PurchaseRecord, b: PurchaseRecord) =>
  a.unlocked === b.unlocked && a.trialStartedAt === b.trialStartedAt;
