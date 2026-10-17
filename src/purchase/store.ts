/** The App Store seam: verified reads and transactions, not a device-wide unlocked flag. */
export interface StoreProduct {
  readonly id: string;
  readonly displayName: string;
  readonly displayPrice: string;
}

/** Provenance from a verified AppTransaction or live StoreKit transaction, never a build flag. */
export interface PurchaseSource {
  readonly environment: 'production' | 'sandbox' | 'xcode';
  readonly appTransactionId: string;
}

export function parseSource(value: unknown): PurchaseSource | null {
  if (!value || typeof value !== 'object') return null;
  const { environment, appTransactionId } = value as Record<string, unknown>;
  if (environment !== 'production' && environment !== 'sandbox' && environment !== 'xcode') return null;
  if (typeof appTransactionId !== 'string' || !appTransactionId.trim()) return null;
  return { environment, appTransactionId };
}
export const sameSource = (a: PurchaseSource | null, b: PurchaseSource | null): boolean =>
  a !== null && b !== null && a.environment === b.environment && a.appTransactionId === b.appTransactionId;

export interface StoreEntitlement {
  readonly productId: string;
  readonly purchaseDate: number;
}
export interface StoreTransaction extends StoreEntitlement {
  readonly revoked: boolean;
  readonly source: PurchaseSource | null;
}

/** A current read. A missing source is never permission to reuse a cached record. */
export interface StoreSnapshot {
  readonly source: PurchaseSource | null;
  readonly owned: readonly StoreEntitlement[];
  readonly revoked: readonly string[];
}

/** These strings also name outcomes in the pretend App Store's harness. */
export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled';
export type StorePurchase =
  | { readonly outcome: 'purchased'; readonly transaction: StoreTransaction }
  | { readonly outcome: 'pending' | 'cancelled' };

export interface Store {
  products(ids: readonly string[]): Promise<StoreProduct[]>;
  /** A successful purchase carries the verified transaction, including its real purchase date. */
  purchase(id: string): Promise<StorePurchase>;
  /** Source, current entitlements and revocations read together by the native adapter. */
  snapshot(ids: readonly string[]): Promise<StoreSnapshot>;
  /** Explicit cancellation is silent; other restore failures reject. */
  sync(): Promise<'restored' | 'cancelled'>;
  listen(listener: (transaction: StoreTransaction) => void): () => void;
}
