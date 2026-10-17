import { parseRecord, type PurchaseRecord } from './record';
import { parseSource, sameSource, type PurchaseSource } from './store';

/** The persisted envelope. Old unscoped records are internal-test data, not production authority (#162). */
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

/** Keep sources separate, including a return from a test copy to a previously verified store copy. */
export function purchaseCacheStore(read: () => unknown, write: (value: unknown) => void) {
  const data = read() as { version?: unknown; records?: unknown } | null;
  let records = data?.version === 2 && Array.isArray(data.records)
    ? data.records.map(parseCache).filter((record): record is PurchaseCache => record !== null) : [];
  return {
    load(source?: PurchaseSource): PurchaseCache | null {
      return (source ? records.findLast((entry) => sameSource(entry.source, source)) : records.at(-1)) ?? null;
    },
    save(next: PurchaseCache): void {
      records = [...records.filter((entry) => !sameSource(entry.source, next.source)), next];
      write({ version: 2, records });
    },
  };
}
