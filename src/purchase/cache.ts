import { parseRecord, type PurchaseRecord } from './record';
import { parseSource, sameSource, type PurchaseSource } from './store';

/**
 * The persisted envelope. An unscoped record names no source, so it is no
 * authority by itself (#162); `purchaseCacheStore` lets only its Unlock count
 * once, for the App Store copy (#316).
 */
export interface PurchaseCache {
  readonly version: 2;
  readonly source: PurchaseSource;
  readonly record: PurchaseRecord;
}

export function purchaseCache(source: PurchaseSource, record: PurchaseRecord): PurchaseCache {
  return { version: 2, source, record };
}

export function parseCache(value: unknown): PurchaseCache | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 2) return null;
  const source = parseSource(data.source);
  if (!source || !data.record || typeof data.record !== 'object') return null;
  const record = data.record as Record<string, unknown>;
  if (typeof record.unlocked !== 'boolean' || !(record.trialStartedAt === null ||
      typeof record.trialStartedAt === 'number' && Number.isFinite(record.trialStartedAt))) return null;
  return purchaseCache(source, parseRecord(record));
}

/**
 * Whether the file is 1.0.0 (7)'s unscoped `{ unlocked, trialStartedAt }`
 * with the Unlock bought. That build was the App Store copy from 2026-10-23
 * and wrote no other form, so the Unlock of a paying buyer is kept only there.
 */
function unscopedUnlock(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return record.version === undefined && record.unlocked === true;
}

/**
 * Keep sources separate, including a return from a test copy to a previously
 * verified store copy.
 *
 * An unscoped Unlock is offered to a verified `production` source that has no
 * record of its own, and only until the first save replaces the file (#316).
 * Its Trial date is never offered: a Trial run in a test copy must not end or
 * shorten the store copy's Trial. A TestFlight copy, Xcode, or a read with no
 * verified source gets nothing from it.
 */
export function purchaseCacheStore(read: () => unknown, write: (value: unknown) => void) {
  const data = read() as { version?: unknown; records?: unknown } | null;
  let records = data?.version === 2 && Array.isArray(data.records)
    ? data.records.map(parseCache).filter((record): record is PurchaseCache => record !== null) : [];
  let unscoped = unscopedUnlock(data);
  return {
    load(source?: PurchaseSource): PurchaseCache | null {
      const kept = source ? records.findLast((entry) => sameSource(entry.source, source)) : records.at(-1);
      if (kept) return kept;
      return unscoped && source?.environment === 'production' ? purchaseCache(source, { unlocked: true, trialStartedAt: null }) : null;
    },
    save(next: PurchaseCache): void {
      unscoped = false;
      records = [...records.filter((entry) => !sameSource(entry.source, next.source)), next];
      write({ version: 2, records });
    },
  };
}
