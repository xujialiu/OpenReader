import { requireOptionalNativeModule } from 'expo';

/** One product as the App Store describes it: its name and its price in the person's own currency. */
export interface NativeProduct {
  id: string;
  displayName: string;
  displayPrice: string;
}

/** Something the person owns, with when they bought it, in milliseconds since 1970. */
export interface NativeEntitlement {
  productId: string;
  purchaseDate: number;
}

/** A transaction StoreKit reported by itself: approved, bought elsewhere, or revoked. */
export interface NativeTransaction extends NativeEntitlement {
  revoked: boolean;
}

/**
 * StoreKit 2, thinly (#148, ADR 0075). `src/purchase/storekit.ts` is its only
 * reader; what a transaction means is decided there and in `purchases.ts`.
 */
interface StoreNative {
  products(ids: string[]): Promise<NativeProduct[]>;
  purchase(id: string): Promise<'purchased' | 'pending' | 'cancelled'>;
  entitlements(): Promise<NativeEntitlement[]>;
  revoked(ids: string[]): Promise<string[]>;
  sync(): Promise<void>;
  environment(): Promise<string>;
  addListener(event: 'transaction', listener: (transaction: NativeTransaction) => void): { remove(): void };
}
export const storeNative = requireOptionalNativeModule<StoreNative>('OpenReaderStore');
