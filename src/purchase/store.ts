/**
 * The App Store as `purchases.ts` sees it (#148, ADR 0075): StoreKit in the app
 * (`storekit.ts`), and a fake one for tests and for a build with Debug Mode
 * (`fake-store.ts`).
 */

/** One product: its name and its price in the person's own currency, as the App Store gives them. */
export interface StoreProduct {
  readonly id: string;
  readonly displayName: string;
  readonly displayPrice: string;
}

/** Something owned, with when it was bought, in milliseconds since 1970. */
export interface StoreEntitlement {
  readonly productId: string;
  readonly purchaseDate: number;
}

/** A transaction the App Store reported by itself: approved, bought on another device, or revoked. */
export interface StoreTransaction extends StoreEntitlement {
  readonly revoked: boolean;
}

/** How a purchase ended: bought, waiting for a parent's approval (Ask to Buy), or cancelled. */
export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled';

export interface Store {
  /** The products the App Store has under these identifiers; none, or a rejection, when it cannot be reached or has none. */
  products(ids: readonly string[]): Promise<StoreProduct[]>;
  /** Shows the App Store's own sheet. Rejects when the purchase could not be made at all. */
  purchase(id: string): Promise<PurchaseOutcome>;
  /** What is owned now, verified and not revoked. */
  entitlements(): Promise<StoreEntitlement[]>;
  /** Which of these products were revoked: refunded, perhaps while the app was closed. */
  revoked(ids: readonly string[]): Promise<string[]>;
  /** Restore Purchase: asks the App Store for this Apple Account's purchases again. */
  sync(): Promise<void>;
  /** Transactions as they arrive by themselves. Returns the way to stop listening. */
  listen(listener: (transaction: StoreTransaction) => void): () => void;
}
