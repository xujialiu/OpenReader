import { DAY_MS, TRIAL_MS, TRIAL_PRODUCT, UNLOCK_PRODUCT } from './products';
import type { PurchaseOutcome, Store, StoreProduct, StoreTransaction } from './store';

/**
 * A pretend App Store (#148): for tests, and for a build with Debug Mode, where
 * the walkthrough harness drives it (`test/manual-test/README.md`, "The Trial
 * and the Unlock"). It owns what it owns the way StoreKit does, across launches
 * when `save` keeps it, so the app's own fallback record is not involved.
 */
export interface FakeStoreState {
  /** Whether the products load. False is the App Store out of reach, or a bundle ID with nothing to sell. */
  readonly products: boolean;
  readonly trialStartedAt: number | null;
  readonly unlocked: boolean;
  /** What the next purchase does: buys, waits for approval, is cancelled, or fails outright. */
  readonly outcome: PurchaseOutcome | 'failed';
}

/** A build with Debug Mode starts here: as if the Unlock were owned, so every test that presses Play plays. */
export const FAKE_UNLOCKED: FakeStoreState = { products: true, trialStartedAt: null, unlocked: true, outcome: 'purchased' };

export const FAKE_PRODUCTS: readonly StoreProduct[] = [
  { id: TRIAL_PRODUCT, displayName: '30-day Trial', displayPrice: '$0.00' },
  { id: UNLOCK_PRODUCT, displayName: 'Unlock Read Aloud', displayPrice: '$4.99' },
];

/**
 * A harness command's state, read against the clock (`{"do":"store",…}`):
 *
 * - `not-started`, `ended`, `unlocked`: those states, products loading;
 * - `trial` with `days`: N days left, ending a minute short of N whole days so
 *   the count reads N; or with `seconds`: ending that many seconds from now;
 * - `unavailable` / `available`: whether products load, keeping what is owned;
 * - `outcome`: what the next purchase does.
 *
 * Returns null for a command it does not understand, which changes nothing.
 */
export function fakeStateFor(was: FakeStoreState, command: Record<string, unknown>, now: number): FakeStoreState | null {
  let next: FakeStoreState = was;
  const state = command.state;
  if (state === 'not-started') next = { ...next, products: true, trialStartedAt: null, unlocked: false };
  else if (state === 'ended') next = { ...next, products: true, trialStartedAt: now - TRIAL_MS - DAY_MS, unlocked: false };
  else if (state === 'unlocked') next = { ...next, products: true, unlocked: true };
  else if (state === 'trial') {
    const left = typeof command.seconds === 'number' ? command.seconds * 1000
      : typeof command.days === 'number' ? command.days * DAY_MS - 60_000 : null;
    if (left === null) return null;
    next = { ...next, products: true, trialStartedAt: now - TRIAL_MS + left, unlocked: false };
  } else if (state === 'unavailable') next = { ...next, products: false };
  else if (state === 'available') next = { ...next, products: true };
  else if (state !== undefined) return null;
  const outcome = command.outcome;
  if (outcome !== undefined) {
    if (outcome !== 'purchased' && outcome !== 'pending' && outcome !== 'cancelled' && outcome !== 'failed') return null;
    next = { ...next, outcome };
  }
  return next;
}

export interface FakeStore extends Store {
  state(): FakeStoreState;
  /** Replaces what it owns and sells, as a harness command does, telling listeners of anything bought or revoked. */
  set(next: FakeStoreState): void;
  /** A refund: the product is no longer owned, and listeners hear of the revocation. */
  revoke(id: string): void;
  /** Counts of what was asked of it, for tests. */
  readonly calls: { products: number; purchase: number; entitlements: number; sync: number };
}

export function createFakeStore(initial: FakeStoreState, deps: { now(): number; save?(state: FakeStoreState): void }): FakeStore {
  let current = initial;
  const listeners = new Set<(transaction: StoreTransaction) => void>();
  const calls = { products: 0, purchase: 0, entitlements: 0, sync: 0 };
  const tell = (transaction: StoreTransaction) => { for (const listener of [...listeners]) listener(transaction); };
  function set(next: FakeStoreState): void {
    const was = current;
    current = next;
    deps.save?.(next);
    if (next.unlocked && !was.unlocked) tell({ productId: UNLOCK_PRODUCT, purchaseDate: deps.now(), revoked: false });
    if (!next.unlocked && was.unlocked) tell({ productId: UNLOCK_PRODUCT, purchaseDate: deps.now(), revoked: true });
    if (next.trialStartedAt !== null && next.trialStartedAt !== was.trialStartedAt)
      tell({ productId: TRIAL_PRODUCT, purchaseDate: next.trialStartedAt, revoked: false });
    if (next.trialStartedAt === null && was.trialStartedAt !== null)
      tell({ productId: TRIAL_PRODUCT, purchaseDate: was.trialStartedAt, revoked: true });
  }
  return {
    calls,
    state: () => current,
    set,
    revoke(id) {
      if (id === UNLOCK_PRODUCT) set({ ...current, unlocked: false });
      else if (id === TRIAL_PRODUCT) set({ ...current, trialStartedAt: null });
    },
    async products(ids) {
      calls.products++;
      if (!current.products) throw new Error('The App Store cannot be reached (fake).');
      return FAKE_PRODUCTS.filter((product) => ids.includes(product.id));
    },
    async purchase(id) {
      calls.purchase++;
      if (!current.products) throw new Error('The App Store cannot be reached (fake).');
      if (current.outcome === 'failed') throw new Error('The purchase failed (fake).');
      if (current.outcome !== 'purchased') return current.outcome;
      if (id === UNLOCK_PRODUCT && !current.unlocked) set({ ...current, unlocked: true });
      if (id === TRIAL_PRODUCT && current.trialStartedAt === null) set({ ...current, trialStartedAt: deps.now() });
      return 'purchased';
    },
    async entitlements() {
      calls.entitlements++;
      return [
        ...(current.unlocked ? [{ productId: UNLOCK_PRODUCT, purchaseDate: 0 }] : []),
        ...(current.trialStartedAt !== null ? [{ productId: TRIAL_PRODUCT, purchaseDate: current.trialStartedAt }] : []),
      ];
    },
    async revoked() { return []; },
    async sync() { calls.sync++; },
    listen(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
